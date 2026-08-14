#!/usr/bin/env python3
"""
Phase 5: Import Leads to RCM
====================================
Reads aircall_matched.csv and creates leads in the RCM database.

For each record:
  1. Create Lead with all enrichment fields
  2. Assign to the matched SDR (lead_assignments)
  3. Set status:
     - "Calling" if Aircall match found
     - "Lead Assigned" if no Aircall match
  4. Stamp research fields for Aircall-matched leads
  5. Create a migration note

Produces:
  - data/phase5_import_log.csv   (import results per record)
  - data/phase5_stats.json       (summary statistics)
"""

import csv, json, os, sys, uuid, re
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
BATCH_SIZE = 50


def get_db_url():
    if len(sys.argv) > 1:
        return sys.argv[1]
    return os.environ.get("DATABASE_URL", "")


def normalize_phone_digits(phone):
    if not phone:
        return None
    digits = re.sub(r'\D', '', str(phone))
    return digits if len(digits) >= 7 else None


def safe_int(val, default=None):
    try:
        return int(str(val).replace(',', '').strip()) if val else default
    except (ValueError, TypeError):
        return default


def main():
    print("=" * 60)
    print("PHASE 5: Import Leads to RCM")
    print("=" * 60)
    
    db_url = get_db_url()
    if not db_url:
        print("  ❌ No DATABASE_URL. Pass as CLI arg or env var.")
        sys.exit(1)
    
    from sqlalchemy import create_engine, text
    engine = create_engine(db_url)
    
    # Load Aircall-matched data
    input_path = os.path.join(DATA_DIR, "aircall_matched.csv")
    with open(input_path, 'r', encoding='utf-8') as f:
        records = list(csv.DictReader(f))
    
    print(f"\n  📊 Records to import: {len(records):,}")
    
    # Load SDR email → RCM user ID map
    with open(os.path.join(DATA_DIR, "sdr_email_map.json")) as f:
        sdr_map = json.load(f)
    
    # Build email → user_id + pod_id lookup
    with open(os.path.join(DATA_DIR, "rcm_users.json")) as f:
        ls_users = json.load(f)
    user_lookup = {}
    for u in ls_users:
        user_lookup[u["email"].lower()] = {
            "id": u["id"],
            "name": u["name"],
            "pod_id": u.get("pod_id"),
        }
    
    # Stats
    imported = 0
    skipped_dup = 0
    skipped_err = 0
    status_calling = 0
    status_assigned = 0
    reassigned_count = 0
    log_entries = []
    
    now_ts = datetime.now(timezone.utc).isoformat()
    
    print(f"\n  ⏳ Importing in batches of {BATCH_SIZE}...\n")
    
    conn = engine.connect()
    
    # Resume support: load already-imported lead phones to skip
    existing_mig = conn.execute(text(
        "SELECT phone FROM leads WHERE sf_lead_id LIKE 'MIG-%'"
    )).fetchall()
    already_imported = {r[0] for r in existing_mig if r[0]}
    conn.commit()  # Close autobegin from SELECT
    if already_imported:
        print(f"  🔄 Resume mode: {len(already_imported)} leads already imported, will skip\n")
    
    for batch_start in range(0, len(records), BATCH_SIZE):
        batch = records[batch_start:batch_start + BATCH_SIZE]
        tx = conn.begin()
        
        try:
            for record in batch:
                lead_id = str(uuid.uuid4())
                phone = record.get("phone", "").strip()
                
                # Skip if already imported (resume support)
                if phone and phone in already_imported:
                    skipped_dup += 1
                    continue
                
                sdr_email = record.get("assigned_sdr_email", "").strip().lower()
                user_info = user_lookup.get(sdr_email)
                
                if not user_info:
                    log_entries.append({
                        "status": "skipped", "reason": "no_sdr_match",
                        "email": record.get("email", ""), "phone": record.get("phone", ""),
                    })
                    skipped_err += 1
                    continue
                
                # ── Last-caller ownership ──
                # If Aircall shows who called this number LAST, that person
                # becomes the owner — regardless of what the sheet says.
                # This correctly handles SDR pod transfers.
                aircall_called = record.get("aircall_called", "no") == "yes"
                actual_sdr_email = sdr_email
                reassigned = False
                
                if aircall_called:
                    last_caller = record.get("last_caller_email", "").strip().lower()
                    last_caller_in_ls = str(record.get("last_caller_in_rcm", "")).lower() == "true"
                    
                    if last_caller and last_caller_in_ls:
                        caller_info = user_lookup.get(last_caller)
                        if caller_info:
                            if last_caller != sdr_email:
                                reassigned = True
                                reassigned_count += 1
                            actual_sdr_email = last_caller
                            user_info = caller_info
                
                # Determine status based on Aircall match
                lead_status = "Calling" if aircall_called else "Lead Assigned"
                
                if aircall_called:
                    status_calling += 1
                else:
                    status_assigned += 1
                
                # Research fields for Aircall-matched leads
                research_company = None
                research_contact = None
                research_hypothesis = None
                research_personalization = None
                
                if aircall_called:
                    caller_names = record.get("aircall_caller_names", "")
                    call_count = record.get("aircall_call_count", "0")
                    research_company = (
                        f"[Migration] Calling was done directly via Aircall. "
                        f"{call_count} call(s) recorded. "
                        f"Called by: {caller_names}. "
                        f"Migrated from Google Sheets on {now_ts[:10]}."
                    )
                    research_contact = "No research done - direct Aircall calling"
                    research_hypothesis = "No research done - direct Aircall calling"
                    research_personalization = "No research done - direct Aircall calling"
                
                # Build insert values
                phone_secondary = record.get("phone_secondary", "").strip() or None
                
                # Parse employee count
                emp = safe_int(record.get("employee_count"))
                
                # Insert lead
                conn.execute(text("""
                    INSERT INTO leads (
                        id, sf_lead_id, first_name, last_name, email, phone, phone_secondary,
                        company, title, status, lead_source, pod_id,
                        linkedin_url, person_linkedin, website,
                        city, state, country, industry,
                        employee_count, annual_revenue, total_funding,
                        company_phone, company_linkedin,
                        company_street, company_city, company_postal_code,
                        company_state, company_country, company_founded,
                        research_company, research_contact,
                        research_hypothesis, research_personalization,
                        times_called, priority_score,
                        created_at, status_changed_at, lead_started_at
                    ) VALUES (
                        :id, :sf_lead_id, :first_name, :last_name, :email, :phone, :phone_secondary,
                        :company, :title, :status, :lead_source, :pod_id,
                        :linkedin_url, :person_linkedin, :website,
                        :city, :state, :country, :industry,
                        :employee_count, :annual_revenue, :total_funding,
                        :company_phone, :company_linkedin,
                        :company_street, :company_city, :company_postal_code,
                        :company_state, :company_country, :company_founded,
                        :research_company, :research_contact,
                        :research_hypothesis, :research_personalization,
                        :times_called, :priority_score,
                        NOW(), NOW(), NOW()
                    )
                """), {
                    "id": lead_id,
                    "sf_lead_id": f"MIG-{lead_id[:8]}",
                    "first_name": record.get("first_name", "").strip() or None,
                    "last_name": record.get("last_name", "").strip() or "Unknown",
                    "email": record.get("email", "").strip() or None,
                    "phone": phone or None,
                    "phone_secondary": phone_secondary,
                    "company": record.get("company", "").strip() or None,
                    "title": record.get("title", "").strip() or None,
                    "status": lead_status,
                    "lead_source": "uploaded",
                    "pod_id": user_info.get("pod_id"),
                    "linkedin_url": record.get("linkedin_url", "").strip() or None,
                    "person_linkedin": record.get("linkedin_url", "").strip() or None,
                    "website": record.get("website", "").strip() or None,
                    "city": record.get("city", "").strip() or None,
                    "state": record.get("state", "").strip() or None,
                    "country": record.get("country", "").strip() or None,
                    "industry": record.get("industry", "").strip() or None,
                    "employee_count": emp,
                    "annual_revenue": record.get("annual_revenue", "").strip() or None,
                    "total_funding": record.get("total_funding", "").strip() or None,
                    "company_phone": record.get("company_phone", "").strip() or None,
                    "company_linkedin": record.get("company_linkedin", "").strip() or None,
                    "company_street": record.get("company_street", "").strip() or None,
                    "company_city": record.get("company_city", "").strip() or None,
                    "company_postal_code": record.get("company_postal_code", "").strip() or None,
                    "company_state": record.get("company_state", "").strip() or None,
                    "company_country": record.get("company_country", "").strip() or None,
                    "company_founded": record.get("company_founded", "").strip() or None,
                    "research_company": research_company,
                    "research_contact": research_contact,
                    "research_hypothesis": research_hypothesis,
                    "research_personalization": research_personalization,
                    "times_called": safe_int(record.get("aircall_call_count"), 0),
                    "priority_score": 100,
                })
                
                # Create lead assignment
                conn.execute(text("""
                    INSERT INTO lead_assignments (user_id, lead_id, assigned_at)
                    VALUES (:user_id, :lead_id, NOW())
                """), {"user_id": user_info["id"], "lead_id": lead_id})
                
                # Create status log entry
                conn.execute(text("""
                    INSERT INTO lead_status_logs (id, lead_id, from_status, to_status, changed_by, changed_at)
                    VALUES (:id, :lead_id, NULL, :to_status, :changed_by, NOW())
                """), {
                    "id": str(uuid.uuid4()),
                    "lead_id": lead_id,
                    "to_status": lead_status,
                    "changed_by": "migration_script",
                })
                
                # Create migration note
                source_sheet = record.get("source_sheet", "unknown")
                note_content = f"[Migration] Imported from {source_sheet}."
                if aircall_called:
                    note_content += (
                        f" Aircall verified: {record.get('aircall_call_count', 0)} calls, "
                        f"called by {record.get('aircall_caller_names', 'unknown')}."
                    )
                
                conn.execute(text("""
                    INSERT INTO notes (id, lead_id, content, author, created_at)
                    VALUES (:id, :lead_id, :content, :author, NOW())
                """), {
                    "id": str(uuid.uuid4()),
                    "lead_id": lead_id,
                    "content": note_content,
                    "author": "Migration Script",
                })
                
                imported += 1
                log_entries.append({
                    "status": "imported", "lead_id": lead_id,
                    "lead_status": lead_status,
                    "sheet_sdr": sdr_email, "actual_sdr": actual_sdr_email,
                    "reassigned": reassigned,
                    "phone": phone, "email": record.get("email", ""),
                })
            
            tx.commit()
            
            done = min(batch_start + BATCH_SIZE, len(records))
            pct = done / len(records) * 100
            print(f"  [{done:>5}/{len(records)}] {pct:5.1f}% | Imported: {imported} | Calling: {status_calling} | Assigned: {status_assigned}")
        
        except Exception as e:
            tx.rollback()
            print(f"  ❌ Batch error at row {batch_start}: {e}")
            for record in batch:
                log_entries.append({
                    "status": "error", "reason": str(e)[:100],
                    "email": record.get("email", ""), "phone": record.get("phone", ""),
                })
                skipped_err += 1
    
    conn.close()
    
    # Write import log
    log_path = os.path.join(DATA_DIR, "phase5_import_log.csv")
    if log_entries:
        with open(log_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=log_entries[0].keys())
            writer.writeheader()
            writer.writerows(log_entries)
    
    # Write stats
    stats = {
        "total_records": len(records),
        "imported": imported,
        "status_calling": status_calling,
        "status_lead_assigned": status_assigned,
        "skipped_no_sdr": skipped_err,
        "skipped_duplicate": skipped_dup,
    }
    with open(os.path.join(DATA_DIR, "phase5_stats.json"), 'w') as f:
        json.dump(stats, f, indent=2)
    
    print("\n" + "=" * 60)
    print("PHASE 5 COMPLETE")
    print("=" * 60)
    print(f"  ✅ Imported:       {imported:,}")
    print(f"  📞 Status=Calling: {status_calling:,} (Aircall verified)")
    print(f"  📋 Status=Assigned:{status_assigned:,} (no Aircall match)")
    print(f"  🔄 Reassigned:     {reassigned_count:,} (Aircall caller ≠ sheet SDR)")
    print(f"  ❌ Skipped/errors: {skipped_err:,}")
    print(f"\n  Log: {log_path}")
    print(f"  Next: Run phase6_sync_calls.py (or trigger /admin/dialer/sync-historical)")


if __name__ == "__main__":
    main()
