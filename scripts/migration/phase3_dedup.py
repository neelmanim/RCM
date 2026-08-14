#!/usr/bin/env python3
"""
Phase 3: Deduplicate
====================
Deduplicates normalized_filtered.csv using the same 4-tier logic as
RCM's Upload Center:
  1. Email match (case-insensitive)
  2. LinkedIn URL match 
  3. Phone match (last 10 digits)
  4. Name + Company match (case-insensitive)

Then checks against existing RCM DB to skip records already present.

Produces:
  - data/deduped_final.csv        (unique records to import)
  - data/duplicates_report.csv    (skipped duplicates with reasons)
  - data/phase3_stats.json        (dedup statistics)
"""

import csv, json, os, re, sys

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")


def normalize_phone_digits(phone):
    """Extract last 10 digits for matching."""
    if not phone:
        return None
    digits = re.sub(r'\D', '', str(phone))
    if len(digits) < 7:
        return None
    return digits[-10:]


def normalize_linkedin(url):
    """Normalize LinkedIn URL for matching."""
    if not url:
        return None
    url = url.strip().rstrip('/').lower()
    # Remove query params
    url = url.split('?')[0]
    return url if 'linkedin' in url else None


def load_existing_leads_from_db(db_url):
    """Load existing leads from RCM DB for cross-dedup."""
    try:
        from sqlalchemy import create_engine, text
        engine = create_engine(db_url)
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT id, email, phone, linkedin_url, person_linkedin, "
                "first_name, last_name, company FROM leads"
            )).fetchall()
        
        existing = {
            "emails": set(),
            "phones": set(),
            "linkedins": set(),
            "name_company": set(),
        }
        
        for r in rows:
            _, email, phone, linkedin, person_linkedin, first, last, company = r
            if email:
                existing["emails"].add(email.strip().lower())
            if phone:
                pd = normalize_phone_digits(phone)
                if pd:
                    existing["phones"].add(pd)
            for li in [linkedin, person_linkedin]:
                norm = normalize_linkedin(li)
                if norm:
                    existing["linkedins"].add(norm)
            if first and last and company:
                key = f"{first.strip().lower()}|{last.strip().lower()}|{company.strip().lower()}"
                existing["name_company"].add(key)
        
        return existing, len(rows)
    except Exception as e:
        print(f"  ⚠️  Could not load existing leads from DB: {e}")
        return None, 0


