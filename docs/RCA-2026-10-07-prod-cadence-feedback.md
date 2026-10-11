# RCA — first prod cadence run by an AE, and the Activity Monitor rows (2026-10-07)

**Reported by:** Anway Patankar (AE), after running a cadence on prod; plus Neelmani's Activity Monitor screenshot.
**Fixed in:** v13.8.0 (develop → staging → main). **Status of each item below is marked: PROVEN (reproduced
by a test / read in code), LIKELY (code explains it; needs a prod data check to be certain).**

Nothing in this RCA was verified against prod data — prod was not touched. Each item lists the prod
check that would turn "LIKELY" into "PROVEN".

---

## 1. "Email was sent, but clicks and opens were not tracked"

| | |
|---|---|
| What the AE saw | Cadence Reporting: Email · 2 sent, 0% opened, 0% clicked, 0% replied |
| Reporting is correct | `_journey_engagement_stats` counts `opened_at`/`clicked_at` on the cadence's outbound rows. It would show any open the webhook recorded. **PROVEN** (read in code) |
| The send path is correct | Cadence sends request `tracking_options {opens, links, thread_replies}`, store the Nylas message id, and link the row to the journey. **PROVEN** |
| **Clicks — root cause** | A cadence step with a plain-text body (the default) sent a pasted URL as plain text. Nylas rewrites `<a href>` links only, so there was nothing to track. **PROVEN** (`_plain_text_to_html` escaped the text and never created anchors). **Fixed:** bare URLs become real links. |
| **Opens — root cause** | **Not provable from code.** The open path (`message.opened` → `nylas_message_id` lookup) is identical to the one the compose flow uses. Candidates: the prod Nylas webhook is not subscribed to `message.opened` / `message.link_clicked`; the webhook secret is missing so every event gets 401; the recipients' clients block images / prefetch. **LIKELY: webhook subscription or delivery.** |
| What we did | Added a health check (`/api/email/health`): fails if the webhook secret is missing, or if ≥10 tracked emails were sent in 7 days and **no** open, click or reply event ever arrived — with the exact triggers to check. The webhook now logs the click payload shape (URLs, user agents) so the next RCA is data-driven. |
| **Prod check** | (1) Nylas dashboard → Webhooks: is `message.opened`, `message.link_clicked`, `message.created` subscribed to the prod URL? (2) Render prod logs around the AE's test for `message.opened received`, `Open event for unknown message_id`, or 401s on `/webhooks/nylas`. (3) After v13.8.0 deploys, Control Center → email health should say whether events are arriving. |

## 2. "The cadence stopped for Sonal — it said she replied, but she never replied. Shreyash did the same but wasn't removed."

| | |
|---|---|
| Opens/clicks cannot end a cadence | The only code that writes the exit reason `replied` runs on **inbound mail** (`check_exit_triggers`, engine.py). Open/click events never reach it. **PROVEN** |
| **Root cause** | "A reply" was any inbound message involving the lead's address. Two paths: the 5-minute mailbox sync (searches the rep's mailbox for `any_email=<lead>`; it started working for the first time in v13.6.1 — before that every search returned 400) and the Nylas webhook's lead-email fallback. Neither checked **who sent it** (a colleague/forwarder/CC), **what it answered** (an unrelated thread), or **what kind of mail it was** (read receipt, bounce, no-reply). Sonal and Shreyash are colleagues of the AE, so unrelated mail from Sonal — or a read receipt, which arrives exactly when she opens the email — ended the cadence. **LIKELY** (about 60% from code alone); the mechanism is **PROVEN** by tests. |
| Why Shreyash wasn't stopped | Probably he sent nothing to the AE's mailbox after enrolment, or his mailbox is connected in Alternate CRM (then his mail is classed as internal). **LIKELY** |
| Second, bigger find | The webhook's `message.created` branch never worked on prod: Nylas v3 nests the message under `data.object`; open/click handlers unwrapped it, this one read `thread_id` off the envelope and dropped every reply. Every unit test used a flat payload shape, so nothing noticed. **PROVEN** (real-envelope test fails without the fix). Replies were only ever caught by the sync, up to 5 minutes late. |
| **Fix** | A message counts as a reply to a cadence only if it is **from the lead's own address**, is **not** a receipt/bounce/no-reply/calendar response (`email_utils.is_system_message`), and **answers an email we sent that lead since the cadence began** (same thread, or same subject minus Re:/Fwd: — cadence-sent or hand-sent). Only the cadence(s) it answers stop. The stop is logged with the message id, thread, sender, subject and source (`journey_stopped` detail) so the next report is answerable from data. |
| Behaviour change to know | A lead's brand-new email on an unrelated thread no longer stops a cadence (it still shows in the bell and the Replies inbox). A reply to a hand-sent Gmail email counts once the sync has recorded the outbound mail (≤5 min). |
| **Prod check** | `execution_logs` for Sonal's enrolment, `event_type='journey_stopped'`: `detail->>'event'` says email vs SMS; then her `lead_email_activity` inbound rows (`from_email`, `subject`, `nylas_thread_id`, `timestamp` — a real message date means the sync wrote it). Note the exit label is the same for SMS/WhatsApp replies: if `event` is `sms_replied`, the cause is on the SMS path (`messaging_sync` has no freshness check vs enrolment — noted, not changed). |

