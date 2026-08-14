"""
One-time staging cleanup: quarantine phoneless leads.
Sets status to 'No Phone - Parked' and unassigns SDR for any lead
that has no phone, phone_secondary, or company_phone.
"""
import sys
from sqlalchemy import create_engine, text

DB_URL = (
    "postgresql://rcm_db_staging_user:"
    "n3oJxSZtWAIBcWERT6B0oHsR5lwg6jWs"
    "@dpg-d6ncblh5pdvs73aacni0-a.ohio-postgres.render.com"
    "/rcm_db_staging"
)

NO_PHONE_FILTER = """
    (phone IS NULL OR TRIM(phone) = '')
    AND (phone_secondary IS NULL OR TRIM(phone_secondary) = '')
    AND (company_phone IS NULL OR TRIM(company_phone) = '')
"""

engine = create_engine(DB_URL)


def scan():
    """Read-only scan: count phoneless leads on staging."""
    with engine.connect() as conn:
        row = conn.execute(text(f"""
            SELECT
                COUNT(*) AS total_leads,
                COUNT(*) FILTER (WHERE {NO_PHONE_FILTER}) AS no_phone_leads,
                COUNT(*) FILTER (WHERE status = 'No Phone - Parked') AS already_parked
            FROM leads
        """)).fetchone()
        print(f"Total leads:          {row[0]}")
        print(f"Leads without phone:  {row[1]}")
        print(f"Already parked:       {row[2]}")
        print(f"Leads to quarantine:  {row[1] - row[2]}")
        return row[1] - row[2]


def cleanup():
    """Update phoneless leads to 'No Phone - Parked' and unassign them."""
    with engine.begin() as conn:
        # 1. Unassign: remove from lead_assignments join table
        unassign_result = conn.execute(text(f"""
            DELETE FROM lead_assignments
            WHERE lead_id IN (
                SELECT id FROM leads
                WHERE {NO_PHONE_FILTER}
                  AND status != 'No Phone - Parked'
            )
        """))
        print(f"Unassigned {unassign_result.rowcount} lead-user assignments")

        # 2. Update status to 'No Phone - Parked'
        status_result = conn.execute(text(f"""
            UPDATE leads
            SET status = 'No Phone - Parked'
            WHERE {NO_PHONE_FILTER}
              AND status != 'No Phone - Parked'
        """))
        print(f"\n✅ Updated {status_result.rowcount} leads to 'No Phone - Parked'")
        return status_result.rowcount


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "scan"

    if mode == "scan":
        print("=== STAGING SCAN (read-only) ===\n")
        scan()
    elif mode == "run":
        print("=== STAGING CLEANUP ===\n")
        count = scan()
        if count > 0:
            print("\nRunning cleanup...")
            cleanup()
        else:
            print("\nNothing to clean up.")
    else:
        print(f"Usage: python {sys.argv[0]} [scan|run]")
