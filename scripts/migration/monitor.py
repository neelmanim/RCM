#!/usr/bin/env python3
"""
Migration Monitor — Run this anytime to check Phase 5 & 6 status.

Usage:
    python3 scripts/migration/monitor.py
"""
import sys
from sqlalchemy import create_engine, text

DB_URL = "postgresql://rcm_db_prod_user:Ut07ADTDCQY1tR9lOWxyVPS8UQyaB1ZC@dpg-d6ncblh5pdvs73aacnhg-a.ohio-postgres.render.com/rcm_db_prod"

def main():
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        print("=" * 60)
        print("MIGRATION MONITOR")
        print("=" * 60)
        
        # ── Phase 5: Leads ──
        mig_total = conn.execute(text("SELECT COUNT(*) FROM leads WHERE sf_lead_id LIKE 'MIG-%'")).scalar()
        statuses = conn.execute(text("""
            SELECT status, COUNT(*) FROM leads WHERE sf_lead_id LIKE 'MIG-%' GROUP BY status ORDER BY COUNT(*) DESC
        """)).fetchall()
        
        print(f"\n📦 PHASE 5: Lead Import")
        print(f"   Total migrated: {mig_total} / 3,039 {'✅ COMPLETE' if mig_total >= 3039 else '⏳ IN PROGRESS'}")
        for s, c in statuses:
            print(f"     {s}: {c}")
        
        # Per-SDR
        per_sdr = conn.execute(text("""
            SELECT u.name, COUNT(l.id) as cnt
            FROM lead_assignments la
            JOIN leads l ON la.lead_id = l.id
            JOIN users u ON la.user_id = u.id
            WHERE l.sf_lead_id LIKE 'MIG-%'
            GROUP BY u.name ORDER BY cnt DESC
        """)).fetchall()
        print(f"\n   Per-SDR assignment:")
        for name, cnt in per_sdr:
            print(f"     {name}: {cnt}")
        
        # ── Phase 6: Calls ──
        call_count = conn.execute(text("""
            SELECT COUNT(*) FROM dialer_calls WHERE source = 'aircall_sync'
        """)).scalar()
        total_calls = conn.execute(text("SELECT COUNT(*) FROM dialer_calls")).scalar()
        
        date_range = conn.execute(text("""
            SELECT MIN(started_at), MAX(started_at) FROM dialer_calls WHERE source = 'aircall_sync'
        """)).fetchone()
        
        per_sdr_calls = conn.execute(text("""
            SELECT u.name, COUNT(dc.id)
            FROM dialer_calls dc
            JOIN users u ON dc.user_id = u.id
            WHERE dc.source = 'aircall_sync'
            GROUP BY u.name ORDER BY COUNT(dc.id) DESC
        """)).fetchall()
        
        print(f"\n📞 PHASE 6: Call Sync")
        print(f"   Migration calls synced: {call_count}")
        print(f"   Total calls in DB: {total_calls}")
        if date_range and date_range[0]:
            print(f"   Date range: {str(date_range[0])[:10]} → {str(date_range[1])[:10]}")
        
        print(f"\n   Per-SDR call records:")
        for name, cnt in per_sdr_calls:
            print(f"     {name}: {cnt}")
        
        # ── Data Quality ──
        bad_names = conn.execute(text("""
            SELECT COUNT(*) FROM leads 
            WHERE sf_lead_id LIKE 'MIG-%' 
            AND company IS NULL 
            AND (first_name LIKE 'USA%' OR first_name LIKE 'India%' OR first_name LIKE 'UK%')
        """)).scalar()
        no_company = conn.execute(text("""
            SELECT COUNT(*) FROM leads WHERE sf_lead_id LIKE 'MIG-%' AND company IS NULL
        """)).scalar()
        
        print(f"\n⚠️  DATA QUALITY")
        print(f"   Leads with sheet-tab name (no real name): {bad_names}")
        print(f"   Leads with no company: {no_company}")
        print(f"\n{'=' * 60}")

if __name__ == "__main__":
    main()
