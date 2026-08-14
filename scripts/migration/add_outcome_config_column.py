"""
Migration: Add outcome_config column to sync_settings table.
Adds:
  - sync_settings.outcome_config  (nullable TEXT — stores JSON array)

Safe to run multiple times — uses IF NOT EXISTS checks.
Part of Phase 2: Dynamic Call Outcomes.
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
    # V29: Dynamic call outcome configuration (JSON array)
    """
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'sync_settings' AND column_name = 'outcome_config') THEN
            ALTER TABLE sync_settings ADD COLUMN outcome_config TEXT;
        END IF;
    END $$;
    """,
]

def run():
    with engine.begin() as conn:
        for sql in MIGRATIONS:
            conn.execute(text(sql))
    print("✅ Migration complete: outcome_config column added to sync_settings.")

if __name__ == "__main__":
    run()
