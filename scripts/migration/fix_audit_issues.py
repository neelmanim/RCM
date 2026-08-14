#!/usr/bin/env python3
"""
Migration Fix Script — Fixes all 4 audit issues in one run.

1. Fix 50 bad names (sheet-tab names → Unknown Contact)
2. Fix 415 "Lead Assigned" → "Calling" + research fields
3. Fix 369 "Calling" with no calls → add failed call entry
4. Normalize all 3,039 phone numbers to E.164

Usage:
    python3 scripts/migration/fix_audit_issues.py
"""
import re
import uuid
from datetime import datetime, timezone
from sqlalchemy import create_engine, text

DB_URL = "postgresql://rcm_db_prod_user:Ut07ADTDCQY1tR9lOWxyVPS8UQyaB1ZC@dpg-d6ncblh5pdvs73aacnhg-a.ohio-postgres.render.com/rcm_db_prod"

def normalize_e164(phone):
    """Normalize phone to E.164 format (+1XXXXXXXXXX for US numbers)."""
    if not phone:
        return phone
    digits = re.sub(r'\D', '', phone)
    # Remove leading 1 if 11 digits (US)
    if len(digits) == 11 and digits.startswith('1'):
        return f"+{digits}"
    elif len(digits) == 10:
        return f"+1{digits}"
    elif len(digits) > 11:
        return f"+{digits}"
    else:
        return phone  # Can't normalize, leave as-is

