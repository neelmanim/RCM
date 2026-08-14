
#!/usr/bin/env python3
"""
Phase 6: Sync Aircall Call Records
====================================
Triggers the existing sync_historical_calls logic to create DialerCall 
records for the newly imported leads.

Since MAX_SYNC_DAYS=90 and we need Jan 1 → now (~118 days), runs in 2 passes:
  Pass 1: Jan 1, 2026 → Mar 31, 2026 (90 days)
  Pass 2: Apr 1, 2026 → now

Uses direct DB + Aircall API calls (same logic as dialer_service.py).
"""

import json, os, sys, time, base64, urllib.request, urllib.error, re, uuid
from datetime import datetime, timezone, timedelta

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

# Aircall credentials
AIRCALL_API_ID = "f48035d08c16ff744865ecd22bb43c85"
AIRCALL_API_TOKEN = "a2de0d3cf7c3b00a2b2f712912912be1"
AUTH = base64.b64encode(f"{AIRCALL_API_ID}:{AIRCALL_API_TOKEN}".encode()).decode()

SUB_BATCH_DAYS = 7


def get_db_url():
    if len(sys.argv) > 1:
        return sys.argv[1]
    return os.environ.get("DATABASE_URL", "")


def fetch_calls_page(from_ts, to_ts, page=1, per_page=50):
    """Fetch a page of calls from Aircall."""
    url = (
        f"https://api.aircall.io/v1/calls?"
        f"from={from_ts}&to={to_ts}"
        f"&order=asc&per_page={per_page}&page={page}"
    )
    retries = 3
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"Authorization": f"Basic {AUTH}"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                retry_after = int(e.headers.get("Retry-After", "10"))
                print(f"    ⏳ Rate limited, waiting {retry_after}s...")
                time.sleep(retry_after + 1)
            else:
                print(f"    ⚠️  HTTP {e.code} on page {page}")
                return None
        except Exception as e:
            print(f"    ⚠️  Error on page {page}: {e}")
            time.sleep(2)
    return None


def fetch_all_calls(from_ts, to_ts):
    """Fetch all calls in a time window (paginated)."""
    all_calls = []
    page = 1
    while True:
        data = fetch_calls_page(from_ts, to_ts, page=page)
        if not data:
            break
        calls = data.get("calls", [])
        all_calls.extend(calls)
        meta = data.get("meta", {})
        total = meta.get("total", 0)
        if len(all_calls) >= total or not calls:
            break
        page += 1
        time.sleep(0.5)  # Be gentle
    return all_calls


def normalize_phone_last10(phone):
    """Extract last 10 digits of phone for matching."""
    if not phone:
        return None
    digits = re.sub(r'\D', '', str(phone))
    return digits[-10:] if len(digits) >= 7 else None


