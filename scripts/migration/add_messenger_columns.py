"""
Migration: Add Alternate Messenger Contact Center fields to User + SyncSettings tables.
Adds:
  - users.dialer_provider_override  (nullable varchar)
  - sync_settings.messenger_from_number  (nullable varchar)
  - sync_settings.messenger_last_sync_at (nullable timestamptz)

Safe to run multiple times — uses IF NOT EXISTS checks.
"""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    print("ERROR: Set DATABASE_URL env variable")
    sys.exit(1)

engine = create_engine(DATABASE_URL)

MIGRATIONS = [
    # Per-SDR dialer provider override
    """
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'users' AND column_name = 'dialer_provider_override') THEN
            ALTER TABLE users ADD COLUMN dialer_provider_override VARCHAR;
        END IF;
    END $$;
    """,

    # Alternate Messenger from number (caller ID)
    """
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'sync_settings' AND column_name = 'messenger_from_number') THEN
            ALTER TABLE sync_settings ADD COLUMN messenger_from_number VARCHAR;
        END IF;
    END $$;
    """,

    # Alternate Messenger last sync timestamp
    """
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'sync_settings' AND column_name = 'messenger_last_sync_at') THEN
            ALTER TABLE sync_settings ADD COLUMN messenger_last_sync_at TIMESTAMPTZ;
        END IF;
    END $$;
    """,
]


def run():
    print("=" * 60)
    print("Alternate Messenger Contact Center — Column Migration")
    print("=" * 60)

    with engine.begin() as conn:
        for i, sql in enumerate(MIGRATIONS, 1):
            print(f"\n[{i}/{len(MIGRATIONS)}] Running migration...")
            conn.execute(text(sql))
            print(f"  ✓ Done")

    print("\n" + "=" * 60)
    print("All migrations applied successfully!")
    print("=" * 60)


if __name__ == "__main__":
    run()
