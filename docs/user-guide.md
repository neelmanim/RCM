# RCM — User Guide
### Phase 4

---

## Getting Started

### Logging In

1. Go to your RCM URL: `https://rcm.txtbox.in`
2. Click **Sign in with Google** — use your company Google account
3. You'll be redirected to your dashboard automatically

> [!NOTE]
> First-time users must be added by a Super Admin before they can log in. If you see an "Access Denied" page, contact your Super Admin.

### Roles

| Role | Access Level |
|---|---|
| **Super Admin** | Full access — all leads, all users, POD management, Salesforce logs, sync controls, call & pipeline settings |
| **Pod Admin** | Manages their POD's leads and SDRs — can view, assign, and track pod performance |
| **SDR** | Works their assigned leads — research, calling, logging activity |

### Signing Out
Click your avatar in the bottom-left corner of the sidebar, then click the **⏻** button.

---

## For SDRs

### Dashboard

Your personal command centre with a **5-tile funnel**:

| Tile | Meaning |
|---|---|
| **My Leads** | Total leads assigned to you |
| **New Leads** | Untouched leads (status: Lead Assigned) |
| **Research Pending** | Leads awaiting research completion |
| **Calling** | Leads in your active calling queue |
| **Meetings Booked** | Leads successfully moved to Meeting Scheduled |

Below the tiles:
- **Today's Call Outcomes** — visual breakdown of calls you've made today. **Click any outcome tile** (e.g. "Call Back Later", "No Answer") to instantly jump to the Leads page pre-filtered by that outcome
- **Priority Queue** — your next leads to work, sorted by priority
- **Leaderboard** — top 5 SDRs by meetings booked (with link to full leaderboard)

> [!IMPORTANT]
> **Phone numbers in the Priority Queue are hidden until research is complete.** Leads with incomplete research show a **🔒 Hidden** badge in the phone column and a **🔒 Research** indicator in the action column instead of the Call button. Complete research on the lead detail page to unlock the number and enable calling.

> [!TIP]
> Start your day by clicking **"Call Back Later"** on the dashboard — it instantly loads all the leads that need a follow-up call today.

---

### My Leads

Click **Leads** in the sidebar to see all leads assigned to you.

**Filtering leads:**
- Type in the **🔍 Search** box to filter by name, email, or company
- Use the **🏢 Company** dropdown to filter by a specific hospital or company — see all personas at once without switching pages
- Use the **Status** dropdown to filter by pipeline stage
- Use the **Outcome** dropdown to filter by the most recent call outcome (e.g. **Call Back Later**, **Meeting Confirmed**, **No Answer**, **Voicemail Left**, **Not Interested**)
- Use the **Source** dropdown to filter by lead source (Salesforce / File Upload / Google Sheets / Manual)
- Use the **From / To** date pickers to filter by lead creation date
- Click **Clear** to remove the date filter

**Pagination persistence:** When you navigate to a lead detail page and come back, the leads page remembers your current page number, search query, and all active filters — no more jumping back to page 1.

> [!TIP]
> Your view state (page, search, filters) is saved per browser tab and automatically cleared when you navigate to a different section via the sidebar.

> [!IMPORTANT]
> The **Outcome filter** matches only the **most recent call** per lead — not historical calls. A lead who was "Call Back Later" two weeks ago but was subsequently "Meeting Confirmed" will appear under the Meeting Confirmed filter, not the Call Back Later filter.

**Phone display:** The phone column shows whichever number is available — primary phone first, then secondary phone. "📵 No Phone" only appears when both fields are empty.

**Calling a lead:** Click the **📞 Call** button on any row to log a call without opening the lead.

> [!NOTE]
> The Call button is disabled for leads in **Lead Assigned** or **Research** status. Complete the research phase first to unlock calling.

### Lead Priority Queue

My Leads is sorted by **priority tier**, so the leads most worth calling appear at the top.

| Tier | Score | Visual | Meaning |
|------|-------|--------|---------|
| 🔴 **High** | 100 | Normal row — no badge | Fresh lead, not yet called today |
| 🟡 **Medium** | 50 | Amber left border · **"Called Today"** badge | Called once today |
| ⬇️ **Deprioritized** | 25 | Faded row · **"Deprioritized"** badge | Called 2+ times today |

**How priority changes:**
- When you log a call on a lead via the Call button or Lead Detail modal, the lead's priority automatically lowers.
- Priority **only lowers automatically** — it never raises on its own.

**Re-prioritizing manually:**
- On any Medium or Deprioritized lead, click **↑ Re-prioritize** (shown in the Name column).
- The lead immediately moves back to **High** (score 100) and the table refreshes.
- Use this when a lead calls you back or when a manager asks you to urgently follow up.

> [!TIP]
> Start each morning with a fresh leads list — all leads reset to **High** overnight since priority is based on *today's* call count only.

> [!NOTE]
> The amber **💡 info banner** at the top of My Leads always shows a summary of this logic. Admins see the All Leads view which has no priority tiers.


**Opening a lead:** Click anywhere on the row to open the Lead Detail page.

---

### Lead Detail

#### Pipeline Stepper

At the top of every lead detail, a **visual pipeline stepper** shows exactly where the lead stands:

- **Green circles with ✓** — completed stages
- **Active circle** — current stage (highlighted in purple)
- **Gray circles** — future stages
- **Transition times** shown between steps (e.g. "1d 0h", "<1m") telling you how long the lead spent in each stage
- **Lead created date and assigned date** shown above the stepper

**Terminal outcomes (Unreachable / Customer Declined):** If a lead reaches a terminal status, the stepper shows a **dashed red line branching down** from the Calling step to a card showing the terminal status, timestamp, and time taken. The Meeting Scheduled step is dimmed and struck-through.

#### Lead Information
All lead fields (name, email, phone, company, title, status) are **click-to-edit** — click any field value to edit it inline. Press `Enter` or click away to save.

#### Research Phase
For leads in **Research** status, a guided research form appears with:
- Accordion sections for structured research data
- Chip selectors for quick categorization
- Progress ring tracking your completion (Research Score shown as X/11)
- Auto-fill from available enrichment data

