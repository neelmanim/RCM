#!/usr/bin/env python3
"""
Phase 1: Download Google Sheets + Build SDR Email Map
=====================================================
Downloads all 12 sheets as CSV, fetches Aircall users, and produces:
  - data/raw/*.csv                (12 raw CSV files)
  - data/aircall_users.json       (all Aircall users)
  - data/rcm_users.json     (all RCM users — from prod DB)
  - data/sdr_email_map.json       (matched SDRs: email → {aircall_id, rcm_id, name, pod})
  - data/sheet_sdr_name_map.json  (sheet SDR name → canonical email)
"""

import csv, json, os, sys, time, io, re
import urllib.request, urllib.error, base64

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
RAW_DIR = os.path.join(DATA_DIR, "raw")

# ── Sheet definitions ──────────────────────────────────────────────────────
SHEETS = [
    # Spreadsheet A: 1BFG9Bnc--8gEOUSso7GUoUtdmBTK2z1qj3_o2UG-Lgo
    {"id": "1BFG9Bnc--8gEOUSso7GUoUtdmBTK2z1qj3_o2UG-Lgo", "gid": "0",
     "name": "01_scanner_events", "sdr_col": 0, "desc": "Scanner leads (event)"},
    {"id": "1BFG9Bnc--8gEOUSso7GUoUtdmBTK2z1qj3_o2UG-Lgo", "gid": "708449534",
     "name": "02_apollo_enriched", "sdr_col": "Assigned To", "desc": "Apollo enriched"},
    {"id": "1BFG9Bnc--8gEOUSso7GUoUtdmBTK2z1qj3_o2UG-Lgo", "gid": "1624875828",
     "name": "03_sf_export_tanya", "sdr_col": 0, "desc": "SF Export (Tanya)"},
    {"id": "1BFG9Bnc--8gEOUSso7GUoUtdmBTK2z1qj3_o2UG-Lgo", "gid": "1281708858",
     "name": "04_mixed_gauri", "sdr_col": 0, "desc": "Mixed (Gauri)"},
    # Spreadsheet B: 1DtYJxEsUsFq-fMNsuUtocRflyxyhxxES
    {"id": "1DtYJxEsUsFq-fMNsuUtocRflyxyhxxES", "gid": "1591506325",
     "name": "05_enriched_outbound", "sdr_col": "Assigned SDR", "desc": "Enriched outbound"},
    {"id": "1DtYJxEsUsFq-fMNsuUtocRflyxyhxxES", "gid": "582922199",
     "name": "06_rcm_tier", "sdr_col": "SDR", "desc": "RCM tier"},
    {"id": "1DtYJxEsUsFq-fMNsuUtocRflyxyhxxES", "gid": "373568905",
     "name": "07_event_gauri", "sdr_col": "Assigned to", "desc": "Event leads (Gauri)"},
    {"id": "1DtYJxEsUsFq-fMNsuUtocRflyxyhxxES", "gid": "608409716",
     "name": "08_fresh_outbound", "sdr_col": "Assigned SDR", "desc": "Fresh outbound"},
    {"id": "1DtYJxEsUsFq-fMNsuUtocRflyxyhxxES", "gid": "1362932727",
     "name": "09_sql_won_tracker", "sdr_col": "Meeting Set By", "desc": "SQL/Won tracker"},
    {"id": "1DtYJxEsUsFq-fMNsuUtocRflyxyhxxES", "gid": "1241127813",
     "name": "10_himanshu_batch", "sdr_col": 0, "desc": "Himanshu batch calls"},
    {"id": "1DtYJxEsUsFq-fMNsuUtocRflyxyhxxES", "gid": "638709671",
     "name": "11_master_merged", "sdr_col": "Assigned SDR", "desc": "Master merged (LAST)"},
    {"id": "1DtYJxEsUsFq-fMNsuUtocRflyxyhxxES", "gid": "704861704",
     "name": "12_drift_salesloft", "sdr_col": "Assigned SDR", "desc": "Drift/Salesloft replace"},
]

