"""
One-time backfill script: Create SCHEDULE_MEETING activity log events
for leads that transitioned to 'Meeting Scheduled' but never had the
activity log event emitted.

This fixes the SDR Metrics discrepancy where only 2 of 7 meetings
were counted because the SCHEDULE_MEETING event was only emitted from
the UI status-change path, not from the call outcome auto-transition path.

Usage:
    python backfill_meeting_events.py

Safe to run multiple times - checks for existing events before inserting.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal
import models
from activity_logger import log_activity


def backfill():
    db = SessionLocal()
    try:
        # Find all leads currently in Meeting Scheduled status
        meeting_leads = db.query(models.Lead).filter(
            models.Lead.status == "Meeting Scheduled"
        ).all()

        print(f"Found {len(meeting_leads)} leads in 'Meeting Scheduled' status")

        backfilled = 0
        skipped = 0

        for lead in meeting_leads:
            lead_name = f"{lead.first_name or ''} {lead.last_name or ''}".strip()

            # Find the SDR(s) assigned to this lead
            assigned_users = lead.assigned_users if hasattr(lead, 'assigned_users') else []

            if not assigned_users:
                print(f"  SKIP: {lead_name} - no assigned SDR")
                skipped += 1
                continue

            for sdr in assigned_users:
                # Check if a SCHEDULE_MEETING event already exists for this lead+user
                existing = db.query(models.UserActivityLog).filter(
                    models.UserActivityLog.user_id == sdr.id,
                    models.UserActivityLog.action_type == "SCHEDULE_MEETING",
                    models.UserActivityLog.object_id == lead.id,
                ).first()

                if existing:
                    print(f"  SKIP: {lead_name} - event already exists for {sdr.name} (logged {existing.created_at})")
                    skipped += 1
                    continue

                # Create the backfill event
                log_activity(
                    sdr.id,
                    "SCHEDULE_MEETING",
                    user_email=sdr.email,
                    user_name=sdr.name,
                    object_type="lead",
                    object_id=lead.id,
                    metadata={"lead_name": lead_name, "backfilled": True},
                )

                event_time = lead.status_changed_at or lead.created_at
                print(f"  BACKFILLED: {lead_name} -> {sdr.name} (original date: {event_time})")
                backfilled += 1

        print(f"\nDone. Backfilled: {backfilled}, Skipped: {skipped}")

    finally:
        db.close()


if __name__ == "__main__":
    backfill()
