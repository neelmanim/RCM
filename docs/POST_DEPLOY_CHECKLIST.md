# After every prod deploy — do this before telling anyone it is live

1. **Version:** `/api/health` shows the new version and `startup_complete: true` (about 2 minutes). Watch the first start's logs
   for migration/backfill lines.
2. **Data check (read-only):** `PROD_DSN=... python3 scripts/prod_data_check.py` — no BLOCKER lines. Compare WARN counts with the
   last run; a jump is a finding.
3. **Each persona, on prod, in the browser** (Super Admin → *Exit View-As* is not enough; actually open the screens):
   - **Pod Admin** (View As each Pod Admin in turn): Daily Digest, Leads, Activity Monitor (Calls, Email, Messages),
     Leaderboard, Reports. Every rep and every record shown must belong to *their* pod. Check the rep dropdowns too.
   - **SDR and AE** (View As one of each): My Day, My Leads, Leaderboard — numbers match what they would expect.
   - **Super Admin:** Analytics Hub, Activity Monitor, Control Center load without errors.
4. **Number sanity:** no rate above 100%, no tile that says 0 while its list below has rows, no "Unknown" rep on a screen that
   used to name people.
5. **Salesforce:** click Sync Salesforce once (a human does this) and confirm it completes.
6. **Announce** only after 1–5. Anything odd: stop, say so, and fix forward or roll back.