def main():
    print("=" * 60)
    print("PHASE 6: Sync Aircall Call Records → DialerCalls")
    print("=" * 60)
    
    db_url = get_db_url()
    if not db_url:
        print("  ❌ No DATABASE_URL provided.")
        sys.exit(1)
    
    from sqlalchemy import create_engine, text
    engine = create_engine(db_url)
    
    # Define time windows (split at 90-day boundary)
    now = datetime.now(timezone.utc)
    windows = [
        (datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2026, 3, 31, tzinfo=timezone.utc)),
        (datetime(2026, 4, 1, tzinfo=timezone.utc), now),
    ]
    
    # Load user email → user_id map from DB
    print("\n  📥 Loading users and leads from DB...")
    conn = engine.connect()
    
    users = conn.execute(text("SELECT id, email FROM users")).fetchall()
    user_email_map = {r[1].lower(): r[0] for r in users}
    
    # Load lead phone → lead_id map
    leads = conn.execute(text("SELECT id, phone, phone_secondary FROM leads")).fetchall()
    phone_to_lead = {}
    for lead_id, phone, phone2 in leads:
        for p in [phone, phone2]:
            digits = normalize_phone_last10(p)
            if digits:
                phone_to_lead[digits] = lead_id
    
    # Load existing provider_call_ids for dedup
    existing_calls = conn.execute(text(
        "SELECT provider_call_id FROM dialer_calls WHERE provider = 'aircall'"
    )).fetchall()
    existing_ids = {r[0] for r in existing_calls}
    
    print(f"  ✅ {len(user_email_map)} users, {len(phone_to_lead)} phone→lead mappings, {len(existing_ids)} existing calls")
    conn.commit()  # Close autobegin from SELECTs
    
    total_imported = 0
    total_skipped_dup = 0
    total_unmatched = 0
    total_fetched = 0
    
    for win_idx, (win_start, win_end) in enumerate(windows, 1):
        print(f"\n  📅 Pass {win_idx}: {win_start.date()} → {win_end.date()}")
        
        # Split into 7-day sub-batches
        cursor = win_start
        sub_batch = 0
        
        while cursor < win_end:
            sub_end = min(cursor + timedelta(days=SUB_BATCH_DAYS), win_end)
            sub_batch += 1
            
            from_ts = int(cursor.timestamp())
            to_ts = int(sub_end.timestamp())
            
            calls = fetch_all_calls(from_ts, to_ts)
            total_fetched += len(calls)
            
            sub_imported = 0
            sub_skipped = 0
            sub_unmatched = 0
            
            tx = conn.begin()
            try:
                for call in calls:
                    provider_call_id = str(call.get("id", ""))
                    if not provider_call_id or provider_call_id in existing_ids:
                        sub_skipped += 1
                        continue
                    
                    # Phone extraction
                    raw_phone = ""
                    contact = call.get("contact") or {}
                    if call.get("raw_digits"):
                        raw_phone = call["raw_digits"]
                    elif contact.get("phone_number"):
                        raw_phone = contact["phone_number"]
                    
                    # Match to lead
                    phone_digits = normalize_phone_last10(raw_phone)
                    lead_id = phone_to_lead.get(phone_digits) if phone_digits else None
                    
                    if not lead_id:
                        sub_unmatched += 1
                        continue
                    
                    # SDR lookup
                    user_id = None
                    aircall_user = call.get("user") or {}
                    user_email = aircall_user.get("email", "").lower()
                    if user_email:
                        user_id = user_email_map.get(user_email)
                    
                    direction = call.get("direction", "outbound")
                    status_str = call.get("status", "")
                    duration = call.get("duration")
                    
                    started_at = datetime.fromtimestamp(call["started_at"], tz=timezone.utc) if call.get("started_at") else None
                    answered_at = datetime.fromtimestamp(call["answered_at"], tz=timezone.utc) if call.get("answered_at") else None
                    ended_at = datetime.fromtimestamp(call["ended_at"], tz=timezone.utc) if call.get("ended_at") else None
                    
                    normalized_status = "CALL_ENDED" if status_str in ("done", "missed", "voicemail") else status_str.upper()
                    
                    conn.execute(text("""
                        INSERT INTO dialer_calls (
                            id, lead_id, user_id, provider, provider_call_id,
                            phone_number, status, direction, duration,
                            started_at, answered_at, ended_at,
                            raw_payload, source
                        ) VALUES (
                            :id, :lead_id, :user_id, 'aircall', :provider_call_id,
                            :phone_number, :status, :direction, :duration,
                            :started_at, :answered_at, :ended_at,
                            :raw_payload, 'aircall_sync'
                        )
                        ON CONFLICT (provider, provider_call_id)
                        WHERE provider_call_id IS NOT NULL AND provider_call_id != ''
                        DO NOTHING
                    """), {
                        "id": str(uuid.uuid4()),
                        "lead_id": lead_id,
                        "user_id": user_id,
                        "provider_call_id": provider_call_id,
                        "phone_number": raw_phone,
                        "status": normalized_status,
                        "direction": direction,
                        "duration": duration,
                        "started_at": started_at,
                        "answered_at": answered_at,
                        "ended_at": ended_at,
                        "raw_payload": json.dumps(call),
                    })
                    
                    existing_ids.add(provider_call_id)
                    sub_imported += 1
                    
                    # Update times_called for outbound
                    if direction == "outbound" and normalized_status == "CALL_ENDED":
                        conn.execute(text("""
                            UPDATE leads SET times_called = times_called + 1
                            WHERE id = :lead_id
                        """), {"lead_id": lead_id})
                    
                    # Update last_call_timestamp
                    if ended_at:
                        conn.execute(text("""
                            UPDATE leads SET last_call_timestamp = :ended_at
                            WHERE id = :lead_id AND (last_call_timestamp IS NULL OR last_call_timestamp < :ended_at)
                        """), {"lead_id": lead_id, "ended_at": ended_at})
                
                tx.commit()
                total_imported += sub_imported
                total_skipped_dup += sub_skipped
                total_unmatched += sub_unmatched
                
                print(f"    Sub-batch {sub_batch} ({cursor.date()}→{sub_end.date()}): "
                      f"{len(calls)} calls, {sub_imported} imported, {sub_skipped} dup, {sub_unmatched} unmatched")
                
            except Exception as e:
                tx.rollback()
                print(f"    ❌ Sub-batch {sub_batch} error: {e}")
            
            cursor = sub_end
            time.sleep(2)  # Cooldown between sub-batches
    
    conn.close()
    
    # Save stats
    stats = {
        "total_calls_fetched": total_fetched,
        "imported": total_imported,
        "skipped_duplicate": total_skipped_dup,
        "unmatched_phone": total_unmatched,
    }
    with open(os.path.join(DATA_DIR, "phase6_stats.json"), 'w') as f:
        json.dump(stats, f, indent=2)
    
    print("\n" + "=" * 60)
    print("PHASE 6 COMPLETE")
    print("=" * 60)
    print(f"  📞 Total calls fetched:  {total_fetched:,}")
    print(f"  ✅ Imported (new):       {total_imported:,}")
    print(f"  ⏭️  Skipped (duplicate):  {total_skipped_dup:,}")
    print(f"  ❓ Unmatched phone:      {total_unmatched:,}")
    print(f"\n  🎉 Migration complete!")


if __name__ == "__main__":
    main()
