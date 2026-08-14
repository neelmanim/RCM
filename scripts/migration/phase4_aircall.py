#!/usr/bin/env python3
"""
Phase 4: Aircall Cross-Reference
=================================
For each unique phone number in deduped_final.csv, queries Aircall API
to check if calls were placed (Jan 2026 → now).

Rate-limited to ~50 req/min to stay under Aircall's 60 req/min limit.
Supports interrupt/resume via checkpoint file.

Produces:
  - data/aircall_matched.csv       (deduped records + Aircall match data)
  - data/aircall_checkpoint.json   (progress checkpoint for resume)
  - data/phase4_stats.json         (statistics)
"""

import csv, json, os, sys, time, base64, urllib.request, urllib.error, re
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

# Aircall credentials
AIRCALL_API_ID = "f48035d08c16ff744865ecd22bb43c85"
AIRCALL_API_TOKEN = "a2de0d3cf7c3b00a2b2f712912912be1"
AUTH = base64.b64encode(f"{AIRCALL_API_ID}:{AIRCALL_API_TOKEN}".encode()).decode()

# Date range: Jan 1, 2026 → now
FROM_TS = int(datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp())
TO_TS = int(datetime.now(timezone.utc).timestamp())

# Rate limiting
REQUESTS_PER_MINUTE = 50
REQUEST_INTERVAL = 60.0 / REQUESTS_PER_MINUTE  # 1.2 seconds


def load_aircall_user_map():
    """Load Aircall user ID → email/name map."""
    with open(os.path.join(DATA_DIR, "aircall_users.json")) as f:
        users = json.load(f)
    return {u["id"]: {"name": u["name"], "email": u["email"].lower()} for u in users}


def normalize_phone_for_search(phone):
    """Normalize phone for Aircall search — they accept E.164-like formats."""
    if not phone:
        return None
    digits = re.sub(r'\D', '', str(phone))
    if len(digits) < 7:
        return None
    return digits