Complete research to move the lead to **Calling** status.

#### Logging a Call (v5.16.0 — Redesigned)

The call outcome modal now works in **three guided steps** — no more scrolling through a long dropdown.

**Step 1 — Did the call connect?**
1. Click **📞 Log a Call** (or the call button on the leads list)
2. The modal opens showing your lead's name and number
3. Tap **✗ No / Voicemail** or **✓ Yes, Connected**

**Step 2 — Select the outcome**
The right outcome chips appear automatically based on your Step 1 answer:
- **No / Voicemail branch:** No Answer, Left Voicemail, Busy, Wrong Number, Callback Requested
- **Yes, Connected branch:** Call Back Later, Not Interested, Not the Right Contact, Meeting Confirmed, Call Completed

Click any chip to select it — it highlights immediately.

**Step 3 — (Yes branch only) Meeting details**
If you select **Meeting Confirmed**, a date/time picker expands inline — pick the meeting date and click **Log Call →**.

4. Click **Log Call →** — the call is saved and Salesforce is updated

**Keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `Y` | Pick "Yes, Connected" |
| `N` | Pick "No / Voicemail" |
| `1`–`9` | Select outcome chip by number |
| `Enter` | Submit (when outcome is selected) |
| `Escape` | Close modal |

> [!TIP]
> **Meeting Scheduled** logs a tentative booking — the lead stays in "Calling" so you can follow up. Use **Meeting Confirmed** to trigger Salesforce sync and initiate AE hand-off.

> [!IMPORTANT]
> **Unreachable detection:** After reaching the configured number of No Answer/Voicemail attempts, an "Unreachable" option appears in the chip grid. You can mark the lead as Unreachable, which moves it out of your active pipeline.


#### Aircall Dialer (Click-to-Call)

If your admin has enabled the Aircall dialer for your account:

1. Open any lead detail page
2. Click the **📞 Call via Aircall** button — the call is initiated directly through Aircall
3. The call is **automatically logged** in RCM — no manual call logging needed
4. After the call, the **call duration, outcome, and recording** are captured automatically

**Aircall Auto-Sync (v5.16.0):** When you tag a call in Aircall with a standard tag (e.g. *No Answer*, *Left Voicemail*, *Meeting Booked*), RCM automatically logs the outcome — no manual entry required. If you prefer to log it yourself, your entry always takes precedence.

> [!NOTE]
> When Aircall dialer is active, the manual "Log a Call" modal is disabled to prevent duplicate entries. All calls are tracked automatically via the Aircall integration.

#### Aircall Everywhere — Calling Without the Desktop App (v10.9.0 — New)

If your admin has turned this on, you no longer need the Aircall Desktop app open to receive calls.

1. Look for the headset icon next to the other buttons in the top bar (any page — not just Lead Detail or Power Dialer).
2. Click it and log in with the same Aircall account you'd use in the Desktop app.
3. That's it — once logged in, the **📞 Call via Aircall** button works exactly as before, except the call now rings right there in your browser instead of the Desktop app.

The drawer opens automatically whenever you have an active call, so mute/hold/hang-up are always reachable — the rest of the page shrinks to make room instead of being hidden behind it, so you can keep reading the lead's details while you talk.

> [!IMPORTANT]
> Always dial from the lead's own **Call** button, not the dial pad inside the drawer itself. Dialing from the drawer's own pad bypasses RCM entirely, so that call won't get attached to the right lead.

Don't want to switch yet? Click **"Prefer your Aircall Desktop app instead?"** inside the drawer — this only affects your own account, and you can switch back any time by clicking the headset icon again.

#### Lead Navigation Bar (v5.16.0 — New)

A **sticky Prev / Next bar** appears at the top of every lead detail page, showing your position in your current filtered lead list.

- Click **← Prev** or **Next →** to move to the adjacent lead without going back to the table
- The bar shows **Lead X of Y** and the name of the neighbouring lead
- **Keyboard shortcuts:** `Alt+←` (previous) and `Alt+→` (next)
- The navigation list follows your current filters and sort order — so if you filtered by "Calling" status, Prev/Next only moves through Calling leads

> [!TIP]
> Lead Navigation is perfect for power-dialling sessions — open a lead, make the call, log the outcome, then press `Alt+→` to jump straight to the next lead.

#### Multi-Number Split Button (v5.16.0 — New)

When a lead has **more than one phone number** on file (e.g. mobile + company phone), the call button becomes a **split button**:

- **Left side** — calls the currently selected number immediately
- **Right side (▾ arrow)** — opens a dropdown picker showing all available numbers

Select a number from the dropdown to dial it. RCM remembers the last number you picked for the duration of your session.



#### RCM Dialer (Browser or Phone Bridge)

If your admin has assigned you to the RCM dialer, calls are placed directly from RCM — no external app required. There are **two call modes** to choose from each time you dial:

**Step 1 — Click the 📞 Call button** on any lead detail page (or the leads list).

**Step 2 — Choose your call mode:**

| Mode | What happens |
|---|---|
| **🌐 Browser Call** | Audio runs in your browser via WebRTC. Your headset or laptop mic/speakers are used. No phone needed. |
| **📱 Phone Bridge** | RCM first calls your registered phone number. Answer your handset, then RCM dials the lead and bridges the two calls together. |

Click **Place Call** to start.

**Step 3 — Watch the call widget:**

A floating widget appears in the bottom-right corner showing the lead's name and number.

- **During ringing — Browser Call:** The widget shows "🎧 Lead's phone is ringing — you'll hear them when they answer." You don't need to do anything else.
- **During ringing — Phone Bridge:** The widget shows "📱 Your phone will ring — answer it to connect." **Pick up your phone** when it rings — this connects you to RCM's bridge, and then RCM dials the lead.
- **Once connected:** The timer starts and you see **Mute**, **Hold**, and **Hang Up** buttons.

**Widget controls:**

| Button | Action |
|---|---|
| **Mute** | Silences your microphone. The lead cannot hear you. Tap again to unmute. |
| **Hold** | Places the lead on hold. Resume by tapping Hold again. |
| **Hang Up** | Ends the call and closes the widget. |

