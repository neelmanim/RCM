#!/usr/bin/env python3
"""
Phase 2: Normalize & Filter
============================
Reads all 12 raw CSVs, normalizes to a unified schema, and filters out:
  - Rows with no phone number
  - Rows whose assigned SDR is NOT in RCM
  
Produces:
  - data/normalized_filtered.csv   (clean, unified records)
  - data/phase2_stats.json         (per-sheet statistics)
"""

import csv, json, os, re, sys

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
RAW_DIR = os.path.join(DATA_DIR, "raw")

# Unified output schema
OUTPUT_FIELDS = [
    "first_name", "last_name", "email", "phone", "phone_secondary",
    "company", "title", "city", "state", "country", "industry",
    "linkedin_url", "employee_count", "annual_revenue", "total_funding",
    "company_phone", "company_linkedin", "company_street", "company_city",
    "company_postal_code", "company_state", "company_country", "company_founded",
    "website", "notes", "source_sheet", "source_row", "assigned_sdr_email",
]


def load_json(filename):
    with open(os.path.join(DATA_DIR, filename)) as f:
        return json.load(f)


def normalize_phone(raw):
    """Strip formatting, keep only digits. Return None if too short."""
    if not raw:
        return None
    digits = re.sub(r'\D', '', str(raw))
    if len(digits) < 7:
        return None
    # If starts with leading 0 and is exactly 10 digits, might be local — keep as is
    # Store as-is (with country code if present)
    return digits


def split_name(full_name):
    """Split 'First Last' into (first, last). Handles single-word names."""
    if not full_name:
        return ("", "")
    parts = str(full_name).strip().split(None, 1)
    if len(parts) == 1:
        return (parts[0], parts[0])
    return (parts[0], parts[1])


def find_best_phone(row, phone_cols):
    """Try multiple phone columns, return first valid one + secondary."""
    primary = None
    secondary = None
    for col in phone_cols:
        val = row.get(col, "").strip()
        phone = normalize_phone(val)
        if phone:
            if not primary:
                primary = val.strip()
            elif not secondary:
                secondary = val.strip()
    return primary, secondary


def get_col(row, candidates, default=""):
    """Get value from first matching column name (case-insensitive)."""
    row_lower = {k.strip().lower(): v for k, v in row.items()}
    for c in candidates:
        val = row_lower.get(c.lower(), "").strip()
        if val:
            return val
    return default


def normalize_sheet_01(rows, name_map):
    """Scanner events: FIRSTNAME, LASTNAME, PHONE, EMAIL, etc."""
    results = []
    for i, row in enumerate(rows, 2):
        sdr_name = list(row.values())[0].strip().lower() if row else ""
        sdr_email = name_map.get(sdr_name, "")
        
        phone = get_col(row, ["PHONE", "Phone"])
        if not normalize_phone(phone):
            continue
        if not sdr_email:
            continue
            
        results.append({
            "first_name": get_col(row, ["FIRSTNAME", "First Name"]),
            "last_name": get_col(row, ["LASTNAME", "Last Name"]),
            "email": get_col(row, ["EMAIL", "Email"]),
            "phone": phone,
            "phone_secondary": "",
            "company": get_col(row, ["COMPANYNAME", "Company"]),
            "title": get_col(row, ["JOBTITLE", "Title"]),
            "city": get_col(row, ["CITY", "City"]),
            "state": get_col(row, ["STATE", "State"]),
            "country": get_col(row, ["COUNTRY", "Country"]),
            "industry": "",
            "linkedin_url": "",
            "employee_count": "",
            "annual_revenue": "",
            "total_funding": "",
            "company_phone": "",
            "company_linkedin": "",
            "company_street": "",
            "company_city": "",
            "company_postal_code": "",
            "company_state": "",
            "company_country": "",
            "company_founded": "",
            "website": "",
            "notes": get_col(row, ["NOTES", "Notes", "Context"]),
            "source_sheet": "01_scanner_events",
            "source_row": i,
            "assigned_sdr_email": sdr_email,
        })
    return results