# Aircall credentials
AIRCALL_API_ID = "f48035d08c16ff744865ecd22bb43c85"
AIRCALL_API_TOKEN = "a2de0d3cf7c3b00a2b2f712912912be1"

# RCM production API
RCM_PROD = "https://api.alternatecrm.com"


def download_sheet(sheet_id, gid, output_path):
    """Download a Google Sheet tab as CSV."""
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
            # Check if it's HTML (auth required)
            if data[:15].lower().startswith(b'<!doctype') or b'<html' in data[:100].lower():
                return False, "Auth required (not public)"
            with open(output_path, 'wb') as f:
                f.write(data)
            # Count rows
            lines = data.decode('utf-8', errors='replace').strip().split('\n')
            return True, len(lines) - 1  # subtract header
    except Exception as e:
        return False, str(e)


def fetch_aircall_users():
    """Fetch all Aircall users (paginated)."""
    all_users = []
    page = 1
    auth = base64.b64encode(f"{AIRCALL_API_ID}:{AIRCALL_API_TOKEN}".encode()).decode()
    
    while True:
        url = f"https://api.aircall.io/v1/users?per_page=50&page={page}"
        req = urllib.request.Request(url, headers={"Authorization": f"Basic {auth}"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        users = data.get("users", [])
        if not users:
            break
        all_users.extend(users)
        page += 1
        if len(users) < 50:
            break
        time.sleep(0.5)
    
    return all_users


def fetch_rcm_users_from_db():
    """
    Fetch RCM users by connecting to the production database.
    
    Pass the DATABASE_URL via:
      - CLI argument:  python phase1_download_and_map.py "postgresql://..."
      - Environment:   DATABASE_URL=... python phase1_download_and_map.py
    """
    db_url = None
    # 1) CLI arg
    if len(sys.argv) > 1:
        db_url = sys.argv[1]
    # 2) Environment variable
    if not db_url:
        db_url = os.environ.get("DATABASE_URL", "")
    
    if not db_url:
        print("  ⚠️  No DATABASE_URL provided. Pass as CLI argument or env var.")
        return None
    
    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.orm import Session
        
        engine = create_engine(db_url)
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT id, email, name, role, pod_id, dialer_enabled FROM users ORDER BY email"
            )).fetchall()
        
        result = []
        for r in rows:
            result.append({
                "id": r[0],
                "email": r[1],
                "name": r[2],
                "role": r[3],
                "pod_id": r[4],
                "dialer_enabled": r[5] if len(r) > 5 else False,
            })
        return result
    except Exception as e:
        print(f"  ⚠️  Could not connect to RCM DB: {e}")
        return None


def build_sdr_maps(aircall_users, rcm_users):
    """
    Build the SDR email map: only SDRs present in BOTH Aircall AND RCM.
    Also build a sheet SDR name → email map for normalizing the varying 
    name formats across sheets.
    """
    # Aircall: email → user data
    aircall_by_email = {}
    for u in aircall_users:
        aircall_by_email[u["email"].lower()] = {
            "id": u["id"],
            "name": u["name"],
            "email": u["email"]
        }
    
    # RCM: email → user data
    ls_by_email = {}
    for u in rcm_users:
        ls_by_email[u["email"].lower()] = u
    
    # Match: only SDRs in BOTH systems
    sdr_email_map = {}
    for email in aircall_by_email:
        if email in ls_by_email:
            ac = aircall_by_email[email]
            ls = ls_by_email[email]
            sdr_email_map[email] = {
                "aircall_id": ac["id"],
                "aircall_name": ac["name"],
                "rcm_id": ls["id"],
                "rcm_name": ls["name"],
                "rcm_role": ls["role"],
                "rcm_pod_id": ls["pod_id"],
                "email": email,
            }
    
    # Build name → email map for sheet SDR column matching
    # Uses first name matching (case-insensitive) since sheets just say "Mayukh", "Gauri", etc.
    name_to_email = {}
    for email, data in sdr_email_map.items():
        # Full name
        full = data["aircall_name"].strip().lower()
        name_to_email[full] = email
        # First name only
        first = full.split()[0] if full else ""
        if first and first not in name_to_email:
            name_to_email[first] = email
        # Also try RCM name
        ls_full = (data["rcm_name"] or "").strip().lower()
        if ls_full:
            name_to_email[ls_full] = email
            ls_first = ls_full.split()[0]
            if ls_first and ls_first not in name_to_email:
                name_to_email[ls_first] = email
    
    return sdr_email_map, name_to_email