> [!IMPORTANT]
> **Browser Call requires microphone permission.** When your browser asks "Allow microphone access?", click **Allow**. If you accidentally clicked Block, go to your browser's site settings (🔒 lock icon in the address bar → Microphone → Allow) and reload the page.

> [!NOTE]
> **Phone Bridge mode — always answer your own phone first.** The call does not connect to the lead until you pick up your handset. If you ignore your ringing phone, the widget will show "Ringing…" but the lead will never receive the call.

> [!TIP]
> The call widget is **draggable** — click and hold the header to move it anywhere on screen so it doesn't block your lead detail view.

**If the call fails:**

- If the widget shows ⚠️ "RCM did not return audio credentials — try again or switch to Phone Bridge", the call did not go through. Tap **Try Again** or switch to Phone Bridge mode.
- If the widget shows ⚠️ "Browser audio failed", your browser could not open the microphone or connect to the audio server. Close the widget (it resets automatically), check your microphone permissions, and try again.

**After the call:**

The call is **automatically logged** with duration, recording link (if enabled), and transcript (if available). You do not need to manually log RCM calls — they appear in the **Calls** tab immediately after the widget closes.


#### Calls Tab

The **Calls** tab on lead detail shows a unified view of all calls (both manual and Aircall):

- **Stats bar** — Total Calls, Connected, Average Duration, Last Called
- **Call cards** — each call shows outcome, duration, timestamp, and notes
- **🎙️ Call Recording** — if available, an embedded audio player lets you listen to or download the recording
- **📄 Transcript** — if available, an expandable section shows the call transcript

#### Email Tab

The **Email** tab (visible only if Email Sync is enabled and connected) shows:

- **Threaded email conversations** — grouped by subject line
- **Compose new email** — click **✉️ New Email** to compose and send directly from RCM
- **Reply to emails** — inline reply within any thread
- **Clean previews** — quoted text, forwarded messages, and signatures are stripped from email previews

**Email Open Tracking:**

Outbound emails sent from RCM automatically include a tracking pixel. When the recipient opens the email, RCM records the event:

- **Green "Opened" badge** — appears on outbound email bubbles when the recipient has opened the email. Shows the total view count and first-opened timestamp (e.g., "Opened · 3 views · First opened 2h ago")
- **Gray "Sent" badge** — appears on outbound emails that have not been opened yet
- **Eye icon** — a professional CSS-only eye icon (no emojis) indicates tracking status

> [!NOTE]
> Open tracking requires a Nylas production application. The tracking pixel is invisible to recipients and does not modify email content or rewrite links.

> [!TIP]
> Use open tracking to prioritize follow-ups — if a lead has opened your email multiple times, they may be interested and ready for a call.

#### Conversations Tab — Floating Messaging Widget

When a Super Admin has enabled **RCM Messaging** (Settings → Sync), SDRs can send and receive WhatsApp/SMS messages with leads using the **floating RCM widget**:

- **💬 Message button** — A green **Message** button appears in the action row at the top of every lead detail page. Click it to open the floating RCM widget with the lead's name and phone number pre-loaded — no page reload required.
- **Floating widget surface** — the widget floats over the page so you can message while still viewing the lead detail. It is the only messaging interface — there is no embedded iframe.
- **Active call awareness** — if a call is in progress, the widget shows the live call timer and a Hang Up button alongside messaging controls.
- **No-phone guard** — if the lead has no phone number, the widget shows a clear "No phone number" notice instead of a blank compose area. Assign a phone number to the lead first.
- **Phone-based matching** — the lead's primary phone number is used. If primary is missing, the secondary phone is used automatically.

> [!NOTE]
> The Conversations widget requires admin configuration — a Super Admin must enable **RCM Messaging** in **Settings → Sync** for the Message button and widget to appear. SDRs without this enabled see no UI change.

#### Notes
- Type in the notes box and click **Save Note** to add a note
- Notes are time-stamped and attributed to you
- Click **✕** to delete a note

#### Tasks
- Type a task title, optionally pick a **due date** and a **due time** (time picker added in v4.6.2), and click **Add**
- Setting a specific due time ensures your task notifications fire at the right moment
- Check the checkbox to mark a task done
- Click **✕** to delete a task

> [!TIP]
> If you set a task with a time, the notification panel will surface it at the exact time — not just on the due date. Always set a time for scheduled callbacks.

**← Back to Leads** returns you to the leads list.

---

### Pipeline (Kanban Board)

Click **Pipeline** in the sidebar to see all your leads as cards organized by status column.

- **Drag a card** from one column to another to update the lead's status instantly
- Click **📞** on a card to log a quick call

---

### Task Notification Bell

The **🔔 bell icon** in the top-right bar shows how many tasks are due. Click it to open the **Notification Panel**.

> [!NOTE]
> The notification bell is only visible to **SDRs**. Admins manage tasks directly from lead detail pages.

#### When Tasks Surface

A task appears in the notification panel when **all** of these are true:
- Its **due date** has been reached or passed
- A **due time** was set and that time has also passed
- The task has not been marked done, dismissed, or snoozed (or the snooze period has expired)

The panel polls the server every **30 seconds** automatically in the background — you never need to refresh the page.

> [!IMPORTANT]
> Tasks created **without a due time** will **not** appear in the notification panel. Always set a time when scheduling a callback — use the time picker on the task form inside any lead detail page.

#### Notification Panel

Each item in the panel shows:
- **Task title** and **time since due** (e.g. "15m ago")
- **Lead name** and company
- Action buttons: **Snooze** and **Dismiss** and **Open Lead**

**Snooze** — temporarily hides the notification and resurfaces it after:
- **⏰ 15m** — snooze for 15 minutes
- **⏰ 1h** — snooze for 1 hour

The snoozed task will reappear automatically when the snooze window expires on the next poll.

**Dismiss** — permanently removes the notification from the panel. The task itself is **not deleted** — it remains on the lead detail page so you still have a record. Use dismiss when you have handled the task outside the app (e.g. made the call, closed the callback).

