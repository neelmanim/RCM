#!/usr/bin/env python3
"""
Phase 4b: Last Caller Identification
======================================
For each phone that matched in Phase 4, fetches the single most recent 
call to determine WHO called last. Updates aircall_matched.csv with
last_caller_email and last_caller_name columns.

This is needed because Phase 4 tracked all unique callers but not which
one called most recently. The last caller becomes the lead owner.

~1,150 API calls at 50 req/min → ~23 minutes.
Supports checkpoint/resume like Phase 4.
"""

import csv, json, os, sys, time, base64, urllib.request, urllib.error, re
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

# Aircall credentials
AIRCALL_API_ID = "f48035d08c16ff744865ecd22bb43c85"
AIRCALL_API_TOKEN = "a2de0d3cf7c3b00a2b2f712912912be1"
AUTH = base64.b64encode(f"{AIRCALL_API_ID}:{AIRCALL_API_TOKEN}".encode()).decode()

FROM_TS = int(datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp())
TO_TS = int(datetime.now(timezone.utc).timestamp())

REQUEST_INTERVAL = 60.0 / 50  # 50 req/min


def load_aircall_user_map():
    with open(os.path.join(DATA_DIR, "aircall_users.json")) as f:
        users = json.load(f)
    return {u["id"]: {"name": u["name"], "email": u["email"].lower()} for u in users}