## 3. "A cadence that starts with status = Calling also sent to leads already in that status"

| | |
|---|---|
| Is there a publish-time backfill? | **No.** `publish` never touches leads; no sweep job enrols leads. Entry is event-driven. **PROVEN** |
| **Root cause** | `log_status_change` fired the entry trigger on **every** call, without checking the status actually changed, so a "change" from Calling to Calling enrolled (e.g. a Kanban drop on the same column — `PATCH /leads/kanban/move` has no same-status guard); a trigger with a **blank** target status matched every change (publish never validated it; switching the trigger event in the builder left `to_status` undefined); and the publish text said "matching leads will start enrolling", which reads like a state, not an event. **PROVEN** |
| **Fix** | The trigger runs only on a real change (creation, from "no status", still counts); publish and the builder reject a trigger with no target status; the wording now says "Leads whose status changes to X after you publish will enrol. Leads already in X are not enrolled — use Enroll in Cadence for those."; every enrolment records how it happened (`enrolled_via`: trigger / manual / sandbox) and the roster shows it. |
| Not changed (decisions for you) | (a) A lead whose earlier enrolment finished re-enrols the next time it changes *into* the status (e.g. Calling→Dialing→Calling). (b) Live cadences with a blank target status keep matching every change until republished — find them: published journeys whose `status_changed` trigger node has no `to_status`. (c) The Kanban endpoint still writes a same-status log row; only enrolment is guarded. |
| **Prod check** | For a wrongly enrolled lead compare `journey_enrollments.enrolled_at` with `lead_status_logs`: a row `Calling→Calling` at that second = same-status event; any other `from_status` = a genuine re-entry; no row = manual/bulk enrol. |

## 4. "Clicks in a campaign, but there was no link in my email — is the unsubscribe link counted?" (56 sent, 30 opened, 27 clicked)

| | |
|---|---|
| **Root cause** | Yes. Campaign emails get an Unsubscribe link in the footer and Nylas tracks every link. Corporate mail-security scanners (Defender, Proofpoint, Mimecast) fetch every link and load every pixel at delivery. 27 clicks against 30 opens (~90% of openers "clicking" a link nobody wants) is the signature. Nothing excluded the unsubscribe URL or scanner activity. **PROVEN** mechanism; attribution to scanners **LIKELY** pending the check below. |
| **Worse side effect found** | `GET /api/public/unsubscribe` **unsubscribed the lead on a plain GET**. A scanner following the link therefore unsubscribed the lead and ended their cadences. If that happened, up to ~27 of those 56 leads may be wrongly unsubscribed. |
| **Fix** | GET now only shows a confirm button; POST does the unsubscribe. Clicks on the unsubscribe URL, and clicks within 10 s of sending, are not counted. |
| **Prod check (needs your OK — it reads data, changes nothing)** | For that campaign: leads with `unsubscribed_at` within seconds of the send, and the `clicked_at − timestamp` distribution. If leads were wrongly unsubscribed, tell me and I'll prepare the (reviewed, explicit) restore for you to run. |
| Opens at 53% | Likely inflated the same way (scanners and Apple Mail Privacy Protection load the pixel). Not something code can separate reliably; the report now at least stops counting scanner-window clicks. |

## 5. "I did not call Sonal 7 times, yet it says 7 attempts. Is the system auto-dialing? Where do I mark a wrong number?"

| | |
|---|---|
| **Auto-dialing?** | **No.** A cadence Call step only creates a reminder Task. The only code that places a call is `POST /calls/start`, behind a user click. Power Dialer "Call Next" only advances the queue. **PROVEN** (all callers read). |
| What "7 attempts" is | `Lead.call_attempt_count` — a lifetime counter for the lead, all reps, no reset, counting every outbound call that ends (answered or not), plus unsuccessful outcomes logged by hand. The lead card then said "7 of 5 attempts made with no success", which is false for answered calls and other reps' calls. **PROVEN** |
| **Overcounting bug (PROVEN)** | A tagged outbound Aircall call was counted twice (webhook + tag auto-log), and a tagged *inbound* call added one. Now a call counts once (on its first terminal event), inbound tagged calls count 0. The hungup-then-ended double count from the first RCA could **not** be reproduced from the existing code (the first event already sets `ended_at`); the guard was made status-based anyway. |
| Still not perfect | Calls ended by the Disconnect button, the stale-call sweeper or a manual log are not counted by the webhook (an undercount that existed before). Existing inflated counts are not recomputed (a backfill would rewrite data on every lead — say if you want it). Other contributors the AE should check: calls by the previous rep or a colleague, and a shared phone number (calls to a number shared by several leads attach to the one in an active cadence — `_find_lead_by_phone`). |
| Honest labels | "N call attempts logged on this lead (all reps)", "Call attempts (all reps)"; the cadence report's call step says "N tasks created" (it was "Sent 2" = 2 reminder tasks, not calls). |
| **Wrong number — why it was hidden** | The outcome existed but only under "Yes, Connected" in the post-call modal; without a call the only path was "Disqualify Lead", which closes the whole lead and only works from five statuses. Logging it did nothing: the phone wasn't flagged and the cadence kept scheduling calls and texts. |
| **Fix** | "Wrong number" in the lead page quick actions (next to Call), a "Wrong number" badge on the phone, and the chip on the "No / Voicemail" branch of the post-call modal. It marks the phone invalid (`phone_invalid_at`), writes a timeline note, closes the cadence's open call-reminder tasks, and makes cadence call/SMS/WhatsApp steps skip (the lead stays active for email). Editing the number clears it. Logging Wrong Number as a call outcome or via the Aircall tag does the same. |
| Limits | The flag affects cadence steps only; the Call button, Power Dialer and manual SMS are not blocked. |