**Open Lead** — closes the panel and navigates directly to the lead's detail page.

> [!NOTE]
> Snooze and Dismiss only update the UI **after the server confirms** the action. If there is a network issue, the button re-enables with an error tooltip so you can retry — preventing ghost tasks from disappearing silently.

#### Badge Count

The bell icon shows a **red badge** with the number of currently due tasks (shows **9+** when more than 9 are due). The badge disappears when all tasks are snoozed, dismissed, or marked done.

#### In-App Chime

When the poll detects **new** tasks since the last check, a soft two-tone chime plays automatically. This alerts you even if the browser tab is in the background.

#### Browser Push Notifications

RCM also sends **native browser push notifications** when new tasks become due:

1. The first time the system detects a due task, your browser will show a **"Allow Notifications?"** prompt
2. Click **Allow** to enable push notifications
3. From that point on, a system-level notification will pop up each time new tasks are detected — even if RCM is not the active tab

The push notification shows:
- **Title:** RCM — Task Reminder
- **Body:** "You have X pending task(s) due now."

If you click **Block** on the browser prompt, push notifications will be silenced. You can re-enable them from your browser's site settings (usually via the 🔒 lock icon in the address bar → Notifications → Allow).

> [!TIP]
> Keep your browser tab open throughout the day — the 30-second polling and push notifications together ensure you never miss a scheduled callback, even while working in another tab.

---

### Search

Use the **search bar** at the top of any page to find leads by **name**, **email**, **company**, or **phone number** (including partial matches and +country code format).

#### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` (Mac) / `Ctrl+K` (Windows) | Focus the search bar instantly from anywhere |
| `/` (forward slash) | Focus the search bar (when not in a text field) |
| `Escape` | Close search / clear focus |

A subtle **⌘K** hint badge is displayed inside the search bar as a visual reminder.

> [!NOTE]
> SDR search is scoped to your assigned leads only. Super Admins and Pod Admins see all leads matching the query.

---

### View As (Super Admin Only)

Super Admins can preview the platform as any other role using the **View As** feature:

1. Click your **avatar** in the bottom-left sidebar
2. Select **View As** and choose a user to impersonate
3. An **amber banner** appears at the top confirming View-As mode is active
4. Click **Exit View As** in the banner to return to your admin session

> [!IMPORTANT]
> View-As uses an isolated session token — your real admin credentials are never overwritten. The impersonated session is temporary and clears when you exit or close the browser tab.

---

### SDR Settings

Click **⚙️ Settings** in the sidebar to manage your integrations.

#### Email Sync Card

Connect your email to send and receive emails directly from RCM:

1. Click **🔗 Connect Email** — you'll be redirected to Google/Microsoft OAuth
2. Authorize RCM to access your mailbox
3. After successful connection, you'll be redirected back to Settings with a **✅ success toast**
4. The card will now show **"Connected as your@email.com"** with a Disconnect option

> [!IMPORTANT]
> You can only connect the email that matches your Google SSO login. Connecting a different email address will be rejected.

#### Aircall Dialer Card

Shows whether the Aircall dialer is enabled for your account. This is managed by your admin — contact your Pod Admin or Super Admin to request access.

#### Notifications Card

This card is a placeholder for future per-user notification preference controls (e.g. muting chimes, configuring push notification thresholds). In-app and browser push notifications are **already active** for all SDRs via the 🔔 bell icon in the top bar — no configuration is required.

---

### Leaderboard

Click **Leaderboard** in the sidebar. SDRs are ranked by **meetings booked** and displayed with:
- **Time-Period Presets** — switch between **7 Days**, **30 Days**, **90 Days**, and **All Time** to see rankings for any window
- **Leader Spotlight** — three cards at the top showing the **#1 SDR** for 7-Day, 30-Day, and All-Time periods
- **Top 3** highlighted as medal cards with calls today, total calls, and conversion rate
- Full table with rank, POD name, and all performance metrics
- **SDR Self-Highlight** — when an SDR views the leaderboard, their row is highlighted in blue with a "You" badge, even if ranked beyond top 3
- **Click any SDR name** to drill into their **Performance Analytics** page (see below)

---

### SDR Performance Analytics

Click any SDR name on the Leaderboard to view a detailed performance drill-down.

#### Metric Cards
Eight key metrics displayed as cards:

| Metric | Description |
|---|---|
| **Leads Assigned** | Total leads ever assigned to this SDR |
| **Active Leads** | Currently active (non-closed) leads |
| **Leads Closed** | Leads moved to a terminal or completed status |
| **Calls Made** | Total call logs recorded |
| **Avg Calls/Lead** | Average number of calls per assigned lead |
| **Meetings** | Meetings booked (converted leads) |
| **Conv. Rate** | Conversion percentage (meetings / total leads) |
| **Avg Time/Lead** | Average time from lead assignment to close |

#### Pipeline Funnel
A horizontal bar chart showing the distribution of the SDR's leads across all pipeline stages — Lead Assigned, Research, Calling, Meeting Scheduled, Customer Declined, Unreachable — with percentages.

#### Efficiency Metrics
- **Avg Time Per Lead** — average hours/days from assignment to resolution
- **Median Time Per Lead** — median value (better for skewed distributions)

#### Time Period Filters
Switch between **Today**, **This Week**, **This Month**, and **All Time** to view performance for specific periods.

---

### SDR Usage Metrics (Admin Only)

Click **📊 SDR Metrics** in the sidebar (Pod Admin / Super Admin only).

- **Date Range Picker** — use From/To date inputs or quick preset buttons (**7D**, **30D**, **90D**, **180D**) to filter metrics by time period
- **Summary Cards** — total calls, meetings, active leads, and conversion rate for the selected period
- **Daily Trend Chart** — line chart showing daily activity over the selected range
- **Per-SDR Performance Table** — sortable table with each SDR's metrics
  - **Search Filter** — type to filter rows by SDR name in real time
  - **Pagination** — 10 rows per page with Prev/Next controls and a "Showing X–Y of Z" counter

---

### Activity Feed (Admin Only)

