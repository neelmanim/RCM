#!/usr/bin/env python3
"""
backfill_campaign_names.py
───────────────────────────
One-time script to give old, auto-named Email Campaigns a real name.

Before v12.7.11, the compose form had no "Campaign name" field, so
create_campaign() (routes/email_campaign_routes.py) always fell back to
`name = subject[:80]` — every campaign created before that release has this
generic, often-duplicated name (e.g. "Hello {{first_name}} — A Personalized
Test Email for {{company}}" repeated across every campaign that reused the
same subject line).

There's no stored link from a campaign back to the template it was created
from (EmailCampaign has no template_id — see its docstring in models.py:
subject/body are a frozen snapshot on purpose). So this can only be a
best-effort match: if a campaign's subject+body still matches a CURRENT
EmailTemplate row exactly, rename the campaign to that template's name.
Anything that doesn't match (template since edited/deleted, or the
campaign was never created from a saved template) is left alone — use the
new in-app rename (pencil icon in Campaigns list, or PATCH
/api/email-campaigns/{id}) for those.

USAGE:
  python backend/scripts/backfill_campaign_names.py --env staging --dry-run
  python backend/scripts/backfill_campaign_names.py --env prod

SAFE TO RE-RUN:
  Idempotent — only touches rows whose name still equals subject[:80]
  (the exact fallback create_campaign used), so a campaign already renamed
  (by this script or by hand) is never touched again.
"""

import argparse
import logging
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))   # …/backend/scripts
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)                  # …/backend
sys.path.insert(0, BACKEND_DIR)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("backfill_campaign_names")


def _parse_args():
    p = argparse.ArgumentParser(description="Rename old auto-named campaigns from a matching template")
    p.add_argument("--dry-run", action="store_true", help="Print what would change without writing to DB")
    p.add_argument("--env", choices=["staging", "prod"], default="staging",
                   help="Hint only — uses DATABASE_URL env var, same as backfill_aircall_duration.py")
    return p.parse_args()


def find_renames(db):
    """Pure matching logic, split out from run() so it's testable against an
    in-memory db without needing DATABASE_URL/SessionLocal. Returns
    [(campaign, new_name), ...] — doesn't write anything."""
    import models

    templates = db.query(models.EmailTemplate).all()
    # A campaign's fallback name is exactly subject[:80] with no way to tell
    # "genuinely named 'Q3 outreach'" apart from a coincidentally short
    # subject — but auto-named rows are the ones we can match to a template
    # anyway, so filter to those instead of guessing. Dataset is small
    # enough (per-org campaigns, not leads) to filter in Python rather than
    # fight substr()'s SQLite-vs-Postgres argument quirks.
    candidates = [c for c in db.query(models.EmailCampaign).all() if c.name == (c.subject or "")[:80]]
    renames = []
    for c in candidates:
        match = next((t for t in templates if t.subject == c.subject and t.body == c.body), None)
        if match:
            renames.append((c, match.name))
    return renames, len(candidates)


def run(dry_run: bool):
    from database import SessionLocal

    db = SessionLocal()
    try:
        renames, total_candidates = find_renames(db)
        logger.info(f"Found {total_candidates} auto-named campaign(s) to check")

        for c, new_name in renames:
            logger.info(f"  Campaign {c.id}: {c.name!r} -> {new_name!r}")
            if not dry_run:
                c.name = new_name

        if dry_run:
            logger.info(f"[DRY RUN] Would rename {len(renames)} of {total_candidates} campaign(s)")
        else:
            db.commit()
            logger.info(f"Renamed {len(renames)} of {total_candidates} campaign(s)")
        logger.info(f"{total_candidates - len(renames)} campaign(s) had no matching template — rename by hand in the Campaigns list.")
    finally:
        db.close()


if __name__ == "__main__":
    args = _parse_args()
    run(dry_run=args.dry_run)