def normalize_sheet_02(rows, name_map):
    """Apollo enriched: Assigned To, First Name, Last Name, Work Direct Phone, etc."""
    results = []
    for i, row in enumerate(rows, 2):
        sdr_name = get_col(row, ["Assigned To"]).strip().lower()
        sdr_email = name_map.get(sdr_name, "")
        
        phone, phone2 = find_best_phone(row, [
            "Work Direct Phone", "Mobile Phone", "Corporate Phone", "Home Phone"
        ])
        if not phone:
            continue
        if not sdr_email:
            continue
            
        results.append({
            "first_name": get_col(row, ["First Name"]),
            "last_name": get_col(row, ["Last Name"]),
            "email": get_col(row, ["Email"]),
            "phone": phone,
            "phone_secondary": phone2 or "",
            "company": get_col(row, ["Company Name"]),
            "title": get_col(row, ["Title"]),
            "city": get_col(row, ["City", "Company City"]),
            "state": get_col(row, ["State", "Company State"]),
            "country": get_col(row, ["Country", "Company Country"]),
            "industry": get_col(row, ["Industry"]),
            "linkedin_url": get_col(row, ["Person Linkedin Url"]),
            "employee_count": get_col(row, ["# Employees"]),
            "annual_revenue": get_col(row, ["Annual Revenue"]),
            "total_funding": get_col(row, ["Total Funding"]),
            "company_phone": get_col(row, ["Company Phone"]),
            "company_linkedin": get_col(row, ["Company Linkedin Url"]),
            "company_street": get_col(row, ["Company Street"]),
            "company_city": get_col(row, ["Company City"]),
            "company_postal_code": get_col(row, ["Company Postal Code"]),
            "company_state": get_col(row, ["Company State"]),
            "company_country": get_col(row, ["Company Country"]),
            "company_founded": get_col(row, ["Company Founded Year"]),
            "website": get_col(row, ["Website"]),
            "notes": get_col(row, ["Comments", "Context"]),
            "source_sheet": "02_apollo_enriched",
            "source_row": i,
            "assigned_sdr_email": sdr_email,
        })
    return results


def normalize_sheet_03(rows, name_map):
    """SF Export (Tanya): Column A = SDR name, Phone, Mobile, etc."""
    results = []
    for i, row in enumerate(rows, 2):
        sdr_name = list(row.values())[0].strip().lower() if row else ""
        sdr_email = name_map.get(sdr_name, "")
        
        phone, phone2 = find_best_phone(row, ["Phone", "Mobile", "Fax"])
        if not phone:
            continue
        if not sdr_email:
            continue
            
        first = get_col(row, ["First Name"])
        last = get_col(row, ["Last Name"])
        if not first:
            full = get_col(row, ["Full Name", "Name"])
            first, last = split_name(full) if full else (first, last)
            
        results.append({
            "first_name": first,
            "last_name": last,
            "email": get_col(row, ["Email"]),
            "phone": phone,
            "phone_secondary": phone2 or "",
            "company": get_col(row, ["Company", "Company Name", "Account Name"]),
            "title": get_col(row, ["Title", "Job Title"]),
            "city": get_col(row, ["City"]),
            "state": get_col(row, ["State"]),
            "country": get_col(row, ["Country"]),
            "industry": get_col(row, ["Industry"]),
            "linkedin_url": get_col(row, ["Person Linkedin Url", "LinkedIn", "LinkedIn Search"]),
            "employee_count": "",
            "annual_revenue": "",
            "total_funding": "",
            "company_phone": "",
            "company_linkedin": "",
            "company_street": get_col(row, ["Street"]),
            "company_city": "",
            "company_postal_code": get_col(row, ["Postal Code"]),
            "company_state": "",
            "company_country": "",
            "company_founded": "",
            "website": "",
            "notes": get_col(row, ["Comments", "Context", "Notes"]),
            "source_sheet": "03_sf_export_tanya",
            "source_row": i,
            "assigned_sdr_email": sdr_email,
        })
    return results