Click **📡 Activity Feed** in the sidebar (Pod Admin / Super Admin only).

The Activity Feed gives leaders a unified, real-time view of **all SDR interactions** — calls, emails, status changes, and research — across the entire team. Its primary purpose is to help you understand: *What happened? How was the customer connected? What's pending? What was gathered?*

#### What You See

**Stats Cards (top row):**

| Card | Description |
|---|---|
| **Total Activities** | Count of all interactions in the selected period |
| **Meetings Booked** | Total meetings scheduled |
| **Call Connect Rate** | Percentage of calls that connected |
| **Emails** | Total emails sent/received |

**Type Tabs:** Filter by: **All**, **📞 Calls**, **📧 Emails**, **🔄 Status**, **🔬 Research** — each tab shows a count badge.

**Filter Bar:**
- **POD filter** — view a specific team's activity
- **SDR filter** — drill into one SDR's interactions
- **Outcome filter** — e.g. focus on "Meeting Scheduled" or "Call Back Later"
- **Date Range** — Today, Yesterday, Last 7/30 Days, This Quarter, All Time
- **Search** — type a lead name or company to search across all time (date filter is automatically bypassed during search)

**Table Columns:**

| Column | Description |
|---|---|
| **Type** | Call, Email, Status, or Research icon |
| **Date / Time** | When the interaction happened + relative time (e.g. "2h ago") |
| **Lead** | Lead name (clickable → navigates to lead detail) + current status badge |
| **Company** | Lead's company |
| **POD** | Which POD the SDR belongs to |
| **SDR** | Who performed the action |
| **Outcome / Action** | Call outcome, status transition, or email direction. A green **REC** badge appears when a call recording is available |
| **Notes / Summary** | Preview of call notes, email subject, or strategy context |

#### Expanded Detail View

Click any row to expand and see the full context:

**For Calls:**
- **🎯 Call Strategy** — the personalization angle and research hypothesis the SDR used
- **📝 Call Notes** — what happened during the call, including outcome and duration
- **🎙️ Call Recording** — clickable player to listen to the recording (if available)
- **📃 Call Transcript** — scrollable transcript of the call (if available)

**For Emails:**
- **Subject**, **Direction** (Inbound/Outbound), **SDR**
- **Email body** preview in a scrollable panel
- **Open tracking** — how many times the email was opened

**For Status Changes:**
- Visual badge transition showing the from → to status and who made the change

#### Deduplication

The feed shows only the **latest activity per lead per type** — so if a lead has had 5 calls, you'll see only the most recent one. This keeps the feed clean and focused on the latest state.

#### CSV Export

Click **📥 Export CSV** to download all filtered activities as a spreadsheet — includes Type, Date, Lead, Company, POD, SDR, Outcome, Duration, Notes, and Call Strategy.

#### Access Control

| Role | Scope |
|---|---|
| **Super Admin** | Sees activity across all PODs and SDRs |
| **Pod Admin** | Sees only their POD's SDR activity |
| **SDR** | No access — Activity Feed is hidden from the sidebar |

---

### Sales Cadences (what you'll see)

**Sales Cadences** are automated outreach sequences — a Pod Admin or Super Admin builds one (e.g. "email → wait 3 days → call"), and it runs on its own once a lead enrolls. You won't build or edit cadences, but you'll see their effect in two places:

- **On a lead's detail page**, a **🧭 Sales Cadence** card appears if that lead is currently enrolled in one. It shows the cadence name, its current step (e.g. "Currently at: Email #2"), and a status:

  | Status | Meaning |
  |---|---|
  | In progress | Actively moving through the cadence |
  | Completed | Finished every step |
  | Paused | An admin paused the whole cadence — nothing will run until resumed |
  | Failed / Exited | Stopped early — a reason is shown (e.g. "Contact suppressed", "Send failed") |

  If it's **In progress**, a second line explains what's happening right now — e.g. "Waiting for its scheduled time" or "A previous send failed — retrying automatically." If you ever see the same lead stuck on the same step for a long time with no explanation, flag it to your Pod Admin.

- **On the Leads page**, selecting one or more leads and using the bulk-action bar gives you an **Enroll in Cadence** option, if any cadence has been published. You'll pick a cadence from the list and confirm — leads already active in that cadence are skipped automatically.

> [!NOTE]
> A "Call" step in a cadence never places an automated call — it creates a **Task** reminding the assigned SDR to call, same as a manually-created task. A human always makes the call.

---

## For Pod Admins

You have everything SDRs have, plus the sections below.

---

### All Leads

Pod Admins see **All Leads** across their POD (not just their own). The leads page includes:
- Tabs: **All Leads** and **Assignments**
- **Assigned To** column showing which SDR owns each lead
- Status filter and search across all pod leads

> [!NOTE]
> Pod Admins can view leads from other PODs in **read-only** mode — editing is restricted to your own POD's leads.

---

### Assignments Tab

Click the **Assignments** tab within the Leads page.

#### SDR Filter
Use the **SDR filter dropdown** at the top to filter both Unassigned and Assigned tables by a specific SDR. This is useful when you want to review or manage a particular SDR's workload.

#### Assigning Leads Manually
1. Check the leads you want to assign in the **Unassigned Leads** table
2. The **floating action bar** slides up showing how many are selected
3. Choose an SDR from the dropdown in the action bar
4. Click **Assign →**

#### Round Robin Auto-Assign
Click **🔄 Round Robin Auto-Assign** to distribute all unassigned leads evenly across your POD's SDRs. Each SDR has a configurable **Active Lead Cap** — leads beyond the cap are skipped.

#### Bulk Unassign
1. Use the **SDR filter** to view leads assigned to a specific SDR
2. Check the leads you want to unassign in the **Assigned Leads** table (or use **Select All**)
3. Click **Unassign Selected** in the floating action bar
4. Confirm the action in the modal

> [!TIP]
> Bulk unassign is useful when an SDR leaves the team or is reassigned — filter by their name, select all, and unassign in one click.