def main():
    os.makedirs(RAW_DIR, exist_ok=True)
    
    print("=" * 60)
    print("PHASE 1: Download Sheets + Build SDR Map")
    print("=" * 60)
    
    # ── Step 1: Download all 12 sheets ──
    print("\n📥 Step 1: Downloading 12 Google Sheets...")
    sheet_stats = []
    for i, sheet in enumerate(SHEETS, 1):
        outpath = os.path.join(RAW_DIR, f"{sheet['name']}.csv")
        print(f"  [{i:2d}/12] {sheet['desc']:<35}", end="", flush=True)
        ok, result = download_sheet(sheet["id"], sheet["gid"], outpath)
        if ok:
            print(f"  ✅ {result} rows")
            sheet_stats.append({"name": sheet["name"], "rows": result, "status": "ok"})
        else:
            print(f"  ❌ {result}")
            sheet_stats.append({"name": sheet["name"], "rows": 0, "status": f"failed: {result}"})
    
    total_rows = sum(s["rows"] for s in sheet_stats)
    print(f"\n  📊 Total raw rows: {total_rows:,}")
    
    # ── Step 2: Fetch Aircall users ──
    print("\n📞 Step 2: Fetching Aircall users...")
    aircall_users = fetch_aircall_users()
    print(f"  ✅ {len(aircall_users)} Aircall users fetched")
    with open(os.path.join(DATA_DIR, "aircall_users.json"), "w") as f:
        json.dump(aircall_users, f, indent=2)
    
    # ── Step 3: Fetch RCM users ──
    print("\n👤 Step 3: Fetching RCM users...")
    ls_users = fetch_rcm_users_from_db()
    if ls_users:
        print(f"  ✅ {len(ls_users)} RCM users fetched from DB")
        with open(os.path.join(DATA_DIR, "rcm_users.json"), "w") as f:
            json.dump(ls_users, f, indent=2)
    else:
        # Try loading from a saved file if DB isn't accessible
        saved_path = os.path.join(DATA_DIR, "rcm_users.json")
        if os.path.exists(saved_path):
            with open(saved_path) as f:
                ls_users = json.load(f)
            print(f"  ⚠️  Loaded {len(ls_users)} users from cached file")
        else:
            print("  ❌ Cannot fetch RCM users. Please run this from the backend env.")
            sys.exit(1)
    
    # ── Step 4: Build SDR maps ──
    print("\n🗺️  Step 4: Building SDR email map...")
    sdr_map, name_map = build_sdr_maps(aircall_users, ls_users)
    
    print(f"  ✅ {len(sdr_map)} SDRs matched (in both Aircall + RCM):")
    for email, data in sorted(sdr_map.items()):
        print(f"     {data['aircall_name']:<30} | {email}")
    
    with open(os.path.join(DATA_DIR, "sdr_email_map.json"), "w") as f:
        json.dump(sdr_map, f, indent=2)
    with open(os.path.join(DATA_DIR, "sheet_sdr_name_map.json"), "w") as f:
        json.dump(name_map, f, indent=2)
    
    # ── Summary ──
    print("\n" + "=" * 60)
    print("PHASE 1 COMPLETE")
    print("=" * 60)
    print(f"  📄 Sheets downloaded:    {sum(1 for s in sheet_stats if s['status'] == 'ok')}/12")
    print(f"  📊 Total raw rows:       {total_rows:,}")
    print(f"  📞 Aircall users:        {len(aircall_users)}")
    print(f"  👤 RCM users:      {len(ls_users)}")
    print(f"  🗺️  Matched SDRs:        {len(sdr_map)}")
    print(f"\n  Checkpoint files in: {DATA_DIR}/")
    print(f"  Next: Run phase2_normalize.py")


if __name__ == "__main__":
    main()