def get_last_call(phone_digits):
    """Fetch the single most recent call for a phone number."""
    url = (
        f"https://api.aircall.io/v1/calls/search"
        f"?phone_number={phone_digits}"
        f"&from={FROM_TS}&to={TO_TS}"
        f"&order=desc&per_page=1"
    )
    
    try:
        req = urllib.request.Request(url, headers={"Authorization": f"Basic {AUTH}"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        calls = data.get("calls", [])
        return calls[0] if calls else None
    except urllib.error.HTTPError as e:
        if e.code == 429:
            retry_after = int(e.headers.get("Retry-After", "5"))
            time.sleep(retry_after + 1)
            try:
                req = urllib.request.Request(url, headers={"Authorization": f"Basic {AUTH}"})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read())
                return data.get("calls", [None])[0]
            except:
                return None
        return None
    except Exception:
        return None


def main():
    print("=" * 60)
    print("PHASE 4b: Identify Last Caller Per Phone")
    print("=" * 60)
    
    # Load Phase 4 checkpoint to get matched phones
    checkpoint_path = os.path.join(DATA_DIR, "aircall_checkpoint.json")
    with open(checkpoint_path) as f:
        checkpoint = json.load(f)
    
    phone_results = checkpoint.get("results", {})
    
    user_map = load_aircall_user_map()
    
    # Load SDR map for RCM validation
    with open(os.path.join(DATA_DIR, "rcm_users.json")) as f:
        ls_users = json.load(f)
    ls_emails = {u["email"].lower() for u in ls_users}
    
    # Checkpoint for resume
    last_caller_path = os.path.join(DATA_DIR, "last_caller_checkpoint.json")
    last_caller_map = {}
    start_idx = 0
    if os.path.exists(last_caller_path):
        with open(last_caller_path) as f:
            saved = json.load(f)
        last_caller_map = saved.get("results", {})
        start_idx = saved.get("last_index", 0) + 1
        if start_idx > 0:
            print(f"  🔄 Resuming from index {start_idx} ({len(last_caller_map)} already done)")
    
    # Split: single-caller phones can be resolved from checkpoint,
    # multi-caller phones need an API call to find the LAST caller.
    multi_caller_phones = []
    single_caller_count = 0

    
    for phone, data in phone_results.items():
        if not data.get("matched"):
            continue
        emails = data.get("caller_emails", [])
        if len(emails) == 1:
            # Known last caller — no API call needed
            last_caller_map[phone] = {
                "last_caller_email": emails[0],
                "last_caller_name": data.get("caller_names", [""])[0],
                "last_caller_in_rcm": emails[0].lower() in ls_emails,
                "last_call_timestamp": data.get("last_call_date", ""),
                "last_call_direction": "outbound",
            }
            single_caller_count += 1
        elif len(emails) > 1:
            multi_caller_phones.append(phone)
        else:
            # Matched but no caller info (rare)
            last_caller_map[phone] = {
                "last_caller_email": "",
                "last_caller_name": "",
                "last_caller_in_rcm": False,
                "last_call_timestamp": "",
                "last_call_direction": "",
            }
    
    print(f"\n  📞 Total matched phones:     {single_caller_count + len(multi_caller_phones):,}")
    print(f"  ✅ Single caller (resolved):  {single_caller_count:,} (no API call needed)")
    print(f"  🔍 Multi-caller (need API):   {len(multi_caller_phones):,}")
    
    matched_phones = multi_caller_phones  # Only query these
    
    est_time = (len(matched_phones) - start_idx) * REQUEST_INTERVAL / 60
    print(f"  ⏱️  Estimated time: {est_time:.0f} minutes\n")
    
    try:
        for idx in range(start_idx, len(matched_phones)):
            phone = matched_phones[idx]
            time.sleep(REQUEST_INTERVAL)
            
            call = get_last_call(phone)
            
            if call:
                user = call.get("user") or {}
                user_id = user.get("id")
                caller_info = user_map.get(user_id, {})
                caller_email = caller_info.get("email", "")
                caller_name = caller_info.get("name", "")
                
                # Check if caller is in RCM
                in_rcm = caller_email.lower() in ls_emails if caller_email else False
                
                last_caller_map[phone] = {
                    "last_caller_email": caller_email,
                    "last_caller_name": caller_name,
                    "last_caller_in_rcm": in_rcm,
                    "last_call_timestamp": call.get("started_at", ""),
                    "last_call_direction": call.get("direction", ""),
                }
            else:
                last_caller_map[phone] = {
                    "last_caller_email": "",
                    "last_caller_name": "",
                    "last_caller_in_rcm": False,
                    "last_call_timestamp": "",
                    "last_call_direction": "",
                }
            
            done = idx - start_idx + 1
            total = len(matched_phones) - start_idx
            if done % 50 == 0 or done == total:
                pct = done / total * 100 if total else 100
                print(f"  [{done:>5}/{total}] {pct:5.1f}% | Phone: {phone} | Last: {last_caller_map[phone].get('last_caller_name', '?')}")
            
            if done % 100 == 0:
                with open(last_caller_path, 'w') as f:
                    json.dump({"last_index": idx, "results": last_caller_map}, f)
    
    except KeyboardInterrupt:
        print(f"\n  ⚠️  Interrupted! Saving checkpoint...")
        with open(last_caller_path, 'w') as f:
            json.dump({"last_index": idx, "results": last_caller_map}, f)
        sys.exit(0)
    
    # Save final checkpoint
    with open(last_caller_path, 'w') as f:
        json.dump({"last_index": len(matched_phones) - 1, "results": last_caller_map, "complete": True}, f)
    
    # ── Update aircall_matched.csv with last_caller columns ──
    print(f"\n  📝 Updating aircall_matched.csv with last caller data...")
    
    input_path = os.path.join(DATA_DIR, "aircall_matched.csv")
    with open(input_path, 'r', encoding='utf-8') as f:
        records = list(csv.DictReader(f))
    
    for record in records:
        phone = record.get("phone", "")
        digits = re.sub(r'\D', '', str(phone))
        digits = digits[-10:] if len(digits) >= 10 else digits
        
        lc = last_caller_map.get(digits, {})
        record["last_caller_email"] = lc.get("last_caller_email", "")
        record["last_caller_name"] = lc.get("last_caller_name", "")
        record["last_caller_in_rcm"] = lc.get("last_caller_in_rcm", False)
    
    # Write updated CSV
    if records:
        with open(input_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=records[0].keys())
            writer.writeheader()
            writer.writerows(records)
    
    # Stats
    has_last_caller = sum(1 for v in last_caller_map.values() if v.get("last_caller_email"))
    in_ls = sum(1 for v in last_caller_map.values() if v.get("last_caller_in_rcm"))
    
    print("\n" + "=" * 60)
    print("PHASE 4b COMPLETE")
    print("=" * 60)
    print(f"  📞 Phones checked:           {len(matched_phones):,}")
    print(f"  ✅ With identified caller:    {has_last_caller:,}")
    print(f"  👤 Last caller in RCM:  {in_ls:,}")
    print(f"\n  Next: Run phase5_import.py")


if __name__ == "__main__":
    main()