def search_aircall_calls(phone_digits):
    """
    Search Aircall for calls to a phone number.
    Returns list of matching calls or empty list.
    """
    # Try with the full digits
    url = (
        f"https://api.aircall.io/v1/calls/search"
        f"?phone_number={phone_digits}"
        f"&from={FROM_TS}&to={TO_TS}"
        f"&order=desc&per_page=25"
    )
    
    try:
        req = urllib.request.Request(url, headers={"Authorization": f"Basic {AUTH}"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        return data.get("calls", [])
    except urllib.error.HTTPError as e:
        if e.code == 429:
            # Rate limited — wait and retry once
            retry_after = int(e.headers.get("Retry-After", "5"))
            time.sleep(retry_after + 1)
            try:
                req = urllib.request.Request(url, headers={"Authorization": f"Basic {AUTH}"})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read())
                return data.get("calls", [])
            except:
                return []
        elif e.code == 404:
            return []
        else:
            return []
    except Exception:
        return []


def main():
    print("=" * 60)
    print("PHASE 4: Aircall Cross-Reference")
    print(f"  Date range: Jan 1, 2026 → now")
    print("=" * 60)
    
    # Load deduped records
    input_path = os.path.join(DATA_DIR, "deduped_final.csv")
    with open(input_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        records = list(reader)
    
    print(f"\n  📊 Records to check: {len(records):,}")
    
    # Load Aircall user map
    user_map = load_aircall_user_map()
    
    # Load SDR email map
    with open(os.path.join(DATA_DIR, "sdr_email_map.json")) as f:
        sdr_map = json.load(f)
    
    # Collect unique phone numbers (avoid duplicate API calls)
    phone_to_records = {}
    for i, record in enumerate(records):
        phone = record.get("phone", "")
        digits = normalize_phone_for_search(phone)
        if digits:
            phone_to_records.setdefault(digits, []).append(i)
    
    unique_phones = list(phone_to_records.keys())
    print(f"  📞 Unique phone numbers: {len(unique_phones):,}")
    
    # Load checkpoint (for resume)
    checkpoint_path = os.path.join(DATA_DIR, "aircall_checkpoint.json")
    phone_results = {}
    start_idx = 0
    if os.path.exists(checkpoint_path):
        with open(checkpoint_path) as f:
            checkpoint = json.load(f)
        phone_results = checkpoint.get("results", {})
        start_idx = checkpoint.get("last_index", 0) + 1
        if start_idx > 0:
            print(f"  🔄 Resuming from index {start_idx} ({len(phone_results)} already checked)")
    
    # Query Aircall for each unique phone
    est_time = (len(unique_phones) - start_idx) * REQUEST_INTERVAL / 60
    print(f"  ⏱️  Estimated time: {est_time:.0f} minutes")
    print()
    
    matched_count = 0
    error_count = 0
    
    try:
        for idx in range(start_idx, len(unique_phones)):
            phone_digits = unique_phones[idx]
            
            # Rate limiting
            time.sleep(REQUEST_INTERVAL)
            
            calls = search_aircall_calls(phone_digits)
            
            if calls:
                # Extract call details
                outbound_calls = [c for c in calls if c.get("direction") == "outbound"]
                all_relevant = outbound_calls if outbound_calls else calls
                
                # Find the SDR who made the calls
                caller_ids = set()
                for c in all_relevant:
                    user = c.get("user")
                    if user:
                        caller_ids.add(user.get("id"))
                
                # Get caller info
                caller_emails = []
                caller_names = []
                for uid in caller_ids:
                    uinfo = user_map.get(uid, {})
                    if uinfo:
                        caller_emails.append(uinfo["email"])
                        caller_names.append(uinfo["name"])
                
                phone_results[phone_digits] = {
                    "matched": True,
                    "call_count": len(all_relevant),
                    "total_calls": len(calls),
                    "outbound_calls": len(outbound_calls),
                    "caller_emails": caller_emails,
                    "caller_names": caller_names,
                    "last_call_date": calls[0].get("started_at", "") if calls else "",
                    "total_duration": sum(c.get("duration", 0) for c in all_relevant),
                }
                matched_count += 1
            else:
                phone_results[phone_digits] = {"matched": False}
            
            # Progress display
            done = idx - start_idx + 1
            total = len(unique_phones) - start_idx
            pct = (done / total * 100) if total else 100
            status = "📞" if calls else "⬜"
            if done % 50 == 0 or done == total:
                print(f"  [{done:>5}/{total}] {pct:5.1f}% | Matched: {matched_count} | Phone: {phone_digits} {status}")
            
            # Save checkpoint every 100 records
            if done % 100 == 0:
                with open(checkpoint_path, 'w') as f:
                    json.dump({"last_index": idx, "results": phone_results}, f)
    
    except KeyboardInterrupt:
        print(f"\n\n  ⚠️  Interrupted! Saving checkpoint at index {idx}...")
        with open(checkpoint_path, 'w') as f:
            json.dump({"last_index": idx, "results": phone_results}, f)
        print(f"  Resume by running this script again.")
        sys.exit(0)
    
    # Save final checkpoint
    with open(checkpoint_path, 'w') as f:
        json.dump({"last_index": len(unique_phones) - 1, "results": phone_results, "complete": True}, f)
    
    # ── Enrich records with Aircall data ──
    print(f"\n  📝 Enriching {len(records):,} records with Aircall data...")
    
    output_records = []
    aircall_matched_leads = 0
    
    for record in records:
        phone = record.get("phone", "")
        digits = normalize_phone_for_search(phone)
        
        ac_data = phone_results.get(digits, {}) if digits else {}
        
        enriched = {**record}
        if ac_data.get("matched"):
            enriched["aircall_called"] = "yes"
            enriched["aircall_call_count"] = ac_data.get("call_count", 0)
            enriched["aircall_outbound_calls"] = ac_data.get("outbound_calls", 0)
            enriched["aircall_total_duration"] = ac_data.get("total_duration", 0)
            enriched["aircall_caller_emails"] = "; ".join(ac_data.get("caller_emails", []))
            enriched["aircall_caller_names"] = "; ".join(ac_data.get("caller_names", []))
            enriched["aircall_last_call_date"] = ac_data.get("last_call_date", "")
            aircall_matched_leads += 1
        else:
            enriched["aircall_called"] = "no"
            enriched["aircall_call_count"] = 0
            enriched["aircall_outbound_calls"] = 0
            enriched["aircall_total_duration"] = 0
            enriched["aircall_caller_emails"] = ""
            enriched["aircall_caller_names"] = ""
            enriched["aircall_last_call_date"] = ""
        
        output_records.append(enriched)
    
    # Write output
    output_path = os.path.join(DATA_DIR, "aircall_matched.csv")
    if output_records:
        with open(output_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=output_records[0].keys())
            writer.writeheader()
            writer.writerows(output_records)
    
    # Stats
    stats = {
        "total_records": len(records),
        "unique_phones_checked": len(unique_phones),
        "phones_with_calls": matched_count,
        "leads_with_aircall_match": aircall_matched_leads,
        "match_rate_percent": round(aircall_matched_leads / len(records) * 100, 1) if records else 0,
    }
    with open(os.path.join(DATA_DIR, "phase4_stats.json"), 'w') as f:
        json.dump(stats, f, indent=2)
    
    print("\n" + "=" * 60)
    print("PHASE 4 COMPLETE")
    print("=" * 60)
    print(f"  📞 Unique phones checked: {len(unique_phones):,}")
    print(f"  ✅ Phones with calls:     {matched_count:,}")
    print(f"  📊 Leads with Aircall:    {aircall_matched_leads:,} ({stats['match_rate_percent']}%)")
    print(f"\n  Output: {output_path}")
    print(f"  Next: Run phase5_import.py")


if __name__ == "__main__":
    main()