#### Bulk Delete (Super Admin Only)
1. Select leads from either the Unassigned or Assigned table
2. Click **🗑️ Delete Selected** in the floating action bar
3. Confirm the deletion — this action **permanently removes** the leads and all associated data (notes, tasks, calls, research)

> [!CAUTION]
> Bulk delete is irreversible. Only Super Admins and Admins can delete leads. Pod Admins do not see the delete option.

#### Unassigning a Single Lead
In the Assigned Leads section, click **Unassign** next to any SDR name.

---

### Admin Panel

Click **🛡️ Admin** in the sidebar. Pod Admins see their POD's users only.

- View SDR details, lead counts, and access status
- **Impersonate** a user with the **👁️** button to see their CRM view

---

### Settings (Pod Admin)

Pod Admins see a tabbed Settings page with:
- **Connection** tab — Salesforce connection status + **Data Summary** sidebar showing lead counts by pipeline stage
- **Sync Settings** tab — Lead Sync Settings (Sync Limit, Push Stage, Record Types, Sync Direction) and POD Settings

---

### Sales Cadences

**Sales Cadences** (nav item in the sidebar) is a visual builder for automated, multi-step outreach sequences — build one once, and every lead that enrolls runs through it on its own: send an email, wait, branch on a condition, create a call task, repeat.

#### Building a Cadence

1. Click **+ New Cadence**, give it a name. (You can rename it later — click the name at the top of the builder.)
2. In the canvas, use the toolbar buttons to add steps:

   | Step | What it does |
   |---|---|
   | **Trigger** | Defines how a lead enters — either "status changed to X" or "SDR/AE receives an email from the lead." Every cadence needs exactly one. |
   | **Email** | Sends an email (subject + body required). Personalize it with merge fields — click a field chip below the body to insert it, or type it directly: `{{first_name}}`, `{{last_name}}`, `{{company}}`, `{{title}}`, `{{email}}`, `{{phone}}`. Any lead that's missing a field just sends with that part blank. |
   | **SMS** | Sends a text message via your RCM connection (Settings → SMS must be enabled and configured first). Same merge fields as Email; 1600-character limit with a live segment-count estimate. |
   | **Wait** | Pauses before continuing — enter it as hours, minutes, and seconds. |
   | **Condition** | Branches on a timeout or a real event (e.g. the lead replied, an auto-reply/out-of-office came back instead, or a call was answered). |
   | **Call** | Creates a Task reminding the assigned SDR to call — **not** an automated call. |

3. Drag from one step to the next to connect them. Click a step to open its settings panel on the right.
4. **On an Email step**, click **Generate with AI** and describe what the email should be about (e.g. "Follow-up after a demo no-show") to draft a subject + body. You can edit the result before saving.
5. **To A/B test an email**, check **Split test this email** — this replaces the single subject/body with two variants (A and B), each edited separately. Leads are split evenly and deterministically between them; results are broken out per variant in the cadence's stats.
6. The header shows an **issue count** if anything's incomplete (e.g. a step missing a required field, or a step nothing links to) — hover the disabled **Publish** button to see exactly why it's blocked.
7. **Save** your draft as you go — it autosaves nothing on its own. Once everything's connected and issue-free, click **Publish**.

> [!NOTE]
> Publishing is re-checked on the server even if the canvas shows zero issues — a cadence with a blank email or a dangling branch cannot go live either way.

> [!NOTE]
> An auto-reply (out-of-office / autoresponder) is detected automatically and does **not** count as a real reply — it won't trigger an "Email replied" branch or start a new cadence via the email-received trigger. If you want a cadence to react to an auto-reply specifically, use the "Auto-reply received" event on a Condition step.

#### Restricting When Sends Go Out

The **clock icon** in the builder header (next to the pod selector) controls the cadence's send window — off by default (sends go out as soon as a step is due). Turn it on to restrict automated Email/SMS sends to business hours, specific weekdays, and a chosen timezone. A step that becomes due outside the window just waits until the next valid time — nothing is skipped or lost. This doesn't affect Wait/Condition timing or Call task creation.

#### Enrolling Leads

- From the **Leads** page: select leads → bulk-action bar → **Enroll in Cadence** → pick a published cadence → confirm. Enrolling more than 200 leads at once isn't supported from this screen — use a filter first to narrow the selection.
- Or set the cadence's **Trigger** to auto-enroll matching leads the moment the trigger event happens — no manual step needed.
- There's a per-cadence hourly enrollment cap (protects against a huge accidental bulk-enroll); if you hit it, the rejection tells you exactly how many you've used and to try again shortly.
- **Pod scoping**: a dropdown in the builder header (next to the status badge) lets you restrict auto-enrollment to one pod's leads — leads outside that pod won't be auto-enrolled by the trigger even if they match. Leave it on **All pods** (the default) for no restriction. This only affects the *trigger's* automatic enrollment — manually enrolling leads from the Leads page bypasses pod scoping, same as it always has.

#### Checking a Cadence Is Actually Working

Open a published cadence — the header shows its live status (**Active** / **Paused** / **Archived**, hover for what each means). Below the canvas, a **failed enrollments** panel lists any lead that got stuck or was blocked (e.g. suppressed, send failed, exceeded max steps), with **Retry** and **Skip** actions per lead. An empty panel means nothing has failed.

Right below that, an **Engagement** panel shows open/click/reply rates — overall, and per email step (with a per-variant breakdown if that step is A/B tested). It only appears once at least one send has gone out.

Click **Activity** in the header for a chronological, unified feed of every email and SMS this cadence has sent, plus every reply — one timeline instead of checking email and SMS history separately.

For a specific lead, check the **🧭 Sales Cadence** card on their detail page — it shows the exact step they're on and, if active, why (waiting on its own timer vs. blocked vs. retrying).

#### Pausing, Resuming, Archiving

- **Pause** freezes every enrolled lead exactly where they are — nothing runs until you **Resume**.
- **Archive** permanently stops the cadence and exits every active enrollment. You'll be asked to confirm the exact number of leads that will be exited, since it can't be undone.

---

## For Super Admins

You have everything Pod Admins have, plus the sections below.

---

### Dashboard (Super Admin)