def normalize_generic_sdr_col_a(rows, name_map, sheet_name):
    """Generic normalizer for sheets where SDR name is in column A (index 0)."""
    results = []
    for i, row in enumerate(rows, 2):
        vals = list(row.values())
        sdr_name = vals[0].strip().lower() if vals else ""
        sdr_email = name_map.get(sdr_name, "")
        
        phone, phone2 = find_best_phone(row, [
            "Phone", "phone", "Mobile Phone 1", "Enriched Work Direct Phone",
            "Enriched Mobile Phone", "Enriched Corporate Phone", "Enriched Home Phone",
            "Enriched Other Phone", "Work Direct Phone", "Mobile Phone", "Corporate Phone",
            "Home Phone", "Phone Number", "Phone number"
        ])
        if not phone:
            continue
        if not sdr_email:
            continue
            
        first = get_col(row, ["First Name", "FIRSTNAME", "First Name.1"])
        last = get_col(row, ["Last Name", "LASTNAME", "Last Name.1"])
        if not first:
            full = get_col(row, ["Full Name", "Name", "Lead Name", "Contact"])
            if full:
                first, last = split_name(full)
            
        results.append({
            "first_name": first,
            "last_name": last,
            "email": get_col(row, ["Email", "email", "EMAIL", "Email ID"]),
            "phone": phone,
            "phone_secondary": phone2 or "",
            "company": get_col(row, ["Company", "Company Name", "Company Name.1"]),
            "title": get_col(row, ["Title", "Designation", "Job Title", "Title.1", "JOBTITLE"]),
            "city": get_col(row, ["City", "CITY", "Company City"]),
            "state": get_col(row, ["State", "STATE", "Company State"]),
            "country": get_col(row, ["Country", "COUNTRY", "Company Country"]),
            "industry": get_col(row, ["Industry"]),
            "linkedin_url": get_col(row, [
                "LinkedIn", "Person Linkedin Url", "Person Linkedin",
                "LinkedIn Search", "linkedin", "LINKEDIN"
            ]),
            "employee_count": get_col(row, ["# Employees", "Emp Size", "Employee Size"]),
            "annual_revenue": get_col(row, ["Annual Revenue"]),
            "total_funding": get_col(row, ["Total Funding"]),
            "company_phone": get_col(row, ["Company Phone"]),
            "company_linkedin": get_col(row, ["Company Linkedin Url"]),
            "company_street": get_col(row, ["Company Street", "Street"]),
            "company_city": get_col(row, ["Company City"]),
            "company_postal_code": get_col(row, ["Company Postal Code", "Postal Code", "ZIP"]),
            "company_state": get_col(row, ["Company State"]),
            "company_country": get_col(row, ["Company Country"]),
            "company_founded": get_col(row, ["Company Founded Year"]),
            "website": get_col(row, ["Website"]),
            "notes": get_col(row, ["Comments", "Context", "Notes", "Call Notes", "Booth Notes", "NOTES"]),
            "source_sheet": sheet_name,
            "source_row": i,
            "assigned_sdr_email": sdr_email,
        })
    return results


def normalize_generic_named_sdr(rows, name_map, sheet_name, sdr_col_name):
    """Generic normalizer where SDR name is in a named column."""
    results = []
    for i, row in enumerate(rows, 2):
        sdr_name = get_col(row, [sdr_col_name]).strip().lower()
        sdr_email = name_map.get(sdr_name, "")
        
        phone, phone2 = find_best_phone(row, [
            "Phone", "phone", "Mobile Phone 1", "Enriched Work Direct Phone",
            "Enriched Mobile Phone", "Enriched Corporate Phone", "Enriched Home Phone",
            "Enriched Other Phone", "Work Direct Phone", "Mobile Phone", "Corporate Phone",
            "Home Phone", "Phone Number", "Phone number"
        ])
        if not phone:
            continue
        if not sdr_email:
            continue
            
        first = get_col(row, ["First Name", "FIRSTNAME", "First Name.1"])
        last = get_col(row, ["Last Name", "LASTNAME", "Last Name.1"])
        if not first:
            full = get_col(row, ["Full Name", "Name", "Lead Name", "Contact", "Contact Name"])
            if full:
                first, last = split_name(full)
            
        results.append({
            "first_name": first,
            "last_name": last,
            "email": get_col(row, ["Email", "email", "EMAIL", "Email ID"]),
            "phone": phone,
            "phone_secondary": phone2 or "",
            "company": get_col(row, ["Company", "Company Name", "Company Name.1", "Account Name"]),
            "title": get_col(row, ["Title", "Designation", "Job Title", "Title.1", "JOBTITLE"]),
            "city": get_col(row, ["City", "CITY", "Company City"]),
            "state": get_col(row, ["State", "STATE", "Company State"]),
            "country": get_col(row, ["Country", "COUNTRY", "Company Country"]),
            "industry": get_col(row, ["Industry"]),
            "linkedin_url": get_col(row, [
                "LinkedIn", "Person Linkedin Url", "Person Linkedin",
                "LinkedIn Search", "linkedin", "LINKEDIN"
            ]),
            "employee_count": get_col(row, ["# Employees", "Emp Size", "Employee Size"]),
            "annual_revenue": get_col(row, ["Annual Revenue"]),
            "total_funding": get_col(row, ["Total Funding"]),
            "company_phone": get_col(row, ["Company Phone"]),
            "company_linkedin": get_col(row, ["Company Linkedin Url"]),
            "company_street": get_col(row, ["Company Street", "Street", "Company Address"]),
            "company_city": get_col(row, ["Company City"]),
            "company_postal_code": get_col(row, ["Company Postal Code", "Postal Code", "ZIP"]),
            "company_state": get_col(row, ["Company State"]),
            "company_country": get_col(row, ["Company Country"]),
            "company_founded": get_col(row, ["Company Founded Year"]),
            "website": get_col(row, ["Website"]),
            "notes": get_col(row, [
                "Comments", "Context", "Notes", "Call Notes", "Booth Notes",
                "NOTES", "Comment", "Existing Engagement"
            ]),
            "source_sheet": sheet_name,
            "source_row": i,
            "assigned_sdr_email": sdr_email,
        })
    return results


