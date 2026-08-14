#!/usr/bin/env python3
"""
backfill_aircall_duration.py
────────────────────────────
One-time script to heal existing Aircall DialerCall records whose duration,
answered_at, or ended_at is NULL by fetching the authoritative data from
Aircall's call history API.

WHEN TO RUN:
  • After the C1 fix (duration-heal in nightly sync) is deployed to prod
  • Run once on staging to verify output, then run once on prod

USAGE:
  # Staging
  python backend/scripts/backfill_aircall_duration.py --env staging --dry-run

  # Prod (after staging verified)
  python backend/scripts/backfill_aircall_duration.py --env prod

  # Limit to last N days (default: 90)
  python backend/scripts/backfill_aircall_duration.py --env prod --days 30

SAFE TO RE-RUN:
  Idempotent — only updates records where duration IS NULL. If re-run after
  a partial success, it skips already-healed records.
"""

import argparse
import os
import sys
import time
import logging
from datetime import datetime, timedelta, timezone

# ── Add project root to path ──────────────────────────────────────────────────
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))   # …/backend/scripts
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)                   # …/backend
sys.path.insert(0, BACKEND_DIR)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("backfill")

# ── Argument parsing ──────────────────────────────────────────────────────────

def _parse_args():
    p = argparse.ArgumentParser(description="Backfill missing Aircall call durations")
    p.add_argument("--days",    type=int, default=90,
                   help="Number of past days to scan (default: 90)")
    p.add_argument("--dry-run", action="store_true",
                   help="Print what would be changed without writing to DB")
    p.add_argument("--env",     choices=["staging", "prod"], default="staging",
                   help="Which DB env to connect to (hint only — uses DATABASE_URL env var)")
    return p.parse_args()


# ── Main ──────────────────────────────────────────────────────────────────────

def run(days: int, dry_run: bool):
    from database import SessionLocal
    from dialer_service import get_active_provider
    import models

    db = SessionLocal()
    total_healed  = 0
    total_checked = 0
    total_api_err = 0

    try:
        provider = get_active_provider(db)
        if not provider or provider.provider_name != "aircall":
            logger.error("No active Aircall provider configured — aborting")
            sys.exit(1)

        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        # Fetch only records that are missing duration OR answered_at
        to_heal = (
            db.query(models.DialerCall)
            .filter(
                models.DialerCall.provider == "aircall",
                models.DialerCall.started_at >= cutoff,
                (models.DialerCall.duration    == None) |      # noqa: E711
                (models.DialerCall.answered_at == None),
            )
            .order_by(models.DialerCall.started_at.desc())
            .all()
        )

        logger.info(f"Found {len(to_heal)} Aircall records with missing duration/answered_at")

        if dry_run:
            logger.info("[DRY RUN] No changes will be written")

        for i, record in enumerate(to_heal):
            total_checked += 1
            provider_call_id = record.provider_call_id
            if not provider_call_id:
                continue

            try:
                # Fetch authoritative data from Aircall
                call_data = provider.fetch_call(provider_call_id)
                if not call_data:
                    logger.warning(f"  [{i+1}] Call {provider_call_id} not found in Aircall")
                    continue

                duration    = call_data.get("duration")
                answered_at_ts = call_data.get("answered_at")
                ended_at_ts    = call_data.get("ended_at")

                answered_at = (
                    datetime.fromtimestamp(answered_at_ts, tz=timezone.utc)
                    if answered_at_ts else None
                )
                ended_at = (
                    datetime.fromtimestamp(ended_at_ts, tz=timezone.utc)
                    if ended_at_ts else None
                )

                changes = {}
                if duration is not None and record.duration is None:
                    changes["duration"]    = duration
                if answered_at and record.answered_at is None:
                    changes["answered_at"] = answered_at
                if ended_at and record.ended_at is None:
                    changes["ended_at"]    = ended_at

                if not changes:
                    logger.debug(f"  [{i+1}] Call {provider_call_id} — no data to heal (Aircall also null)")
                    continue

                logger.info(
                    f"  [{i+1}] DialerCall {record.id} (Aircall {provider_call_id}) → "
                    f"{changes}"
                )

                if not dry_run:
                    for field, value in changes.items():
                        setattr(record, field, value)
                    total_healed += 1

                    # Commit every 25 records to limit memory pressure
                    if total_healed % 25 == 0:
                        db.commit()
                        logger.info(f"  … committed {total_healed} healed records so far")

            except Exception as e:
                total_api_err += 1
                logger.warning(f"  [{i+1}] Error fetching call {provider_call_id}: {e}")

            # Rate-limit: ~2 req/s to avoid hammering Aircall API
            if (i + 1) % 5 == 0:
                time.sleep(2.5)

        # Final commit
        if not dry_run and total_healed > 0:
            db.commit()

        logger.info(
            f"\n{'[DRY RUN] ' if dry_run else ''}Backfill complete:\n"
            f"  Checked : {total_checked}\n"
            f"  Healed  : {total_healed}{'  (not written — dry run)' if dry_run else ''}\n"
            f"  API errs: {total_api_err}"
        )

    finally:
        db.close()


if __name__ == "__main__":
    args = _parse_args()
    logger.info(
        f"Starting Aircall duration backfill: last {args.days} days "
        f"| env={args.env} | dry_run={args.dry_run}"
    )
    run(days=args.days, dry_run=args.dry_run)