The Super Admin dashboard shows an **org-wide view** with:
- **Total Leads**, **Lead Assigned**, **Calling**, **Meetings Scheduled** tiles
- **Recent Leads** table (instead of Priority Queue)
- **Leaderboard** widget (top 5 SDRs)
- **📊 Live Activity Feed** — real-time stream of status changes across the org

---

### Admin Panel (Super Admin)

Super Admins see **all users** across all PODs, organized by role tabs:

#### Tabs: Super Admins / Pod Admins / SDRs
- View, add, and manage users across all roles
- **Change roles** — promote SDRs to Pod Admin or Super Admin
- **Revoke / Restore access** — block login without deleting history
- **👁️ Impersonate** any user

#### User Activity Status

Each user row displays a real-time activity badge:

| Badge | Meaning |
|---|---|
| 🟢 **Active** | User had real activity (heartbeat or action) within the last 7 days |
| 🟡 **Idle** | Last real activity was 8–30 days ago |
| 🔴 **Inactive** | No activity for over 30 days |
| ⚪ **Never** | User has never logged in |

> [!NOTE]
> Activity status is based on real heartbeat and interaction data — not just login timestamps. Stale sessions (>30 min without heartbeat) are automatically closed to keep the data accurate.

#### Per-SDR Feature Toggles

In the **SDRs** tab (and the **Pod Admins** tab), each user row has two toggle buttons:

| Toggle | Description |
|---|---|
| **📞 Dialer Access** | ON/OFF — enables or disables the Aircall click-to-call dialer for this user |
| **✉️ Email Sync** | ON/OFF — enables or disables the Email Sync tab for this user |

Click the toggle button to switch between ON (green) and OFF (gray). Changes take effect on the user's next page load.

#### Adding a User
1. Click **+ Add User**
2. Enter name, email, and role (Super Admin, Pod Admin, or SDR)
3. Optionally assign to a POD
4. Click **Add User**

#### Bulk SDR Upload via CSV
Click **📤 Upload CSV** in the SDRs tab.

```
email,name,action
alice@company.com,Alice Smith,add
bob@company.com,Bob Jones,remove
```

---

### POD Management

Click **👥 PODs** in the sidebar (Super Admin only).

#### Creating a POD
1. Click **+ Create POD**
2. Enter a POD name and select a Pod Admin
3. Click **Create**

#### Managing Members
- Each POD card shows the admin, member list, and lead counts
- Use the **Add SDR** dropdown to add team members
- Click **Remove** to take an SDR out of a POD
- Click **🗑️** to delete a POD entirely

---

### Salesforce Integration Logs

Click **📋 SF Logs** in the sidebar (Super Admin only). This dashboard shows every Salesforce API interaction.

#### Filters
Filter logs by **Status** (Success/Failed), **Operation** (Create/Update/Upsert/Fetch/Query), **Object** (Lead/User/RecordType), **Date Range**, and **Search** (record ID, name, email).

#### Features
- **Stats row** — Total logs, page count, success count, failed count
- **Sortable table** — timestamp, operation badge, status icon, lead name, email, record ID
- **Click 🔍** on any row to see full detail: request/response payloads, error messages, fields updated
- **📥 Export CSV** — download filtered logs as CSV
- **Auto-refresh** — toggle 30-second auto-refresh
- **Pagination** — 20 logs per page

---

### Call & Pipeline Settings

In **Settings**, Super Admins see the **📞 Call & Pipeline Settings** card with these configurable parameters:

| Setting | Description | Default |
|---|---|---|
| **Active Lead Cap (per SDR)** | Maximum active leads an SDR can have. Affects Round Robin assignment — SDRs at cap are skipped. Set to `0` to pause all assignments. | 5 |
| **Max Call Attempts** | Number of No Answer/Voicemail attempts before a warning is shown to the SDR suggesting the lead may be unreachable. | 5 |
| **Min Attempts for Unreachable** | Minimum No Answer/Voicemail attempts before the "Mark as Unreachable" option unlocks in the call modal. | 3 |
| **Terminal Lead Cooldown (days)** | Days before a terminal lead (Unreachable/Customer Declined) can be recycled back into the pipeline. Set to `0` to disable recycling. | 30 |

#### Salesforce Sync Options
- **Sync Customer Declined** — when enabled, leads marked Customer Declined are pushed to Salesforce
- **Sync Unreachable** — when enabled, leads marked Unreachable are pushed to Salesforce

---

### Syncing Salesforce

The **🔄 Sync** button in the top bar syncs your CRM with Salesforce.

**What happens during sync:**
1. If **Two-Way** sync is enabled: new/changed leads are pulled FROM Salesforce
2. Leads at the configured **Push Stage** (default: Meeting Scheduled) are pushed TO Salesforce
3. Status updates for existing SF leads are synced
4. If enabled, **Customer Declined** and **Unreachable** leads are also synced

> [!IMPORTANT]
> Leads are de-duplicated during upload by email, phone (last 10 digits), LinkedIn URL, and name+company combination.

---

### Upload Center

Click **📤 Upload Center** in the sidebar (Super Admin only). This is a dedicated page for importing enriched lead sheets.

#### How to Upload

1. **Choose File** — drag and drop a CSV/XLSX/XLS file, or click **browse** to select one
2. **Map Fields** — the system auto-detects columns; adjust mappings if needed using the dropdowns
3. **Import** — click **🚀 Import Leads** to create leads with smart duplicate detection
4. **Results** — view a detailed breakdown of created, updated, skipped, and duplicate rows

#### Phone Validation (Automatic)

The upload system automatically validates phone numbers during import:

- A lead is considered to have a valid phone if **any** of `phone`, `phone_secondary`, or `company_phone` contains **≥7 digits**
- **Rows without any valid phone** are automatically skipped — the import summary shows the count as `no_phone_skipped`
- If `phone` is empty but `phone_secondary` or `company_phone` has a valid number, it is **promoted** to the primary `phone` field
- This validation applies to both **CSV uploads** and **Google Sheet imports**

> [!IMPORTANT]
> Leads without phone numbers cannot enter the system. If your sheet has leads without phone data, they will be skipped. Add phone numbers to the sheet and re-upload to include them.