def read_csv_rows(filename):
    """Read a CSV file and return list of dicts, handling BOM and encoding issues."""
    filepath = os.path.join(RAW_DIR, filename)
    if not os.path.exists(filepath):
        return []
    with open(filepath, 'r', encoding='utf-8-sig', errors='replace') as f:
        reader = csv.DictReader(f)
        return list(reader)


# ── Sheet-specific normalizer configuration ──
SHEET_CONFIG = [
    # (filename, normalizer_type, extra_args)
    ("01_scanner_events.csv",    "col_a",   None),
    ("02_apollo_enriched.csv",   "named",   "Assigned To"),
    ("03_sf_export_tanya.csv",   "col_a",   None),
    ("04_mixed_gauri.csv",       "col_a",   None),
    ("05_enriched_outbound.csv", "named",   "Assigned SDR"),
    ("06_rcm_tier.csv",   "named",   "SDR"),
    ("07_event_gauri.csv",       "named",   "Assigned to"),
    ("08_fresh_outbound.csv",    "named",   "Assigned SDR"),
    ("09_sql_won_tracker.csv",   "named",   "Meeting Set By"),
    ("10_himanshu_batch.csv",    "col_a",   None),
    # Sheet 11 (master merged) processed LAST — intentional
    ("12_drift_salesloft.csv",   "named",   "Assigned SDR"),
    ("11_master_merged.csv",     "named",   "Assigned SDR"),  # LAST
]


def main():
    print("=" * 60)
    print("PHASE 2: Normalize & Filter")
    print("=" * 60)
    
    # Load SDR maps from Phase 1
    name_map = load_json("sheet_sdr_name_map.json")
    sdr_map = load_json("sdr_email_map.json")
    
    print(f"\n  🗺️  {len(sdr_map)} matched SDRs loaded")
    print(f"  🔤 {len(name_map)} name→email mappings loaded")
    
    all_records = []
    stats = []
    
    for filename, norm_type, extra in SHEET_CONFIG:
        sheet_name = filename.replace(".csv", "")
        print(f"\n  📄 Processing {sheet_name}...", end="", flush=True)
        
        rows = read_csv_rows(filename)
        raw_count = len(rows)
        
        if norm_type == "col_a":
            if sheet_name == "01_scanner_events":
                records = normalize_sheet_01(rows, name_map)
            elif sheet_name == "02_apollo_enriched":
                records = normalize_sheet_02(rows, name_map)
            elif sheet_name == "03_sf_export_tanya":
                records = normalize_sheet_03(rows, name_map)
            else:
                records = normalize_generic_sdr_col_a(rows, name_map, sheet_name)
        elif norm_type == "named":
            records = normalize_generic_named_sdr(rows, name_map, sheet_name, extra)
        else:
            records = []
        
        kept = len(records)
        skipped = raw_count - kept
        all_records.extend(records)
        
        stat = {
            "sheet": sheet_name, "raw": raw_count, "kept": kept,
            "skipped_no_phone": 0, "skipped_no_sdr": 0, "skipped_total": skipped
        }
        stats.append(stat)
        print(f" {raw_count} raw → {kept} kept ({skipped} filtered)")
    
    # Write normalized CSV
    output_path = os.path.join(DATA_DIR, "normalized_filtered.csv")
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()
        writer.writerows(all_records)
    
    # Write stats
    with open(os.path.join(DATA_DIR, "phase2_stats.json"), 'w') as f:
        json.dump(stats, f, indent=2)
    
    total_raw = sum(s["raw"] for s in stats)
    total_kept = sum(s["kept"] for s in stats)
    
    # SDR distribution
    sdr_dist = {}
    for r in all_records:
        email = r["assigned_sdr_email"]
        sdr_dist[email] = sdr_dist.get(email, 0) + 1
    
    print("\n" + "=" * 60)
    print("PHASE 2 COMPLETE")
    print("=" * 60)
    print(f"  📊 Total raw rows:       {total_raw:,}")
    print(f"  ✅ Kept (with phone+SDR): {total_kept:,}")
    print(f"  ❌ Filtered out:          {total_raw - total_kept:,}")
    print(f"\n  📋 SDR Distribution:")
    for email, count in sorted(sdr_dist.items(), key=lambda x: -x[1]):
        name = sdr_map.get(email, {}).get("aircall_name", email)
        print(f"     {name:<30} {count:>5}")
    
    print(f"\n  Output: {output_path}")
    print(f"  Next: Run phase3_dedup.py")


if __name__ == "__main__":
    main()