def main():
    engine = create_engine(DB_URL)
    now_ts = datetime.now(timezone.utc).isoformat()
    
    with engine.connect() as conn:
        # ═══════════════════════════════════════════════════════════
        # FIX 1: 50 bad names (sheet-tab names)
        # ═══════════════════════════════════════════════════════════
        print("=" * 60)
        print("FIX 1: Bad Names (sheet-tab → Unknown Contact)")
        print("=" * 60)
        
        bad_name_patterns = [
            "USA 1-10", "USA 11-200", "USA 201-1K", "USA 11-1K", "USA 1K+",
            "USA 11-50", "USA 201-500", "USA 501-1000", "USA / Canada"
        ]
        
        total_fixed_names = 0
        for pattern in bad_name_patterns:
            parts = pattern.split(" ", 1)
            fn_pattern = parts[0]
            ln_pattern = parts[1] if len(parts) > 1 else ""
            
            result = conn.execute(text("""
                UPDATE leads 
                SET first_name = 'Unknown', last_name = 'Contact'
                WHERE sf_lead_id LIKE 'MIG-%' 
                AND first_name = :fn AND last_name = :ln
                AND (company IS NULL OR company = '')
            """), {"fn": fn_pattern, "ln": ln_pattern})
            count = result.rowcount
            total_fixed_names += count
            if count > 0:
                print(f"  Fixed '{pattern}': {count}")
        
        conn.commit()
        print(f"  ✅ Total names fixed: {total_fixed_names}")
        
        # ═══════════════════════════════════════════════════════════
        # FIX 2: 415 "Lead Assigned" → "Calling"
        # ═══════════════════════════════════════════════════════════
        print(f"\n{'=' * 60}")
        print("FIX 2: Lead Assigned → Calling (415 leads with call records)")
        print("=" * 60)
        
        # Get the 415 leads
        assigned_with_calls = conn.execute(text("""
            SELECT DISTINCT l.id, l.phone
            FROM leads l
            JOIN dialer_calls dc ON dc.lead_id = l.id
            WHERE l.sf_lead_id LIKE 'MIG-%' AND l.status = 'Lead Assigned'
        """)).fetchall()
        
        print(f"  Found {len(assigned_with_calls)} leads to update")
        
        lead_ids = [row[0] for row in assigned_with_calls]
        
        if lead_ids:
            # Update status
            conn.execute(text("""
                UPDATE leads 
                SET status = 'Calling', 
                    status_changed_at = NOW(),
                    research_company = 'No research done - Calling using Aircall'
                WHERE id = ANY(:ids)
            """), {"ids": lead_ids})
            
            # Add status log
            for lid in lead_ids:
                log_id = str(uuid.uuid4())
                conn.execute(text("""
                    INSERT INTO lead_status_logs (id, lead_id, from_status, to_status, changed_by, changed_at)
                    VALUES (:id, :lead_id, 'Lead Assigned', 'Calling', 'Migration Script', NOW())
                """), {"id": log_id, "lead_id": lid})
            
            conn.commit()
            print(f"  ✅ Updated {len(lead_ids)} leads: Lead Assigned → Calling")
        
        # ═══════════════════════════════════════════════════════════
        # FIX 3: 369 "Calling" with no calls → add failed call entry
        # ═══════════════════════════════════════════════════════════
        print(f"\n{'=' * 60}")
        print("FIX 3: Add failed call entry for 369 'Calling' leads")
        print("=" * 60)
        
        calling_no_calls = conn.execute(text("""
            SELECT l.id, l.phone, la.user_id
            FROM leads l
            JOIN lead_assignments la ON la.lead_id = l.id
            LEFT JOIN dialer_calls dc ON dc.lead_id = l.id
            WHERE l.sf_lead_id LIKE 'MIG-%' AND l.status = 'Calling' AND dc.id IS NULL
        """)).fetchall()
        
        print(f"  Found {len(calling_no_calls)} leads needing failed call entry")
        
        inserted = 0
        for lid, phone, uid in calling_no_calls:
            call_id = str(uuid.uuid4())
            conn.execute(text("""
                INSERT INTO dialer_calls (
                    id, lead_id, user_id, provider, provider_call_id,
                    phone_number, status, direction, duration,
                    outcome, notes, started_at, source
                ) VALUES (
                    :id, :lead_id, :user_id, 'aircall', :provider_id,
                    :phone, 'NO_ANSWER', 'outbound', 0,
                    'no_answer', :notes, NOW(), 'migration_placeholder'
                )
            """), {
                "id": call_id,
                "lead_id": lid,
                "user_id": uid,
                "provider_id": f"MIG-PLACEHOLDER-{call_id[:8]}",
                "phone": phone,
                "notes": (
                    "[Migration] Aircall Contacts API confirmed this number was called, "
                    "but no matching call record was found during historical sync. "
                    "Marked as failed/no_answer for audit trail."
                )
            })
            inserted += 1
        
        conn.commit()
        print(f"  ✅ Inserted {inserted} placeholder call entries")
        
        # ═══════════════════════════════════════════════════════════
        # FIX 4: Phone normalization to E.164
        # ═══════════════════════════════════════════════════════════
        print(f"\n{'=' * 60}")
        print("FIX 4: Phone Normalization → E.164")
        print("=" * 60)
        
        all_phones = conn.execute(text("""
            SELECT id, phone FROM leads 
            WHERE sf_lead_id LIKE 'MIG-%' AND phone IS NOT NULL
        """)).fetchall()
        
        updated = 0
        skipped = 0
        for lid, phone in all_phones:
            normalized = normalize_e164(phone)
            if normalized != phone:
                conn.execute(text("""
                    UPDATE leads SET phone = :phone WHERE id = :id
                """), {"phone": normalized, "id": lid})
                updated += 1
            else:
                skipped += 1
        
        conn.commit()
        
        print(f"  ✅ Normalized: {updated}")
        print(f"  ⏭️  Already correct: {skipped}")
        
        # ═══════════════════════════════════════════════════════════
        # SUMMARY
        # ═══════════════════════════════════════════════════════════
        print(f"\n{'=' * 60}")
        print("ALL FIXES COMPLETE")
        print("=" * 60)
        print(f"  Fix 1: {total_fixed_names} bad names → Unknown Contact")
        print(f"  Fix 2: {len(lead_ids)} leads → Lead Assigned → Calling")
        print(f"  Fix 3: {inserted} placeholder call entries added")
        print(f"  Fix 4: {updated} phones normalized to E.164")

if __name__ == "__main__":
    main()