## 6. Activity Monitor: rows "Out · Unknown · (no subject) · opens 1 · clicks 0 · Zydus Hospitals…"

**PROVEN.** These are **Instantly open-counter rows** (`source='instantly'`, `user_id` NULL, no subject), one
written every time Instantly reported a newer open. They are engagement state, not emails; Activity Monitor
listed them as sent emails (and counted them as "sent" while ignoring Instantly replies in the reply rate).
**Fixed in v13.8.0:** counter rows are no longer listed or counted as sent; Instantly emails are now real rows
(subject, body, thread), included in the reply rate and the rep filter.

## 7. Staging memory (OOM) — validation

What was changed (v13.7.0): bounded perf-writer pool, `MALLOC_ARENA_MAX=2`, `malloc_trim` after email sync,
leader-retry backoff. Measured on staging (512 MB, 2 workers) with a sampler reading `/api/admin/debug-memory`
every 2 minutes for 80 minutes (07:09–08:29 IST, 80 samples), spanning two deploys and Playwright load
(the v13.8.0 persona specs: ~21 browser sessions plus API calls).

| Worker | Start | Peak (under load) | End |
|---|---|---|---|
| pid 8 (pre-deploy) | 227 MB | 232 MB | 205 MB |
| pid 9 | 156 MB | 266 MB | 176 MB |
| pid 10 (post-deploy) | 145 MB | 182 MB | 180 MB |

- **Confirmed:** no monotonic growth; each worker's RSS rises under load and comes back down; a fresh worker
  starts at ~145–156 MB (the 13.6 baseline); thread count is flat (5–7 per web worker, 22–24 on the
  scheduler-leader worker); no SIGKILL / out-of-memory line in the Render logs for the window. The two pid
  changes are the deploys (both workers restart at 02:16 and 02:40 UTC), not kills.
- **Not confirmed:** this is minutes of synthetic load, not hours of real traffic. The original OOM took hours
  to appear. Two workers at their observed peaks would be ~450 MB against a 512 MB limit, so headroom under
  heavy concurrent use is thin. The Instantly mail sync (new, every 5 min) does run on staging
  (Instantly is enabled there): it read ~1,500 emails in 17 pages on its first backfill and stored the 5 that
  belong to leads staging has; the rest are Instantly leads that do not exist in the staging database
  (skipped by design, same as the nightly engagement sync's "no Alternate CRM match" lines). It processes one page
  at a time and holds nothing between pages; steady state is 4 requests per run. Its memory effect shows in the
  samples above (the 1,500-email backfill ran at ~07:54–08:08 IST inside the 266 MB peak).
- **Decision:** keep the SA-only `/api/admin/debug-memory` endpoints until prod has run a few days; they are
  the only way to see per-worker RSS without Render's shell. Remove them (and the test in
  `test_admin_routes.py`) in the release after.

## 8. Dialer message badge stuck at "1" (reported by Neelmani, 2026-10-07)

**Cause (PROVEN, in code):** the widget's badge sums Alternate Messenger's own `unread_message_count`; reading a thread
inside Alternate CRM never tells Alternate Messenger it was read (no mark-as-read call exists in our integration — the code
comment even said "may not zero out"). **Fix:** a per-browser "seen" mark per conversation; opening the
Messages view clears the badge, a new inbound brings it back, and the mark follows Alternate Messenger down if it ever
resets. Limit: per browser, not synced across devices; Alternate Messenger's own inbox still shows the thread unread.

---

## What we changed so this class of gap does not repeat

- **Protocol Rule 21** — a number users watch must be tested against the provider's *real* payload shape,
  carry a live "is it arriving" health signal, and be labelled for what it actually counts. A state-changing
  action must never hang off a plain GET.
- **Protocol Rule 22** — anything that ends or starts a customer-facing process on an inferred event must
  log its evidence and be tested against the near-misses (colleague mail, receipts, same-status "change", blank
  trigger target).
- Regression tests for each near-miss (see `tests/test_reply_validation_v13_8.py`,
  `test_call_attempt_counting.py`, `test_wrong_number.py`, journey trigger tests) and the first tests that use the real
  Nylas v3 envelope.
- Staging Playwright audit across all personas before any prod promotion.