def main():
    print("=" * 60)
    print("PHASE 3: Deduplicate")
    print("=" * 60)
    
    # Load normalized data
    input_path = os.path.join(DATA_DIR, "normalized_filtered.csv")
    with open(input_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        records = list(reader)
    
    print(f"\n  📊 Input records: {len(records):,}")
    
    # Load existing leads from DB (for cross-dedup)
    db_url = None
    if len(sys.argv) > 1:
        db_url = sys.argv[1]
    if not db_url:
        db_url = os.environ.get("DATABASE_URL", "")
    
    existing = None
    existing_count = 0
    if db_url:
        print("\n  🔍 Loading existing RCM leads for cross-dedup...")
        existing, existing_count = load_existing_leads_from_db(db_url)
        if existing:
            print(f"  ✅ {existing_count:,} existing leads loaded")
            print(f"     Emails: {len(existing['emails']):,}, Phones: {len(existing['phones']):,}")
    else:
        print("\n  ⚠️  No DATABASE_URL — skipping cross-dedup against existing DB")
    
    # ── Dedup pass ──
    print("\n  🔄 Running 4-tier deduplication...")
    
    seen_emails = set()
    seen_phones = set()
    seen_linkedins = set()
    seen_name_company = set()
    
    # Pre-populate with existing DB data
    if existing:
        seen_emails = set(existing["emails"])
        seen_phones = set(existing["phones"])
        seen_linkedins = set(existing["linkedins"])
        seen_name_company = set(existing["name_company"])
    
    unique_records = []
    duplicates = []
    
    db_dup_count = 0
    csv_dup_count = 0
    
    for record in records:
        email = (record.get("email") or "").strip().lower()
        phone = record.get("phone", "")
        phone_digits = normalize_phone_digits(phone)
        linkedin = normalize_linkedin(record.get("linkedin_url", ""))
        first = (record.get("first_name") or "").strip().lower()
        last = (record.get("last_name") or "").strip().lower()
        company = (record.get("company") or "").strip().lower()
        
        dup_reason = None
        is_db_dup = False
        
        # 1) Email match
        if email and email in seen_emails:
            dup_reason = f"email: {email}"
            is_db_dup = existing and email in existing.get("emails", set())
        
        # 2) LinkedIn match
        if not dup_reason and linkedin and linkedin in seen_linkedins:
            dup_reason = f"linkedin: {linkedin}"
            is_db_dup = existing and linkedin in existing.get("linkedins", set())
        
        # 3) Phone match
        if not dup_reason and phone_digits and phone_digits in seen_phones:
            dup_reason = f"phone: {phone} (digits: {phone_digits})"
            is_db_dup = existing and phone_digits in existing.get("phones", set())
        
        # 4) Name + Company match
        if not dup_reason and first and last and company:
            name_co_key = f"{first}|{last}|{company}"
            if name_co_key in seen_name_company:
                dup_reason = f"name+company: {first} {last} @ {company}"
                is_db_dup = existing and name_co_key in existing.get("name_company", set())
        
        if dup_reason:
            dup_type = "existing_db" if is_db_dup else "cross_sheet"
            duplicates.append({
                **record,
                "dup_reason": dup_reason,
                "dup_type": dup_type,
            })
            if is_db_dup:
                db_dup_count += 1
            else:
                csv_dup_count += 1
            continue
        
        # Track this record
        if email:
            seen_emails.add(email)
        if phone_digits:
            seen_phones.add(phone_digits)
        if linkedin:
            seen_linkedins.add(linkedin)
        if first and last and company:
            seen_name_company.add(f"{first}|{last}|{company}")
        
        unique_records.append(record)
    
    # Write outputs
    output_path = os.path.join(DATA_DIR, "deduped_final.csv")
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        if unique_records:
            writer = csv.DictWriter(f, fieldnames=unique_records[0].keys())
            writer.writeheader()
            writer.writerows(unique_records)
    
    dup_path = os.path.join(DATA_DIR, "duplicates_report.csv")
    with open(dup_path, 'w', newline='', encoding='utf-8') as f:
        if duplicates:
            writer = csv.DictWriter(f, fieldnames=duplicates[0].keys())
            writer.writeheader()
            writer.writerows(duplicates)
    
    # Stats
    stats = {
        "input_records": len(records),
        "unique_records": len(unique_records),
        "total_duplicates": len(duplicates),
        "db_duplicates": db_dup_count,
        "cross_sheet_duplicates": csv_dup_count,
        "existing_db_leads": existing_count,
    }
    with open(os.path.join(DATA_DIR, "phase3_stats.json"), 'w') as f:
        json.dump(stats, f, indent=2)
    
    # SDR distribution after dedup
    sdr_dist = {}
    for r in unique_records:
        email = r["assigned_sdr_email"]
        sdr_dist[email] = sdr_dist.get(email, 0) + 1
    
    print("\n" + "=" * 60)
    print("PHASE 3 COMPLETE")
    print("=" * 60)
    print(f"  📊 Input records:         {len(records):,}")
    print(f"  ✅ Unique (to import):     {len(unique_records):,}")
    print(f"  ❌ Cross-sheet duplicates: {csv_dup_count:,}")
    print(f"  ❌ Already in RCM:   {db_dup_count:,}")
    print(f"  📋 SDR Distribution (post-dedup):")
    for email, count in sorted(sdr_dist.items(), key=lambda x: -x[1]):
        print(f"     {email:<45} {count:>5}")
    
    print(f"\n  Output: {output_path}")
    print(f"  Dups:   {dup_path}")
    print(f"  Next: Run phase4_aircall.py")


if __name__ == "__main__":
    main()