#### No Phone - Parked Status

Leads that somehow enter the system without a phone number are automatically set to **"No Phone - Parked"** status:

- Parked leads are **never assigned to SDRs** via bulk-assign or auto-assign
- They are **excluded from analytics** (funnel, SDR table, daily digest, dashboard totals)
- The admin dashboard shows a red **📵 No Phone** card with the count of parked leads
- **Auto-revert:** When a phone number is added to a parked lead (via lead edit), the status automatically changes to `"Lead Assigned"`. If an SDR adds the number, the lead is assigned to them; Admin-level edits keep it unassigned

#### Update Existing Leads

Toggle **"Update existing leads"** before uploading. When enabled, if a duplicate is found (by email, LinkedIn, phone, or name+company), the existing lead's fields are updated with new data instead of being skipped.

#### Assign to Pod on Upload

Use the **"Assign to Pod"** dropdown in Step 1 to distribute newly imported leads across an entire Pod's SDR team via round-robin:

- **Default:** `— No pod assignment —`
- **Select a Pod** — leads are distributed via intelligent round-robin across all active SDRs in that Pod
- **Company grouping:** Leads from the same company are always routed to the **same SDR** to avoid split outreach
- Selecting a Pod **clears the SDR dropdown** automatically (and vice versa — they're mutually exclusive)

#### Assign to SDR on Upload

Use the **"Assign to SDR"** dropdown to assign all newly imported leads directly to one specific SDR.

- **Default:** `— No assignment (unassigned) —` — leads are created but not assigned to any SDR
- **Select an SDR or Pod Admin** — all newly imported leads are immediately assigned to the selected user
- Only **SDR** and **Pod Admin** roles appear in the dropdown
- Duplicates that are updated (when "Update existing leads" is on) are **not re-assigned**

> [!TIP]
> Use **Assign to Pod** when distributing a large batch evenly across a team. Use **Assign to SDR** when the entire upload belongs to one person.

#### Tagging Uploads

Use the optional **🏷️ Tag** text field to label an upload with its source (e.g. "Apollo", "Lusha", "Hunter"). Tags help you track where enriched lead lists originated.

- Tags are displayed as a chip next to the filename in the upload history table
- If no tag is entered, the upload is shown without a tag ("No Tag")
- Tags are stored in the database and can be used for future filtering and reporting

#### Google Sheets Import

Click the **📊 Google Sheets** tab to import directly from a public Google Sheet:

1. Paste the Google Sheets URL
2. Select **Assign to SDR** if needed
3. Click **📊 Fetch Sheet** — the system previews the data
4. Map fields and import

> [!NOTE]
> The Google Sheet must be publicly accessible (Share → Anyone with the link → Viewer).

#### Email Validation

The upload system validates email addresses before using them for duplicate detection. Values that don't look like emails (e.g., company names like "Vasan Eye Care" in the Email column) are **ignored for dedup purposes** but still stored on the lead record.

#### Upload History

At the bottom of the Upload Center, a history table shows all past uploads with file name, tag (if provided), uploader, status, created/updated/skipped counts, and date.

#### Stats Cards

Four summary cards at the top show: **Total Uploads**, **Leads Created**, **Leads Updated**, and **Duplicates Skipped** across all uploads.

Supported fields: `first_name`, `last_name`, `email`, `phone`, `company`, `title`, `linkedin_url`, `person_linkedin`, `website`, `city`, `state`, `country`, `industry`, `employee_count`, `annual_revenue`, `total_funding`, and more.

---

### Creating a Lead Manually

Click **+ New Lead** in the top bar, fill in the details, and click **Save**. Manual leads are created locally (not pushed to Salesforce until they reach the Push Stage).

---

### Settings (Super Admin)

#### Lead Sync Settings

| Setting | Description |
|---|---|
| **Lead Sync Limit** | Max leads per sync. `0` = unlimited. Default: `1000` |
| **Salesforce Push Stage** | Status that triggers push to SF (default: Meeting Scheduled) |
| **Record Types to Sync** | Select which SF Record Types to include in sync |
| **Sync Direction** | **Push Only** (CRM → SF) or **Two-Way** (also pulls from SF) |

#### POD Settings

| Setting | Description |
|---|---|
| **Allow SDR in Multiple PODs** | When enabled, SDRs can belong to more than one POD simultaneously |

---

## Pipeline Statuses

| Status | Meaning |
|---|---|
| **Lead Assigned** | New lead assigned to an SDR, awaiting research |
| **Research** | SDR is completing guided research on the lead |
| **Calling** | Lead is in the active calling queue |
| **Meeting Scheduled** | Meeting booked — lead is pushed to Salesforce ✅ |
| **Customer Declined** | Customer declined interest during calling — terminal status ⚠️ |
| **Unreachable** | Lead could not be reached after multiple attempts — terminal status 🔴 |
| **Lead Unassigned** | Lead has no SDR assigned (visible in admin views) |

> [!NOTE]
> **Terminal statuses** (Customer Declined, Unreachable) remove the lead from the SDR's active pipeline, freeing up capacity under the Active Lead Cap. After the configured cooldown period, terminal leads can be recycled back into the pipeline.

---

## Tips & Best Practices

- **Start your day** on the Dashboard → work through New Leads and Research Pending first
- **Complete research** before calling — the Call button unlocks after research is done
- **Log every call** — even No Answers — so dashboard metrics stay accurate and attempt tracking works
- **Watch for Unreachable warnings** — when the system warns you after multiple failed attempts, consider marking the lead as Unreachable to keep your pipeline clean
- **Use the Leaderboard** to motivate your team — rankings update in real time
- **Drill into SDR Performance** — click any name on the Leaderboard to see detailed analytics
- **Super Admins**: check the SF Logs dashboard after syncing to verify operations succeeded
- **Super Admins**: configure Call & Pipeline Settings to match your team's workflow
- **Pod Admins**: run Round Robin after each sync to distribute new leads evenly

---

*RCM · Phase 4 · v5.6.0 · Last updated 4 May 2026*
