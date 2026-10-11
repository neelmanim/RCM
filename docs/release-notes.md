# Release Notes — Alternate CRM

## v14.3.0 — 10 Oct 2026
**See who the work is going to — by industry, country, city, job level and more:**
- **Drill-down in Team Digest.** Under the Funnel, pick any period and see calls, conversations and meetings broken down by ICP fit, industry, country, city, seniority, function, company size or lead source. Where a lead has no value on record it is listed last as "Not filled in", so the gaps are easy to see.
- **Accounts.** See each company that was worked: how many people were tried, how many you spoke to, and where it stands (meeting booked, spoke but no meeting, tried but not reached).
- **Calls.** How calls ended, which hours connect best, and how long conversations last.
- **Conversion and change.** Each group shows how many of its leads you spoke to, meetings booked per 100 conversations and how many held — and an arrow beside the main numbers shows how it moved against the period before.
- **Follow any number to the people.** Click a row (or an account) to see the leads behind it, and click a lead to open it. Rates based on only a few calls are shown in grey so nobody reads too much into them.
- **See where leads came from.** Lead source is now a short list (uploaded file, Google Sheet, Klenty…), and **Upload file** shows each file separately.
- **Healthcare is recognised properly.** The ideal customer profile now covers hospitals, clinics, dental, medical practices and devices, and pharma, not only the word "health".
- **Download it.** Anyone allowed to export can download the drill-down as an Excel file (breakdown, accounts, calls). Every download is recorded.
- **ICP you can change.** Super Admins can edit what counts as your ideal customer (healthcare today) and every breakdown updates at once. Changes are recorded.
- **Guided tours that work.** Every page's tour now waits for the page to load, can be stepped back, and no longer closes itself or marks itself as seen when nothing was shown. Replay any tour from the new **Guide** button at the top of the page, or from **Help → Guided tours**. The Team Digest and Control Center tours are rewritten, and the Sales Tools and Analytics tours are brought up to date. Only one tour shows at a time.
- **Small "i" explanations.** Every new column and number in the drill-down and Funnel has an "i" that says in plain words what it counts and why it matters.
- **Ask Claude about the Team Digest.** The Claude connector can now read the Team Digest, its breakdowns, accounts, calls and the ICP words (read-only; a Pod Admin still sees only their own pod).
- **Clearer Salesforce field messages.** If you add a field Alternate CRM already sends (like Country), it now tells you which built-in field covers it and how to change it. If Salesforce has no such field, it explains where to find the exact name. The message also clears by itself.

## v14.2.0 — 10 Oct 2026
**Settings that always show the truth, a permanent record of exports, and Salesforce fields you can edit:**
- **Switches now update straight away.** When you changed a setting (for example turning Data Export off for someone) the message said it worked but the switch could still show the old value until a hard refresh. That is fixed: the list is always read fresh, the table no longer blinks, and the rows stay in the same order.
- **Export History.** Control Center → Team & Access → Export History shows every CSV or Excel download with who took it and when, plus every change to who may export. It is kept permanently and cannot be edited. Only Super Admins can see it.
- **Salesforce field changes are recorded.** Each added mapping shows who added it and when, and **History** lists every add, change and removal.
- **Built-in Salesforce fields are editable.** Everything except first name, last name, email, phone and status can now point at a different Salesforce field or be switched off, and can be reset to Alternate CRM's default.
- Custom date ranges in Team Digest only allow past days, and the calendar opens fully on screen.

## v14.1.0 — 9 Oct 2026
**Team Digest, a sales funnel, data export you switch on per person, and a tidier Salesforce section:**
- **Daily Digest is now Team Digest.** Look at yesterday, last 7 days, last week, last 30 days, this month, last month or any dates you choose (up to 92 days). Every number is compared with the period right before it.
- **Campaigns in the Digest.** See what was worked per campaign, and which campaign each lead belongs to. Click a campaign to see just its leads.
- **Your own numbers.** Choose which numbers show at the top and in what order (17 to pick from, up to 10 at a time), and save the set as a named view of your own.
- **Funnel.** Accounts given, conversations, meetings booked, meetings already in Salesforce and meetings held — for the same period, by rep or campaign.
- **Exporting data is now off by default.** Super Admins can export unless another Super Admin switches them off. Everyone else, including Pod Admins, can only download CSV or Excel files after a Super Admin switches **Data Export** on for them (Control Center → Team & Access → Users). Every download is recorded, and a CSV attached to a scheduled report follows the same rule.
- **Salesforce section rebuilt** (Control Center → Integrations → Salesforce). Connection, what syncs, schedule and field mapping are now in one place; settings that move data between Alternate CRM and Salesforce ask you to confirm first. A new overview shows how many leads are in Salesforce. The field mapping table can be searched, sorted and edited, and every message names the Salesforce object. Record types explain that none ticked means all are read.
- **Share a Digest view with the team.** Admins can share a saved set of numbers with everyone; others can use it but not change it.
- Choosing a custom date range now starts from the last 7 days instead of an empty page, only lets you pick past days, and the calendar always opens fully on screen.
- Pod and call rules moved to **Pod & Call Rules**; the Team table shows 8 reps at a time.

---

## v14.0.1 — 9 Oct 2026
**Activity Monitor now shows only your own team, and email numbers are honest:**
- **Pod Admins see only their own pod's reps** in Activity Monitor and Call Monitor. A rep from another pod calling a lead in your pod no longer shows up for you.
- **Email open rate can no longer go above 100%.** *Opened* now counts the leads who opened, against the leads emailed.
- **Emails from colleagues are no longer logged as lead replies.** Mail from a teammate's address no longer appears in a lead's activity or in the Activity Monitor.
- Deleted leads no longer appear in the Activity Monitor's email list.

---

## v14.0.0 — 9 Oct 2026
**A Daily Digest built for team leads, tighter pod access, and a faster search:**
- **Daily Digest, rebuilt:** each rep's calls, emails sent, research notes and meetings booked for the day, against the same weekday last week. Click a number to see the leads behind it, click a rep to see only their leads, and use *Needs attention* to jump to idle reps and overdue follow-ups.
- **Leads touched:** every lead worked that day, overdue follow-ups first, with filters, search and pages. **Export Excel** gives the whole digest (summary, team, every lead) in one file.
- **The team's own day:** the digest follows the pod's time zone; Super Admins can pick a pod.
- **View As for Pod Admins:** open the app as any SDR or AE in your own pod (eye icon in Team & Access); you can look but not change anything (it is read-only), and every use is logged.
- **Pod Admins see only their own pod** across the Activity feed, assignment lists, Reports, uploads, search, AE Pipeline and more. A Pod Admin with no pod set sees nothing until it is set.
- **Search is quicker and smoother** — no flicker while typing, repeat searches are instant.
- **Removing a user switches off all their access** and shows them as *Left* in reports.
- **Meetings per rep means meetings that person booked** (Leaderboard and Analytics). **Needs attention** on the Dashboard means no calls and no emails today.

---

## v13.12.0 — 8 Oct 2026
**People who leave, and a truthful Leaderboard:**
- **Removing a user now really removes them:** sign-in, dialer, messaging (SMS/WhatsApp) and email access are all switched off, their leads are released, and they disappear from the Calling & Messaging settings. Their history stays so past numbers still have a name.
- **A "Left" marker** appears next to people who have left on the Leaderboard, the Analytics rep table and the Dashboard; they no longer show up under "Needs attention".
- **Leaderboard "meetings" now means meetings the person booked** in the chosen period (it used to count meetings sitting on leads they currently hold, which credited whoever inherited a lead).
- Control Center → Integrations retries once if it can't load, and says why when it still can't.

---

## v13.11.0 — 8 Oct 2026
**Meetings, handed-over leads and a raw export:**
- Every meeting booking is now recorded on its own — who booked it, whether it was held, a no-show, or cancelled — whichever way it was booked.
- Your Dashboard now splits **Assigned to me** into **new**, **inherited** (someone else worked it first) and **in progress**.
- Admins and Pod Admins get **Export → Raw calls + meetings (Excel)** on the Dashboard, so any number can be checked row by row.
- The per-rep meetings column in Analytics no longer drops meetings that were booked through a call outcome.
- Lead statuses are unchanged.

---

## v13.10.0 — 8 Oct 2026
**Behind the scenes:** Alternate CRM now remembers who owned each lead and when, so reports can credit the right SDR even after a lead is reassigned.
Lead statuses are unchanged.

---

## v13.9.6 — 8 Oct 2026
**Easier to read:** the small text under each Dashboard number now shows in full instead of being cut off.

---

## v13.9.5 — 8 Oct 2026
**A Dashboard that works for you:** every number is now clickable and opens exactly those leads (Given today, Not yet called, Calling, Meetings…).
**My Day** pages through everything, lets you pick any past date, and exports the whole day as a CSV to share. A short guided tour explains it on
your first visit. The Dashboard has a fresh, consistent look across all roles.

---

## v13.9.4 — 7 Oct 2026
**A Dashboard that answers "what's new today?":** reps now see *Given today*, *Not yet called* and a **My Day** card listing the
leads given to them and everything they did (calls, notes, moves, emails) for today or yesterday. SDR Performance now shows the
whole current pipeline, not only what moved in the period. **Saved Leads views** now follow you to any browser or device.

---

## v13.9.3 — 7 Oct 2026
**Expired sessions now sign you out clearly:** instead of an error on a blank screen, you are taken to the sign-in page with
"Your session has ended. Please sign in again." The Leads list also loads a little faster.

---

## v13.9.2 — 7 Oct 2026
**Claude connector can now see your teams and count leads:** it can tell which SDR is in which pod, list tags, and answer
"how many leads…" (by status, tag, rep or pod) in one step instead of paging through thousands of leads. It also filters
leads by tag, rep, upload or cadence, and its answers are smaller and faster.

---

## v13.9.1 — 7 Oct 2026
**Clearer errors:** when the system refuses an action (for example adding someone to a second pod while they are still in
another), the message now says why — on Pod Management and everywhere else — instead of failing silently or asking you to refresh.

---

## v13.9.0 — 7 Oct 2026
**Adding a lead someone else owns now explains itself:** it names the matching field, who owns the lead and its
status, and lets you **request a reassignment** that a Pod Admin approves (Leads → Reassign Requests). **Tags:** the Tag
filter now shows tags created after the page opened and says "No tags yet" when empty; tag and owner changes appear on the
lead's timeline. **Cadences:** a new "Allow re-enrollment" rule (with an optional wait) decides whether a lead that already
went through a cadence can join it again; a status trigger with no status no longer enrolls everyone.

---

## v13.8.1 — 7 Oct 2026
**Small fixes:** the unread number on the dialer button clears once you open Messages (and returns on a new
reply); the Playground is hidden from Pod Admins, who were always refused by the server.

---

## v13.8.0 — 7 Oct 2026
**Instantly replies, in one place:** Sales Tools → Replies has an inbox (every reply, the full
message and thread, filters, mark as read, open the lead) and a report (sent, replied and positive
rates by cadence, step, mailbox or rep). The Dashboard shows replies this week and what's unread, and
the lead page shows each Instantly email's subject and body. **Fixes:** a reply is now stored once
(it used to appear twice), out-of-office replies no longer count as replies, Activity Monitor includes
Instantly in its reply rate and rep filter, and the cadence roster and its CSV only list leads you may see.

---

## v13.7.0 — 6 Oct 2026
**My Tasks, redone:** approvals have their own tab, everything else is grouped by when it's due, and
"Overdue" only means overdue. Email drafts are edited as formatted text. Cadence steps can be skipped,
and the lead moves on. **Bell:** approvals, replies and due tasks — click one to go straight to it.
**Lead page:** enroll a lead in a cadence from its own page; the cadence card says when it's waiting on
you. **Messaging:** the purple button opens messages and calls — it never dials on its own.
**Reliability:** fixes the memory growth that restarted staging.

---

## v13.6.1 — 6 Oct 2026
**Cadences:** a lead's email reply now moves their cadence even if the instant notification is
missed (it's picked up within 5 minutes); a text reply from a number two leads share goes to the
lead whose cadence is waiting for it; and the Instantly step shows its proper name in the lead list.

---

## v13.6.0 — 6 Oct 2026
**Claude connector:** Claude can now answer "why isn't this cadence sending?", show who's on which
step, who texted back today, which leads opened your email several times without replying, how
an upload's leads are doing, the AE leaderboard, a full opportunity, and — for CSMs — their
portfolio, an account and the CSM digest.

**Cadences:** a failed step now shows the real reason on the lead page; a "did they reply?" branch
can wait minutes instead of whole hours; and a cadence can start "Only when enrolled manually".

**Instantly mailboxes:** choosing which mailboxes cadences send from is now one clear table with
search, a domain filter and pages, in both Control Center and the cadence step. Each lead still
gets one email per step, from one mailbox in the pool.

---

## v13.5.0 — 6 Oct 2026
**New:** an Instantly step in a cadence can now choose which domain or mailboxes it sends from.
Open the step and use **Send from** — you'll see only the mailboxes a Super Admin has enabled in
Control Center → Integrations → Instantly. Leave it empty to use all of them.

---

## v13.4.2 — 6 Oct 2026
**Fixed:** adding a lead is no longer refused as a duplicate of a lead that was deleted.

---

## v13.4.1 — 6 Oct 2026
**Fixed:** replies to Instantly emails now show up on the lead in Alternate CRM. A reply in an
unexpected format was stopping the Instantly sync before it finished.

**Fixed:** an SMS reply now always shows on the lead whose cadence sent the text, even when several
test leads share the sandbox number.

---

## v13.4.0 — 6 Oct 2026
### Connect Claude to Alternate CRM

**New (Super Admins, for now):** ask Claude about your leads, tasks, cadences, pipeline,
team performance and each lead's activity history. In **My Settings → Claude connector**,
create a key and follow the steps — add Alternate CRM as a custom connector in Claude, click
Connect, and paste your key on the Alternate CRM page. Claude sees only what you can see in
Alternate CRM. A Super Admin can open it to everyone in **Control Center → Integrations →
Claude connector**.

Claude is read-only by default. A Super Admin can let it add notes and tasks, change lead
status, and approve cadence drafts in **Control Center → Integrations → Claude connector**.
Before sending a cadence draft, Claude always shows you the exact message and waits for your
yes. Super Admins can see every lookup and change Claude made in **Control Center →
Monitoring → Claude Logs**.

**Fixed:** removing a lead from a cadence and a few other admin actions weren't being recorded
in the activity log. They are now.

**Fixed:** a cadence with a "Replied" branch would never take it while **Stop on reply** was
on (new cadences start with it on). Alternate CRM now tells you when you publish, so you can
turn Stop on reply off or remove the branch.

---

## v13.3.5 — 6 Oct 2026
### Cadences stop cleanly, and a reply during a wait is never missed

**Fixed:** removing a lead from a cadence, archiving a cadence, deleting a lead, or a
lead unsubscribing / being marked Do Not Contact now ends every cadence for that lead
immediately — pending email/SMS drafts are closed and Instantly stops sending too.

**Fixed:** a lead who replied while the cadence was still waiting (before the "replied?"
check) was treated as "no reply". The check now sees that reply and branches right away.
Out-of-office auto-replies still don't count as replies.

**Improved:** if a draft can't be sent (for example, no connected mailbox), **Send** now
explains why and keeps your draft, instead of closing it and failing in the background.

---

## v13.3.4 — 6 Oct 2026
### Reps can now build their own cadences end to end

**Fixed:** AEs and SDRs could click **New Cadence**, but the new cadence then opened
read-only and couldn't be saved or published. Any role can now build, edit, publish,
pause, and delete the cadences they own. Cadences owned by someone else stay read-only.
The in-app tour for reps has been updated to match.

---

## v13.3.3 — 5 Oct 2026
### Backend reliability fix, and a reorganized Integrations page

**Fixed:** the v13.3.2 fix for background jobs stopping after a deploy only
covered half the problem — a routine deploy could still leave every
scheduled job (cadence sending, syncs, reports) silently not running until
the *next* deploy. It now keeps retrying in the background until it
recovers, instead of giving up.

**Changed — Integrations, reorganized:** Control Center → Integrations'
"Dialer" tab held calling tools (Aircall, Alternate Messenger) and email-sending
tools (Instantly) side by side under a label that only described one of
them, while Nylas (also email-sending) sat on a different tab entirely.
Split into **Email Sending** (Nylas + Instantly) and **Calling &
Messaging** (Aircall, Alternate Messenger, and a new Klenty card).

**New:** a Klenty card — Klenty's call-activity sync has existed on the
backend since it shipped, with no way to turn it on, add a key, or trigger
a catch-up sync except by calling the API directly. It's on the Calling &
Messaging tab now, same shape as Instantly's card.

---

## v13.3.2 — 5 Oct 2026
### Backend reliability fix

**Fixed:** a bug that could leave background jobs (the cadence engine,
engagement syncs, scheduled reports/campaigns) not running at all after a
deploy, until the next one. No visible change other than reliability.

---

## v13.3.1 — 5 Oct 2026
### Instantly cadences now actually send, and show up in cadence reporting

**Fixed:** a cadence's Instantly Sequence step was creating a real campaign
in Instantly but never switching it on — it sat waiting for someone to
manually launch it from Instantly's own dashboard. It now activates on its
own, so there's no dashboard step left at all.

**New:** an Instantly Sequence step's sent/opened/clicked/replied numbers
now appear in the cadence's own Reporting tab, right alongside email and SMS
steps, instead of only in the account-wide Integrations settings page.

---

## v13.3.0 — 5 Oct 2026
### Instantly.ai integration: engagement sync + send cadences through your Instantly domains

**New — Instantly engagement sync:** Control Center → Integrations now has an
Instantly.ai card. Opens, clicks and replies from your Instantly campaigns
show up on the lead's activity feed, synced every 15 minutes.

**New — send cadences through Instantly:** a new **Instantly Sequence**
cadence step lets a cadence send through the domains and mailboxes you've
bought in Instantly, instead of your own mailbox. Alternate CRM still writes the
content, controls the timing, and decides when a lead exits or advances —
Instantly just handles delivery and keeps its own warmup/rotation. Replies,
opens, clicks and completions flow back in real time and resume or exit the
cadence automatically, the same way a reply to your own mailbox already does.

**New — sending-accounts picker and real-time webhook toggle:** choose which
of your Instantly mailboxes a cadence is allowed to send from, and turn on
real-time delivery of engagement events instead of waiting for the next sync.

---

## v13.2.0 — 5 Oct 2026
### Backend reliability fix

**Fixed:** a scheduler bug that could cause background jobs (email sync,
messaging sync, scheduled reports/campaigns) to silently run twice as often
as intended under the hood. No visible change other than things running a
little leaner.

---

## v13.0.0 — 30 Sep 2026
### Research-led cadences, emails on Lead Detail, and tighter access

**New — manual steps in cadences:** a **Task** step gives the rep a research,
LinkedIn or other hand-done task; the cadence waits for them and follows the
outcome they pick (e.g. *Accepted*). The task shows the message to copy and the
outcome buttons in **My Tasks** and on the lead.

**New — smarter cadences:** branch on a lead field (e.g. job title), waits in
days, formatted emails with tables, research merge fields, **Cadence Rules**
(stop on reply or booked meeting, a maximum length, a 60-day re-engagement task,
send as the lead's own rep), texts skipped for leads with no number, one-click
**copy**, and manual-step results in the Engagement panel.

**New — emails open inside Lead Detail:** click an email to read the thread,
reply or write a new one, without leaving the lead.

**Security (rolling out this week):** you'll only be able to open leads assigned
to you — Pod Admins can view any lead but only change their own pod's. Removing
someone's access takes effect within a minute. Demo login has been removed.

---

## v12.7.18 — 29 Sep 2026
### Emails on Lead Detail, and Salesforce re-linking

**New:** Lead Detail now has an Emails card — every email sent to or received
from the lead, with Sent / Opened / Clicked / Replied stats.

**Fixed:** when a Lead is merged or deleted in Salesforce, the CRM re-links it
by email (or recreates it) instead of failing every update.

---

## v12.7.17 — 29 Sep 2026
### One owner per lead until a meeting is booked

**Changed:** reassigning a lead that has no meeting yet now makes the new
person its only owner — SDR or AE. After a meeting is booked, an AE taking
over still keeps the SDR who booked it.

---

## v12.7.16 — 29 Sep 2026
### Lookalike meeting option fully removed

**Fixed:** the lookalike "Meeting Scheduled" call outcome no longer comes back
when outcome settings have been saved. Use **Meeting Booked**.

---

## v12.7.15 — 29 Sep 2026
### Meetings count again, one SDR per lead

**Fixed: a logged meeting sometimes didn't count.** A lookalike "Meeting
Scheduled" option in the call outcome picker saved the outcome without
moving the lead to Meeting Scheduled. It's gone — use **Meeting Booked**.

**Fixed: tagging a call "Discovery Call / Meeting Set" in Aircall now moves
the lead to Meeting Scheduled**, same as logging Meeting Booked.

**Fixed: leads showing more than one SDR.** Reassigning a lead now replaces
the previous SDR instead of adding a second one.

**SDRs now advance one pipeline stage at a time**, on every page.

**Lead Detail page:** full Sales Cadence status with reasons, notes on
Won/Lost (and changing an outcome), a confirm before regenerating research.

---

## v12.7.14 — 28 Sep 2026
### Lead Detail Hub: contact fields, messaging, task times

**Company Phone is now visible and editable**, and any phone number can be
corrected after it's set — the edit pencil used to disappear once a number
was entered.

**A "Message" button now works** — text a lead straight from the Lead
Detail page.

**Tasks can have a time, not just a date** — "call back at 3pm" is now
schedulable.

**Fixed**: a research-requirement setting could be silently skipped when
changing a lead's stage from this page.

---

## v12.7.13 — 28 Sep 2026
### Rename old email campaigns

**You can now rename any campaign** — click the pencil icon next to its
name in the Campaigns list. Fixes the ones stuck with a generic auto-
generated name from before real names were required.

**Old campaigns matching a saved template were auto-renamed** where
possible; anything that didn't match can be renamed by hand the same way.

---

## v12.7.12 — 28 Sep 2026
### Hotfix: Help Hub crash, mogambo unlock

**The Help Hub is no longer blank** — a bad release-notes entry from the
previous release crashed the whole page for every user; fixed and hardened
so this can't happen again.

**`#mogambo` now actually shows Pipeline & CSM** — it was correctly
unlocking in the background but never refreshing the nav to show it.

---

## v12.7.11 — 28 Sep 2026
### Calendar filter fixed, campaigns get real names

**The Calendar's search and rep filter now actually work** — typing a
lead/company name or picking a rep now filters the Month and Week grid too
(previously only the List view responded).

**Campaigns now have a real, distinct name** — a "Campaign name" field was
added to the compose form, so campaigns started from the same template no
longer all show the identical, unreadable template text as their name in
the list.

---

## v12.7.10 — 28 Sep 2026
### See who ran a campaign, sort almost any table in the app, and check calendar-invite usage

**Admins can now see who ran a campaign.** Super Admins and Pod Admins see
every campaign in their scope (not just their own), with a "Run By" column
and a "My campaigns only" toggle. Cadences got the same "My cadences only"
option.

**Nearly every data table in the app can now be sorted**, click a column
header to sort by it — Reports, Activity Monitor, Pods, AE Pipeline,
Leaderboard, Users & Roles, CSM Portfolio, Upload History, Daily Digest,
and Email Campaigns all got this, using the same consistent look
throughout.

**A new stat shows whether SDRs are actually using the calendar-invite
integration** — Activity Monitor's Calls tab now shows "Invites Created:
X/Y", comparing invites actually created against meetings confirmed.

**The Lead Activity panel is easier to find** — a short guided tour now
points it out the first time you visit Analytics Hub.

---

## v12.7.9 — 25 Sep 2026
### Lead Activity now shows email history too, and flags calls nobody logged

**A data bug in the new Lead Activity panel is fixed** — a "Last 7 Days"
filter could show thousands more leads than it should have. It now always
matches the numbers shown elsewhere on the page.

**Lead Activity now shows email history, not just calls.** Each lead's row
shows how many emails were sent and whether the lead opened or clicked the
latest one — and email sends/opens/clicks now show up in that lead's
timeline alongside calls and status changes.

**You can now see which "connected" calls never got an outcome logged.**
The panel header shows a quick "N connects, M with a logged outcome" count,
and any lead row where a connect has no outcome recorded gets a small
warning marker — an easy way to spot calls that were answered but never
followed up on in the CRM.

---

## v12.7.8 — 25 Sep 2026
### A per-rep filter and a lead-activity view in Analytics Hub, plus two bug fixes

**Analytics Hub can now be filtered to one rep.** A new "Rep" step sits
alongside POD, Date Range, and Batch — pick a specific SDR or AE and every
number on the page (KPIs, the SDR table, the export) scopes to just them.

**A new "Lead Activity" panel shows who's assigned and what happened on a
call.** Expand any lead to see its full status/call history — who called,
when, and what the outcome was — without leaving the hub.

**Two bugs fixed:** the batch dropdown was showing the upload date instead
of the file name (every batch from the same day looked identical), and an
SDR could see upload batches from a different team's pod they had no
business seeing.

**Export Leads now supports picking more than one SDR at once**, instead of
exporting one rep's leads at a time.

**AE Pipeline and CSM Portal are temporarily hidden** while that area is
reworked — reach out to your Super Admin if you need access in the meantime.

---

## v12.6.0 — 15 Sep 2026
### Call scripts on the Power Dialer, per-campaign email analytics, and a My Tasks page

**The Power Dialer card can now show you what to say, not just who to call.** Every lead's card can carry
its own script — key talking points, objection handling, whatever you want in front of you before you dial.
Write one for a specific lead, or a Sales Cadence "call" step can set a default that shows automatically for
everyone on that step. Your own version always takes priority if you've written one.

**Email Campaigns now show you who actually opened and clicked.** Every campaign in Sales Tools now shows
open and click counts right in the list, plus the same detail per recipient when you open a campaign — no
more guessing whether an email landed or checking one lead at a time.

**My Tasks is a new page.** Every task assigned to you, across every lead, in one list — filter to Open,
Done, or everything, tick one off, snooze it, or jump straight to the lead, without opening each one
individually first.

---

## v12.5.2 — 15 Sep 2026
### Deals stay with the person who owns them, plus a performance chart on AE Pipeline

**Admins can see every deal, but no longer act on someone else's.** Logging a
call, updating or closing a deal, logging a touch, marking a champion departed
or raising a renewal used to run as if the owning AE or CSM had done it
themselves — the activity, the health score, the leaderboard and the handover
email all recorded the wrong person. Those actions are now the owner's to take.
Admins keep full visibility, and where a write isn't theirs to make the screen
says so rather than offering a button that fails. Two admin actions are
unchanged by design: setting a health tier (which has always been logged with
who, when and why) and bulk-assigning accounts. Deals with no owner — a rep
who has left, say — stay admin-writable, so nothing gets stuck.

**AE Pipeline now opens with a performance chart** breaking your deals into
Won, Lost and still open, with open pipeline value alongside it. The table also
shows which AE owns each deal, which matters now that the list covers the whole
team rather than one person.

**Fixed: closing a deal left it in the wrong stage.** A deal closed in
Alternate CRM kept whatever stage it was in — so a won deal could still read as
"Negotiation." It now moves to Closed Won or Closed Lost. The same bug would
have stopped the Salesforce write-back from working at all once turned on;
Salesforce works out won/lost from the stage, and we were sending the old one.

---

## v12.5.1 — 15 Sep 2026
### Assign accounts to a CSM in bulk, plus a consistency pass over AE Pipeline and CSM Portal

**Super Admins can now hand a CSM their accounts in one go.** The Portfolio
tab has checkboxes and an "assign to CSM" action, so setting up a new CSM with
their existing book of business is a single step instead of one account at a
time. Each CSM still gets the usual "an account was assigned to you" email.

**The dropdowns and date fields in AE Pipeline and CSM Portal now match the
rest of Alternate CRM.** A few pickers in the newer screens were plain browser
controls — unstyled, unsearchable, and prone to running off the bottom of the
screen with a long list. They're now the same components you use everywhere
else. Closing a deal without a close date now tells you so instead of quietly
doing nothing.

**Account health now shows every factor that goes into the score.** Previously
the Account 360 card listed two factors by name, so anything added later would
have counted toward the score without ever appearing. Now it shows whatever
the score actually used — and the "not yet available" footnote will disappear
on its own once the remaining factors have real data behind them.

**Behind the scenes:** the bulk Audience Manager backfill now remembers its
progress across a restart. If a deploy interrupts a run, it tells you it was
interrupted and how far it got, instead of appearing to have never started.

---

## v12.5.0 — 15 Sep 2026
### Guardrails for the new Salesforce write-back, a smarter sign-in page, and two Power Dialer fixes

**Closing or updating a deal is safer now.** The Stage field in AE Pipeline
and CSM Portal is a real dropdown pulled straight from your Salesforce
picklist, so a typo can never get rejected by Salesforce. And nothing pushes
to Salesforce at all until a Super Admin turns it on in Control Center —
off by default until you've had a chance to check it. If a push to
Salesforce ever does fail, you'll see it right on the deal, not just in an
admin log.

**No more dead-end "contact an admin."** If you sign in with Google and
aren't set up yet, Alternate CRM now lets your admin know automatically — no
separate form to fill out. Admins see a "pending access requests" list in
Team & Access and can add you with one click.

**The sign-in page is properly responsive now**, with real Terms of Use and
Privacy Policy pages behind the links at the bottom.

**Power Dialer**: fixed a case where a Call List showed a lead count that
didn't match what actually showed up to dial. The current-call card also now
shows the last note left on a lead, not just the outcome, so you know what
happened before you pick up the phone.

---

## v12.4.0 — 11 Sep 2026
### Two new workspaces: AE Pipeline and CSM Portal

**Account Executives get a real home for their deals.** The new AE Pipeline
view lets you track your Opportunities, log calls against a specific deal,
and close deals right in Alternate CRM — closing a deal captures a quick
handover note (champion contact, promises made, next steps) that flows
straight to your CSM, and pushes the win back to Salesforce automatically.

**Customer Success Managers get their own portal, in beta.** See an
at-risk-sorted inbox, your whole account portfolio, and a 360° view of each
account — including the handover notes an AE left when the deal closed. Log
a touch on an account, mark a champion contact as departed, or override an
account's health status when you know something the numbers don't show yet.

**The sign-in page now has AE and CSM demo buttons**, and a few copy
tweaks — the fine print describes what Alternate CRM actually does today (turns
raw leads into Salesforce-ready pipeline) instead of the old framing.

Both new views are in beta — expect more playbooks (usage trends, support
signals) as the underlying data becomes available.

---

## v12.3.6 — 10 Sep 2026
### A redesigned sign-in page, SMS Campaigns via Alternate Messenger, and a smarter email signature toggle

**The sign-in page has a whole new look.** It's the same Google sign-in and
demo access underneath, just with real personality this time — and yes,
there's still a hidden little surprise if you click around enough.

**SMS Campaigns is now a tab in Sales Tools**, opening straight into
Alternate Messenger so you can build and send campaigns without leaving Alternate CRM to
go find the link yourself.

**Sending a campaign email now lets you choose whether to include your
saved signature** — on by default, so nothing changes unless you turn it
off.

**Fixed:** an error some Account Executives could hit loading the "All
Batches" analytics view; a brief loading glitch when opening View-As mode
right after this release shipped; and the View-As banner not showing its
color properly in some sessions.

---

## v12.2.8 — 9 Sep 2026
### Analytics Hub dropdowns actually fixed this time

**The Analytics Hub's dropdowns (POD/Batch pickers, Ask AI's new suggestion
list) look properly styled now**, not like plain native browser controls.
Turns out this was the real cause of the original "buttons look
transparent" report — a missing style reset that affected more than just
the one screen we'd already touched.

**Ask AI's suggestion dropdown no longer closes itself the instant you open
it.** A timing issue in yesterday's release meant it would flash open and
shut immediately in a real browser, even though it looked fine in our
automated tests. Fixed.

---

## v12.2.7 — 9 Sep 2026
### Ask AI gets smarter suggestions; the tab bar finally shows where you are

**Ask AI's search box now suggests as you type.** Instead of a fixed row of
example questions, typing into the query box now shows a live list of your
saved reports and suggested questions that match what you're typing.

**The Dashboard / Ask AI / Reports tabs never actually highlighted which one
you were on.** Fixed — and this turned out to be why the "edit filters"
button on Ask AI looked like it wasn't working: it was switching tabs
correctly the whole time, just without showing you it had.

**Saved Reports look like real, clickable items now**, instead of plain
unstyled text.

---

## v12.2.6 — 9 Sep 2026
### Salesforce sync fix for AEs; a cleaner Analytics Hub

**Salesforce sync was failing for leads assigned to an AE.** The sync would
reject the entire lead because of one field only meant for SDR names. Fixed
— an AE-assigned lead now syncs correctly, and Salesforce's Lead Owner field
is set to the right person automatically.

**Report Logs now has pagination**, instead of silently cutting off at 200
rows.

**The Analytics Hub looks and behaves more consistently.** The Dashboard
filter panel, Ask AI, and the Reports page all now use the same shared
components as the rest of the app — clearer cards, consistent tables, and a
working "edit filters" button on Ask AI that previously did nothing.

---

## v12.2.5 — 9 Sep 2026
### SDR Performance moves to the new design; three old pages retired

**SDR Performance now matches the rest of the app.** Opening someone's
performance from the Leaderboard now shows the same design as the rest of
Alternate CRM's newer pages, instead of the old plain page.

**Three admin-only pages you were never using are gone.** Upload Center,
System Logs and a couple of unlinked internal test pages had already been
fully replaced inside Control Center a while back — this just removes the
old copies. If you're a Super Admin, everything they did is in Control
Center's Data and Monitoring tabs already.

---

## v12.2.4 — 9 Sep 2026
### 🧹 Internal cleanup — nothing you will see

Removed 3,621 lines of old code that nothing in the app could reach any more,
left behind as pages were rebuilt. Nothing you can do has changed; the app
just carries less dead weight. Also added an architecture reference for the
engineering team.

---

## v12.2.3 — 9 Sep 2026
### 🐛 Connecting your mailbox, and a class of blank screens

**"Connect email" didn't work and threw you back to the dashboard.** On My
Settings, clicking **Connect email** showed an "undefined" error and left you
on a broken web address instead of Google's sign-in screen. Fixed. Connecting
from a lead's Email tab was never affected, if you found that route in the
meantime.

**A blank tab or page that only a full reload could fix.** Alternate CRM's newer
screens are separate mini-apps that the page swaps in and out. If the page
rebuilt the space one of them was living in, that screen kept drawing itself
somewhere invisible — you'd get an empty panel with no error, and reloading was
the only way out. It had happened on Calendar and on the Email tab. Every one
of those screens now notices and redraws itself properly, so this whole family
of blank screens is gone rather than patched one page at a time.

**Scheduled email campaigns would not have sent.** A campaign scheduled for a
future date or on a repeating cadence would have been skipped every time it
came due. Nothing was actually missed — there were no scheduled campaigns yet —
and campaigns sent immediately were never affected. Fixed before anyone relied
on it.

**The Email tab loads a much smaller stylesheet.** A build quirk had been
stacking a fresh copy of the Email tab's styles into the same file on every
release — nine copies had piled up, and everyone opening a lead's Email tab
was downloading all of them. Now it's one.

**Internal only: our error logs were full of things that weren't errors.** Any
request taking over a second was filed as an error even when it succeeded
perfectly, which buried the real failures underneath. Now only genuine failures
are logged as errors.

---

## v12.2.2 — 9 Sep 2026
### 🐛 Calling, email sending, and a clearer set of settings screens

**Dialling sometimes failed with a server error, and then blocked you for
minutes.** If two of your leads shared the same phone number — most often
the same line saved once plainly and once with an extension — Alternate CRM
could get confused about which call was which, hit a server error, and
leave your previous call looking like it was still running. You'd get "You
already have an active call in progress" on every attempt for about six
minutes. Both halves are fixed: the mix-up no longer happens, and a call
that has really ended is always cleared so you can dial again straight away.

**Sending email needed a full page refresh between leads.** Opening one
lead's Email tab and then going straight to another left the tab blank, so
you had to reload the whole page before you could send. Fixed — the tab now
loads properly for each lead you open.

**Your mailbox could say "Connected" while sending was actually failing.**
If a campaign or cadence email was rejected because your mailbox isn't
authorised to send, My Settings kept showing a green "Connected" badge with
nothing to tell you anything was wrong. It now shows "Reconnect needed"
with a **Reconnect email** button, so there's a clear way to fix it. My
Settings also shows your real email address now, instead of the generic
"your mailbox".

**Email Branding and Email Signature are one card now.** They controlled
the same thing — what gets added to the foot of the emails you send — so
they're merged into a single "Email Sign-off" card, with the "Powered by
Alternate Messenger" switch sitting under the signature it applies to.

**The Leaderboard and the SDR performance page use proper icons.** The
performance drill-down was showing emoji instead of the app's own icon set,
which looked different on every computer.

**Control Center explained itself using pages that no longer exist.** It
described itself as sitting "alongside the existing Settings, Admin, Upload
Center and System Logs pages" — all long gone. POD Admins, who see a single
Team & Access tab, were being told about four pages they don't have. The
description now matches what you can actually see.

**Only Super Admins can change integration settings.** POD Admins could
still change org-wide Salesforce, Aircall and Alternate Messenger settings by API,
even though the screen was only ever shown to Super Admins. Your Alternate Messenger
API key is also encrypted at rest now, like every other stored credential.

---

## v12.2.1 — 9 Sep 2026
### 🔒 Permission fixes, a tidier menu for POD Admins, and signatures for Super Admins

**POD Admins can no longer act outside their own POD.** A POD Admin could
previously create a user with any role — including Super Admin — and could
delete or revoke login access for anyone in the org. Now they can only add,
delete or change access for SDRs and AEs in their own POD, which is what the
old Admin page actually allowed. Only a Super Admin can create or remove a
POD Admin or Super Admin, or change anyone's role or POD.

**Cadences are fully owner-protected now.** The previous release stopped
other people editing, publishing or archiving your cadence. This one closes
the rest: enrolling leads, adding a sandbox test lead, and retrying,
advancing or skipping an enrollment are all owner-only too. That matters
because a cadence sends from its *owner's* mailbox — so this stops anyone
else causing email to go out under your name.

**Daily Digest could open empty with "Failed to load".** If your day had
already started but it was still the previous day in UTC — in India, any time
between midnight and 5:30am — the page asked for a date the server rejected
and showed no numbers at all. Fixed.

**A cleaner menu if you're a POD Admin.** You had four separate entries for
what is really two things. "Settings" and "Admin" are gone; everything you
used them for lives in Control Center → Team & Access, and your personal
preferences stay in My Settings.

**Super Admins can set an email signature.** My Settings is the only place
to set one, and it was hidden from Super Admins — so any Super Admin sending
mail had no signature and no way to add one. It's now in the menu for
everyone.

---

## v12.2.0 — 9 Sep 2026
### ✨ Clickable merge fields, cadence email previews, ownership you can see — and Leaderboard + My Settings rebuilt

**Campaign emails were arriving with raw HTML in them.** If you sent a
campaign, recipients could see literal `<p>` tags in the message text
instead of formatted paragraphs. Fixed — campaign bodies now send as real
formatted email. Cadence step emails were never affected.

**You no longer have to type merge fields.** Both the campaign composer
and the saved-template editor now show clickable `{{first_name}}`-style
chips that drop the field in wherever your cursor is — in the subject or
the body. No more guessing at spelling.

**You can see what a cadence actually sends.** Open any step and hit
"Preview email" to read the real subject and body with sample values
filled in. This works for everyone, including if you only have read-only
access — previously the step card cut the subject off and there was no
way to read the rest.

**Cadences and templates now show who owns them.** A cadence someone else
owns is labelled with their name and opens read-only, with a note telling
you who to ask. Only the owner (or a Super Admin) can edit, publish,
pause or delete it — previously any Pod Admin could change anyone's.
Templates work the same way, and if you like someone else's template you
can now duplicate it as your own instead of being blocked.

**Deleting is safer.** Deleting a template now asks first and reminds you
it's shared with the team. Deleting a cadence that's live warns you it
can still be enrolling new leads.

**Daily Digest reads better.** The KPIs are grouped — Outcomes first
(what actually progressed), then the activity behind them — and the card
that repeated the same week-over-week comparison a second time is gone.
Notable events now sits beside Pipeline flow, and the live pipeline
snapshot is clearly marked as "right now", not part of the day you picked.

**Leaderboard and My Settings have been rebuilt.** Same features, same
data, faster and consistent with the rest of the app. My Settings keeps
your email connection, dialer info, branding toggle and signature — and
the signature editor now handles images and company logos properly.

**Pod Admins get Control Center.** You'll see the Team & Access section
for managing your pod's users and roles.

### 🐛 Fixed
- Campaign emails showing raw `<p>` tags instead of formatted text.
- Templates offering an Edit button that failed when you tried to save.
- Deleting a shared template with no confirmation.
- Read-only cadence viewers being told to "Save, then click Publish" when
  they have neither button.
- A company name containing `&` or `<` breaking a campaign email's layout.

---

## v12.1.0 — 8 Sep 2026
### ✨ Cadence for everyone, a merged Campaigns view, and a Daily Digest React port

**Every role can now open a Cadence and see how it's built.** Previously
this was admin-only. Now anyone can inspect a cadence's steps and
config — read-only, with a short guided tour explaining it the first
time. Ask your Pod Admin if something needs to change.

**Campaigns and Performance are now one screen.** The old separate
Performance tab is gone — a single delivery-outcomes chart now sits at
the top of Campaigns itself.

**Cadence gets its own performance donut**, showing enrollment outcomes
across every cadence at a glance.

**Daily Digest is now a modern page**, with two new numbers — Campaigns
Sent and Cadence Enrollments — and its own guided tour.

**Export Leads can now filter by upload batch and/or a date range**, not
just by SDR.

### 🐛 Fixed

- **A single lead couldn't be deleted** — this was broken in production
  and is now fixed.
- **Alternate Messenger integration settings could silently lose a saved
  credential** if a field happened to render blank on save — fixed, and
  a clearer "Account ID Missing" status now shows when it's genuinely
  not set.
- **Users & PODs** search box icon alignment fixed, and a Role filter
  was added next to the existing POD filter.
- **The Aircall "Calling Provider" dropdown** now explains what it does —
  it picks your calling vendor independently from your messaging vendor.
- Caught two more issues in review before this fully shipped: the merged
  Campaigns tab briefly had a duplicate table (fixed), and the Export
  Leads "Upload batch" filter wasn't populating (fixed).

---

## v11.11.5 — 3 Sep 2026
### 🐛 Dialling, and the "log a call first" block

**A failed first call attempt now retries itself.** "…could not receive the
call. Please ensure they're logged into Aircall…" was the most frequent dialer
error in production — 665 in the last two weeks, one SDR hitting it on 38% of
their dials — and it was transient: 89% of those numbers connected when the SDR
simply clicked dial again, usually about 10 seconds later. The system now does
that retry itself, so the error mostly stops appearing at all.

**"At least 1 call must be logged" no longer blocks a lead that visibly has
one.** The check required a call with a saved *outcome*, while the lead's Calls
tab counts every call — so an SDR who had genuinely spoken to someone could be
told to log a call while looking at the call they'd logged. An answered call now
counts. 1,305 leads were in that state. Calls nobody answered still don't count,
and the message now says what's actually missing.

**Booking a meeting in the new Lead Details view advances the stage** the same
way the classic view always did.

**Opening the Calls tab on a lead with many calls no longer risks slowing the
app for everyone** — it used to start one background job per call on that lead.

**Granting calling or messaging access now emails that person a link to sign
in**, and a mail failure can no longer make the grant itself look like it
failed.

---

## v11.10.5 — 2 Sep 2026
### 🐛 Messaging access was granted/denied based on the wrong signal

#### Bug Fixes

- **A data-migration bug from v11.10.0 gave SMS/WhatsApp access to the wrong users.** Some Aircall-only callers with no Alternate Messenger agent identity were incorrectly granted SMS/WhatsApp access, while some real, already-active Alternate Messenger agents were incorrectly denied it. Both are now corrected based on whether a user actually has a Alternate Messenger agent ID configured, which is what should have driven this from the start.

## v11.10.4 — 2 Sep 2026
### 🧹 User Access: filters, pagination, and a proper Assign panel

#### Improvements

- **User Access now has filters and pagination** — search by name/email plus filter by calling provider, messaging provider, capability granted, or whether a Alternate Messenger agent ID is set. The list shows 5 users at a time instead of one long scroll.
- **The User Access table now uses the full page width**, so provider and capability chips line up in columns instead of wrapping over each other on narrower screens.
- **"＋ Assign Alternate Messenger Agent" now opens as a side panel**, so it's always visible the moment you click it — even with a long user list above it.
- **Alternate Messenger is now available as a Calling Provider**, alongside Aircall, in the Providers section.

#### Bug Fixes

- **A failed grant/revoke click due to a dropped connection now shows a plain message with a Retry button**, instead of a raw browser error with no way to try again.

## v11.10.3 — 2 Sep 2026
### 🐛 "＋ Assign Alternate Messenger Agent" responds sooner after opening the page

#### Bug Fixes

- **"＋ Assign Alternate Messenger Agent" now responds as soon as its own part of the page is ready**, instead of waiting on unrelated settings elsewhere on the page to finish loading first. Calling & Messaging can still take a few seconds to fully settle right after you open it on this environment — that part is a separate, known rough edge, not something this release claims to have solved.

## v11.10.2 — 2 Sep 2026
### 🐛 "＋ Assign Alternate Messenger Agent" could be unresponsive on first click

#### Bug Fixes

- **Clicking "＋ Assign Alternate Messenger Agent" right after opening Calling & Messaging could silently do nothing** if the click landed before the User Access list finished its first load — fixed.

## v11.10.1 — 2 Sep 2026
### 🧹 Calling and messaging settings, in one place

#### Improvements

- **Settings now has one "📞 Calling & Messaging" tab** instead of a separate 📞 Dialer tab and 💜 Alternate Messenger tab — the calling provider and messaging provider are picked side by side at the top, and Klenty Sync moved to 🔄 Sync Settings where it fits.
- **One User Access table lists everyone**, instead of two separate tables that each hid the people the other showed. Aircall and Alternate Messenger users appear in the same list, with 📞/💬 tags showing which vendor each one is on.
- **Admin → Users no longer has its own copy of the dialer and Alternate Messenger fields** — those edits happen in one place now (Settings → Calling & Messaging), which also warns you if a channel won't actually send yet. Admin → Users shows a read-only summary that links there.
- **If SMS or WhatsApp is switched off at the org level, the settings page now warns you above the grant list** — before, a user's chip could look "granted" while the org config underneath it was still incomplete.

## v11.10.0 — 2 Sep 2026
### 💬 Admins can now switch SMS and WhatsApp on for each person

#### Improvements

- **You can now give each person Calling, SMS, and WhatsApp separately** — open **Settings → 💜 Alternate Messenger** (or **📞 Dialer** for Aircall users) and click the chip next to their name to switch a channel on or off. It saves immediately.
- **Messaging no longer depends on the dialer.** Someone who makes calls through Aircall can now send WhatsApp and SMS from Alternate CRM — previously they got no messaging at all, no matter how it was set up. Equally, giving someone the dialer no longer quietly gives them WhatsApp.
- **Each person can be on a different messaging provider from their calling provider** — calls through Aircall and messages through Alternate Messenger is a supported setup.
- **Aircall needs no per-person setup at all.** Save the Aircall API ID and token once, and everyone who exists in Aircall just works — matched on their email address, sending from the numbers Aircall already assigns them. No IDs or numbers to look up and type in. Alternate Messenger still needs its per-person agent ID and sender, as before.
- **If a channel isn't ready to send, the settings page now tells you exactly which field is missing** (Account ID, Sender Number, and so on) instead of letting the first message fail silently.
- **The 💬 Message button and the messaging widget only appear for people who actually have a messaging channel**, so nobody is offered something that would be refused.

#### Bug Fixes

- **WhatsApp replies from leads were recorded as SMS and not attached to any rep** — so they were filtered into the wrong channel in Activity Monitor and missing from per-rep views. Now recorded on the right channel and attributed to the rep whose number the lead replied to.
- **Cadence SMS steps failed as "not configured" even when SMS was set up** — the SMS step was reading the calling caller-ID field instead of the messaging sender. SMS and WhatsApp now use the same sender.
- **A rep could switch their own dialer access back on** after an admin had switched it off. Turning your own dialer off still works; turning it back on is now admin-only.

## v11.9.4 — 2 Sep 2026
### 🎨 A consistent look across the whole app, and 5 bugs it surfaced

#### Improvements

- **Every dropdown, tab, empty state, badge, checkbox, switch, spinner, avatar, search box, and modal across the app now shares one consistent design** — Leads, Lead Details, PODs, Power Dialer, Sales Cadences, Activity Monitor, Help, Analytics, Calendar, Dashboard, and Email.

#### Bug Fixes

- **Clicking a second lead's priority dot left both re-prioritize menus open at once** — fixed.
- **Opening a filter's dropdown could occasionally fail to open the next step** — fixed.
- **The global search box showed a dark, jarring border when clicked into** — fixed.
- **A Timezone picker opened from inside the Send Window popup appeared dimmed and stuck behind it** instead of on top — fixed.
- **A lead's own detail page could mislabel its source as "Manual"** when the leads list showed the correct source — fixed.

## v11.9.3 — 1 Sep 2026
### 🎨 Dropdowns and date/time pickers now match everywhere

#### Improvements

- **Every dropdown and date/time picker in Sales Cadences, PODs, Power Dialer, Analytics, Leads, and Calendar now shares the same searchable, consistently-styled control.**

#### Bug Fixes

- **The AI research assistant could occasionally fail instead of automatically trying a different model** when a response came back in an unexpected format — fixed.

## v11.7.0 — 26 Aug 2026 (staging only)
### ✨ Try the new Analytics Hub (beta)

#### New

- **Super Admins now see a "Try the new Analytics Hub" link** on the existing Analytics Hub. It opens a new, parallel beta experience with the same 5 key metrics (Connect Rate, Leads Assigned, Account Connect Rate, Disqualified, Meetings Scheduled) — each with an **Inspect** view explaining exactly what it means, how it's calculated, and how it compares to today's number. There's a link back to the classic Analytics Hub at any time, and the classic experience is completely unchanged and still the default for everyone.
- A new **Ask Analytics** tab in the beta answers simple questions about those 5 metrics and shows what it understood before answering — and says so plainly instead of guessing when it doesn't know a metric or breakdown yet.

#### Bug Fixes

- **Ask AI questions grouped by day/week/month used to ignore the selected batch filter** — fixed.
- **Ask AI's Connect Rate answer could differ from the Dashboard's** because it was missing manually-logged calls — fixed by having both use the same definition.
- **Asking Ask AI for a breakdown it doesn't actually support** (e.g. "connect rate by POD") used to silently show one org-wide number instead of the breakdown you asked for — it now tells you that breakdown isn't available yet instead of quietly answering a different question.
- Ask AI now understands "last month" correctly.

> This release is on staging only for now.

---

## v11.6.6 — 26 Aug 2026 (staging only)
### 🐛 Lead Details — real confirmations, and a pod-scoping security fix

#### Bug Fixes

- **Deleting a lead or marking it opted out now asks you to confirm first**, using the app's own popup instead of a plain browser dialog — and Opt Out never asked before at all.
- **The assignment dropdown is now a proper searchable picker** instead of a long unstyled list.
- **"Send Email" from Quick Actions no longer bounces you to the old view** — it opens directly in the new Lead Details page.
- **Fixed a pod-scoping gap:** a Pod Admin could previously see (and use) the reassign/delete/outcome controls for a lead outside their own pod, and — more seriously — could delete any lead in the system by ID regardless of pod. Both are now correctly restricted to a Pod Admin's own pod.

> This release is on staging only for now.
---

## v11.6.5 — 26 Aug 2026 (staging only)
### 🐛 The app is now usable on a phone

#### Bug Fixes

- **The sidebar used to take up more than half the screen on a phone, pushing everything else off-screen.** It's now a proper slide-out menu — tap the ☰ icon to open it, tap outside or pick a page to close it. This fixes every page built on the new design at once (Dashboard, Leads, Lead Details, Analytics, Calendar, and more).

> This release is on staging only for now.
---

## v11.6.4 — 26 Aug 2026 (staging only)
### ✨ Lead Details — change who a lead is assigned to, and clearer loading

#### New

- **Super Admins and Pod Admins can now change a lead's assignment directly from the new Lead Details view** — no need to go through the Assignments tab for a single lead.

#### Improvements

- **Clearer loading everywhere in the new Lead Details view** — sections that showed plain "Loading…" text (including the very first page load) now show a proper loading placeholder instead.

> This release is on staging only for now.
---

## v11.6.3 — 26 Aug 2026 (staging only)
### 🐛 Backend stability — fixed the real cause of the repeat OOM crashes

#### Bug Fixes

- **Found why staging kept running out of memory even after this week's other fixes.** The server was accidentally starting its background jobs twice on every boot, silently doubling how often things like the email-sync job ran. No visible change — this is purely a backend stability fix.

> This release is on staging only for now.
---

## v11.6.2 — 26 Aug 2026 (staging only)
### ✨ Lead Details — the new view can now do everything the classic one can

#### New

- **You can now progress a lead through the whole pipeline from the new Lead Details view** — Disqualify, No-Show, Demo Success/Failed, Meeting Complete, Discovery calls, and Schedule Demo all work now (they showed "coming soon" before). Also added: a Sales Cadence status chip, a "Company Already Connected" banner, a research heat badge, a copy-opening-line button, an Enrichment Data card, a phone timezone badge, and click-to-edit contact fields.

#### Fixed

- A completed lead no longer shows a "Follow up" suggestion — it correctly shows no action needed.
- One more backend stability fix (see technical notes).

> This release is on staging only for now.
---

## v11.6.1 — 26 Aug 2026 (staging only)
### 🐛 Backend stability — more memory-leak fixes

#### Bug Fixes

- **Staging kept running out of memory.** Found and fixed four more places where behind-the-scenes caches or background jobs could grow without limit under heavy traffic. No visible change — this is purely a backend stability fix.
- **The AI insight summary on the Analytics Hub was silently broken** and always showed nothing. It now actually generates a summary.

> This release is on staging only for now.
---

## v11.6.0 — 25 Aug 2026 (staging only)
### ✨ Lead Details — new redesigned view (opt-in)

#### New

- **A redesigned Lead Details page is now available to try.** Open any lead and click "Switch to the new experience" to see it — built around "what should I do next," with a unified activity timeline and a cleaner layout. Your current Lead Details page is still there and still the default; switch back any time with "Switch to classic view."

> See `docs/RELEASES.md` for the full technical writeup. This release is on staging only for now.
---

## v11.5.25 — 25 Aug 2026
### 🐛 Connect Rate double-counting fix + Analytics Hub no longer auto-loads

#### Bug Fixes

- **Connect Rate was still too high for teams using the in-app dialer** — a call that gets auto-logged both as a dialer call and a manually-logged call was being counted as connected twice, inflating the number. It now counts once.

#### Changed

- **Analytics Hub no longer shows any data when you first open it.** Pick a POD, a date range, and (optionally) a batch, then apply — nothing loads until you do.

> See `docs/RELEASES.md` for the full technical writeup.
---

## v11.5.24 — 25 Aug 2026
### 🐛 Analytics Hub data cleanup + lead cap consistency

#### Bug Fixes

- **Connect Rate is now more accurate** — calls where the SDR could never reach anyone ("Unreachable", plus a data-entry variant of "No Answer") no longer count as connected, and manually-logged calls now count toward Connect Rate the same way dialer calls do.
- **The Connect Rate card, SDR table, and funnel chart now explain themselves** — hover any number to see exactly how it's calculated.
- **SDR lead caps are now consistent across every environment** — a hidden per-pod override (never visible or editable anywhere) could silently make the global cap setting a no-op; only the one setting in Settings → Sync applies now.

#### Changed

- **The SDR Performance table now shows "Accounts Called" (distinct companies dialed) instead of "Leads"**, and drops the "Conversations" column — Calls and Connect % cover it.

> See `docs/RELEASES.md` for the full technical writeup.
---

## v11.5.23 — 25 Aug 2026
### 🐛 Opt-out tooltip, template picker, and dialer mode-selector fixes

#### Bug Fixes

- **The "Mark Opted Out" tooltip no longer drifts out of place when you scroll.**
- **Replaced the plain browser confirmation popup** for marking a lead opted out with the app's own styled dialog.
- **The WhatsApp template picker's dropdown now opens under the field**, instead of appearing in the center of the screen.
- **Fixed a rare case where the dialer's "Phone Bridge / Browser Call" picker could fail to appear**, leaving the call stuck until it timed out.

> See `docs/RELEASES.md` for the full technical writeup.
---

## v11.5.22 — 25 Aug 2026
### 🐛 Lead assignment, call counts, admin delete, dialer status, and WhatsApp fixes

#### Bug Fixes

- **Reassigning a lead now reliably updates the screen right away**, instead of sometimes appearing to do nothing until you refreshed.
- **Calls made through the in-app dialer now count correctly** — some leads were stuck showing "0 calls" even after being called.
- **Deleting a user now removes them from the list immediately**, instead of leaving them visible until a manual page reload.
- **Replaced the plain browser confirmation popup** for deleting users, revoking access, and changing roles with the app's own styled dialog.
- **Fixed the dialer widget sometimes not showing call status** (ringing / mute / hang-up) on a call after the previous one ended without you clicking End Call.
- **WhatsApp template messages now send successfully** — some templates were being rejected outright by WhatsApp.
- **Failed message sends now show the real reason** instead of a generic "Send failed."
- **Fixed a staging server crash** caused by a cache that never cleaned up old entries during busy periods.

#### New

- **WhatsApp sender numbers can now be assigned per SDR**, the same way calling numbers already are, instead of every SDR sharing one number (Settings → Dialer → Agent Assignments).

> See `docs/RELEASES.md` for the full technical writeup.
---

## v11.5.21 — 24 Aug 2026
### 🔧 Backend stability fix

#### Fixed

- **Capped how many email-inbox syncs can run at the same time in the background**, reducing memory pressure during bursts of activity on the Lead Detail page's Emails tab.

> See `docs/RELEASES.md` for the full technical writeup.
---

## v11.5.20 — 24 Aug 2026
### 🔧 Backend stability fix

#### Fixed

- **Fixed a slow memory leak in the background job scheduler** that was causing occasional server restarts, including during quiet periods with no active users.

> See `docs/RELEASES.md` for the full technical writeup.
---

## v11.5.19 — 24 Aug 2026
### 🐛 Leads Hub assignee/status picker fixed, plus a second user-delete gap

#### Bug Fixes

- **The new searchable Assigned-To/Status picker now actually shows its options.** It rendered blank right after shipping — the table was clipping it. Now it always appears fully, wherever the row is on screen.
- **Deleting a user who's used the Power Dialer no longer errors.** The same underlying issue as the Pod Admin delete fix in v11.5.18, just on a different table — fixed the same way.

#### New

- **A one-time pointer to the new "Mark Opted Out" button** for anyone who hasn't seen it yet.

> See `docs/RELEASES.md` for the full technical writeup.
---

## v11.5.18 — 24 Aug 2026
### 🐛 Lead reassignment, pod-admin delete, opt-out marker, dialer self-heal

#### Bug Fixes

- **Reassigning a lead away from a departed teammate now works.** Bulk-assigning a lead that was previously assigned to someone who's left the team no longer silently fails for Super Admin/Admin.
- **Deleting a Pod Admin no longer errors.** It now also warns you which pod(s) they administer before you confirm, so you know a pod may need a new admin afterward.
- **The Alternate Messenger dialer is more resilient to a slow connection.** If the dialer widget fails to load on a flaky connection, it now retries automatically and shows a clear warning if it still can't load — instead of silently running the call with no visible controls.
- **Fewer duplicate or delayed call logs on the embedded Aircall dialer.** A race between the call starting and Aircall's webhook arriving could log the same call twice or leave it stuck without an outcome — now reconciled correctly.

#### New

- **Leads can now be marked as opted out.** A new toggle on the lead's page stops all future calls, texts, and journey emails to that lead — the safeguards were already in place everywhere, this adds the way to actually flag one.

> See `docs/RELEASES.md` for the full technical writeup.
---

## v11.5.17 — 21 Aug 2026
### 🐛 Alternate Messenger dialer: calls that connected with no visible controls

#### Bug Fixes

- **The Alternate Messenger call widget no longer goes silent mid-call.** SDRs on the Alternate Messenger dialer could click Call, hear it ring and connect, and talk to the lead — while the timer, mute, and hangup controls simply never appeared. A failed dial (e.g. a bad number) also gave no error. Both were the same underlying issue: the widget's on-screen panel is now guaranteed to exist before any call can start.

> See `docs/RELEASES.md` for the full technical writeup.
---

## v11.5.16 — 21 Aug 2026
### 🐛 Dial-count double-counting, dead-end lead page, company grouping/sort, Analytics Hub timezone mismatch

#### Bug Fixes

- **Dial counts no longer double-count.** A call's outcome being submitted after the call-ended webhook already arrived — and, separately, a retried webhook delivery on its own — could each count the same call twice.
- **"Couldn't load this lead" no longer strands you on a blank page.** If Alternate CRM ever lands on a broken lead link (including a browser reopening a stale tab), it now takes you to the dashboard instead of a dead end.
- **Leads with no company are no longer shown first.** In both the classic and new leads lists, and in the Power Dialer's "group by company" order — they now always sort to the bottom, where they belong.
- **The new leads list now groups by company for everyone**, including SDRs — it was silently disabled by the default sort, even though nothing was actually broken about grouping itself.
- **Analytics Hub numbers now agree with each other.** Calls made late at night (US time zones) were sometimes counted on the wrong day depending on which Analytics Hub view you were looking at — all views now use the same, correct day boundary.

#### New

- **A quick interactive tour now walks you through the new leads list** the first time you open it — company grouping, bulk-select, saved views, columns, and the classic-view link.

> See `docs/RELEASES.md` for the full technical writeup.

## v11.5.15 — 20 Aug 2026
### ✨ Call Lists, Analytics Hub for SDRs, call-outcome-edit docs

#### New Features

- **Call Lists** — build a named, shareable list of leads (bulk-select or "save current filter as a list") and dial straight from it in Power Dialer. Visible to everyone; any SDR, AE, or Admin can create and populate one.
- **Analytics Hub is now visible to SDRs**, not just Admins and AEs — scoped to your own leads/calls only, same as the existing AE view.

- **SDR/AE can now bulk-select leads** with a new "Select Leads" toggle, to add them to a Call List — the existing bulk-select checkboxes were accidentally admin-only, so this was previously unreachable for SDR/AE.
- **A "Switch to classic view" link now exists in the new Leads experience** — previously there was no way back once you switched, short of clearing browser storage.

#### Fixes / Clarifications

- **Ask AI is now hidden for SDR/AE** in Analytics Hub — it wasn't actually usable for AE before (silently failed), and has no self-scoping yet, so it's now cleanly hidden instead of half-working.
- **Confirmed and documented**: correcting a dialer-logged call's outcome (via the Edit link on the Calls tab) is already available to every role — live-tested end-to-end, not just read in code.

#### Docs

- Added **Call Lists**, **Analytics Hub**, and **Correcting a call outcome** sections to the in-app Help Hub guide — the Analytics Hub section also covers AE's existing (previously undocumented) access.

> See `docs/RELEASES.md` for the full technical writeup.

## v11.5.14 — 20 Aug 2026
### 🐛 "Switch to the new experience" button fixed

#### Bug Fixes

- **Clicking "Switch to the new experience" on the Leads list now actually switches** — it previously reloaded the page but silently stayed on the classic list.

## v11.5.13 — 20 Aug 2026
### 🐛 Dial-count over-count fix round 2, dialer SSE gap, stale-closure UI races, Power Dialer Company column

#### Bug Fixes

- **Dial counts no longer double-count auto-logged Aircall calls** — dashboard stats, the SDR table, and per-batch call counts each summed a dialer call and its auto-created call log separately.
- **Dialer call status now reaches the browser in real time** — both Aircall's and Alternate Messenger's webhooks were missing the real-time push that drives the disposition popup, silently falling back to slow polling.
- **The floating dialer widget no longer disappears mid-session** when a second call is placed while the previous one is still fading out.
- **The No-Show modal no longer navigates to the wrong lead** if it's reopened for a different lead within a second of a previous submission.
- **Leads list order now stays put** when navigating back from a lead's detail page within the same session, instead of silently re-sorting.

#### New Features

- **Power Dialer queue list shows each lead's company** — no more opening a lead just to see which account you're about to call.

> See `docs/RELEASES.md` for the full technical writeup (root causes, live-evidence confirmation, and everywhere each fix was applied).

## v11.4.0 — 17 Aug 2026
### 📊 Automated Reports rewrite: multiple reports, full-page builder

#### New Features

- **Automated Reports now supports multiple named reports**, each with its own filters, schedule, and recipients — not just one org-wide schedule.
- **New full-page report builder** — pick a POD/batch/SDR filter, a date-range rule (previous 7 days, previous month, custom, etc.), a timezone-aware send time, and To/CC/BCC recipients.
- **Report Logs tab** — see every send, scheduled or manual, with its status and the exact reporting period it covered.
- **Run Now** — send a report immediately using the same pipeline the scheduler uses.
- **CSV attachment** option, alongside the inline email digest.

This replaces the single-schedule version shipped earlier today (v11.3.0) — it undershot what was actually needed.

## v11.3.0 — 17 Aug 2026
### 📬 Automated reports, reply notifications, caller ID, signature logo

#### New Features

- **Automated Analytics reports** — a new "Reports" tab in the Analytics Hub lets you schedule a qualified/disqualified-by-SDR email digest (daily, weekly, or monthly) to any stakeholder list.
- **Prospect replies now show up in the notification bell** — previously silent; you had to happen to reopen Email Hub to notice a reply.
- **Upload a logo image straight into your email signature** — no more needing an already-hosted image URL.
- **Caller ID on incoming Aircall calls** — a toast shows the matching lead's name and company as the call comes in.

#### Bug Fixes

- **Replying to a thread you sent from Alternate CRM now works** — it was incorrectly disabled on every thread, forcing the conversation to continue over Gmail.
- **Cadence Builder node titles** now show the full text on hover instead of only the truncated version.

## v11.2.0 — 17 Aug 2026
### 📞 Power Dialer account grouping, cadence dialing, lead delete, disqualify fix

#### New Features

- **Power Dialer can now sequence by account** — a new "Sequence: Account" option groups all contacts at the same company together instead of the default priority-only order.
- **Load a cadence's leads straight into the Power Dialer** — a new "Cadence" dropdown lets you dial everyone currently enrolled in a Sales Cadence.
- **Analytics: qualified/disqualified counts by SDR** — each batch row in the Analytics Hub's "All Batches" table can now expand to show a per-SDR breakdown.
- **You can now delete a lead** — it's removed from Leads, Kanban, and reports immediately; its calls, notes, and emails are kept.

#### Bug Fixes

- **"Disqualify Lead" (including "Wrong Number") now works from any stage the button is shown at** — it previously only worked while a lead was still in "Calling," even though the button appears later in the pipeline too.

## v11.1.0 — 17 Aug 2026
### 📜 Lead history, and two dialer/Aircall fixes

#### New Features

- **Every lead now has a change history** — name, phone, email, company, title, LinkedIn, and pod-assignment edits are recorded (who changed it, old value, new value, when) and shown right on the lead's detail page alongside its status timeline.

#### Bug Fixes

- **Adding a lead no longer gets silently blocked when Aircall already logged a call to that number.** If a call comes in to a brand-new number before you've added the contact, Alternate CRM used to reject your "Add Lead" as a duplicate and keep the nameless placeholder — it now fills in the real name instead.
- **The "Call ended, please log the outcome" prompt no longer appears the instant you dial** — it now correctly waits until the Aircall call actually ends.

## v11.0.0 — 14 Aug 2026
### 🧪 Cadence/Messaging Sandbox, Aircall messaging, Analytics fixes

#### New Features

- **Cadence/Messaging Sandbox** — test an entire Sales Cadence end-to-end with real WhatsApp/SMS sends, safely. Playground's new "Cadence Test" tab lets you create a throwaway test lead, enroll it in any real published cadence, and force each step through immediately instead of waiting real days. Every send is redirected to a Sandbox Test Phone Number you configure — never a real lead — and test data never shows up in Analytics or activity feeds.
- **Aircall added as a second messaging provider** — pick Alternate Messenger/Messaging Provider or Aircall for Sales Cadence and Widget messaging in Settings.
- **The "Conversations" threshold in Analytics is now configurable** (Settings → Call & Pipeline Settings), instead of a fixed 30 seconds.

#### Bug Fixes

- **Analytics Hub filters no longer reset when you switch tabs** — pod/date/batch selections now persist.
- **Fixed the SDR Performance table's search icon** not being vertically centered.

## v10.9.14 — 14 Aug 2026
### 💬 WhatsApp in Sales Cadences, and messages now tracked

#### New Features

- **WhatsApp is now available as a Sales Cadence step** — pick from your account's real approved templates right in the Journey Builder.
- **Messages sent or received through the Alternate Messenger Widget are now tracked in Alternate CRM** — previously they left no record anywhere in the app.

#### Bug Fixes

- **Fixed the Leads Hub Source badge overflowing into other columns** for long file names — it now truncates with the full name on hover.

## v10.9.13 — 14 Aug 2026
### ✨ Redesigned Leads is now the default

#### New Features

- **The redesigned Leads experience is now on by default for everyone** — the classic view is still one click away via "Switch to classic view".

#### Changes

- **Removed phone-number masking** for non-admins — numbers no longer hide behind a "complete research first" gate; the feature it supported is retired.
- **Enroll in Cadence** is now available to Pod Admins and Admins, not just Super Admins.

---

## v10.9.12 — 14 Aug 2026
### 🐛 Redesigned Leads (beta) bug-fix pass, Analytics Hub scroll fix

#### Bug Fixes

- **Redesigned Leads experience (beta)**: fixed a stuck date filter, a filter combination that silently cancelled itself, Saved Views dropping your search text, inline edits and bulk actions failing with no warning, a lingering "Unknown" placeholder, and a company-connection badge that could reference a lead's own status.
- **Analytics Hub**: the SDR Performance table now scrolls within its own panel instead of growing past the page.

---

## v10.9.11 — 14 Aug 2026
### 📊 Analytics: Conversations Column & Per-Team Timezones

#### New Features

- **Conversations column** in Analytics Hub's SDR Performance table (and CSV export) — calls over 30 seconds that weren't a no-answer, wrong number, or voicemail.
- **Each team's date filter now uses that team's own timezone.** Set a timezone per POD in POD Management — a US team's late-night calls no longer land on the wrong on-screen date when viewed by an admin in a different timezone.

#### Bug Fixes

- **Fixed a lingering "Source: Salesforce" mislabel** on leads auto-created by the dialer — a follow-up gap the earlier fix didn't fully close.
- **Restyled the Sales Cadence Send Window's Timezone picker** — replaced the browser's own inconsistent-looking dropdown with one that matches the rest of the app.

---

## v10.9.10 — 13 Aug 2026
### 🚨 Hotfix: Dialer Widget Was Silently Blocking Clicks

#### Bug Fixes

- **Fixed an invisible click-blocking bug from the Alternate Messenger dialer widget.** Since it became the default widget, its collapsed floating button was still reserving a much larger invisible area in the bottom-right corner of every page — silently swallowing clicks meant for whatever else was on screen there (e.g. merge-field chips in Sales Cadences). Clicks in that corner now reach the widget's button only, never the empty space around it.

#### New Features

- **Rename a cadence.** Click the name at the top of the Journey Builder to rename it.

---

## v10.9.9 — 13 Aug 2026
### 🔁 Sales Cadences: Engagement Tracking, A/B Testing, SMS, and More

#### New Features

- **See open/click/reply rates** for every cadence, overall and per email step.
- **Split-test an email (A/B).** Two subject/body variants, sent evenly — see which performs better per step.
- **Send SMS from a cadence.** New SMS step, sent via your existing Alternate Messenger connection.
- **Restrict sends to business hours.** Pick a timezone, a daily window, and allowed weekdays.
- **Generate a first draft with AI.** A "Generate with AI" button on any email field.
- **Out-of-office replies no longer count as engagement** — a real reply and an auto-responder are now told apart.
- **New Activity view** — every email/SMS send and reply for a cadence, in one timeline.

---

## v10.9.8 — 13 Aug 2026
### 🔁 Sales Cadences: Pod Scoping & Email-Received Trigger

#### New Features

- **Scope a cadence to one pod.** Only leads in that pod get auto-enrolled — set it when creating a cadence, or any time after from the builder.
- **New trigger: "SDR/AE receives an email from the lead."** Start a cadence on an inbound email, not just a status change.

#### Bug Fixes

- Merge-field chips in the Email node now show a pointer cursor.
- Bulk-select no longer includes a cadence that's been filtered out of view.
- A partially-failed bulk delete now refreshes correctly and lets you retry just the failures.

---

## v10.9.7 — 13 Aug 2026
### 📞 React Alternate Messenger Dialer Widget — Now Default

- **The modernized Call/Message widget is now on for everyone.** The old dialer widget is still there as an automatic fallback while we retire it in a follow-up.

---

## v10.9.6 — 13 Aug 2026
### 🔁 Sales Cadences Management & User Guide Gaps

#### New Features

- **Find and manage cadences easily.** Sales Cadences now has search, a status filter, pagination, and single/bulk delete — with a warning if leads are still enrolled before you delete.
- **New user guide sections** for Power Dialer, Analytics Hub, and Sales Cadences — including how to auto-schedule a call when a lead replies to a cadence email (this already works today).

#### Bug Fixes

- **Fixed a misleading "Salesforce" source label.** A lead created without an explicit source used to silently show up as "Salesforce" even when it had nothing to do with Salesforce.

---

## v10.9.5 — 13 Aug 2026
### 📧 Email Hub — Cc/Bcc, Signatures, Rich Text & Reliable Sync

#### New Features

- **Cc/Bcc on every email.** Loop in a manager or teammate when emailing a lead — on new emails and replies.
- **Personal email signature.** Add a signature with links and images (like a booking link or social icons) under My Settings — it's added automatically to every email you send.
- **Insert links and images in the email body.** Compose is no longer plain text only.
- **Analytics Hub for AEs.** AEs now get their own Analytics Hub, scoped to just their own leads and calls.

#### Bug Fixes

- **Email replies now sync in reliably.** Previously, a reply — whether from the lead or sent directly from your own Gmail — only synced in when you happened to reopen that lead's Email tab. It now syncs automatically on a regular schedule.
- **Power Dialer layout fix.** The "Today's Calls" panel could get cut off on the right side of the screen at some window widths, requiring a zoom-out to see it. Fixed.

---

## v10.9.4 — 13 Aug 2026
### 📊 Analytics Hub — Clearer Leads Assigned Label

#### Bug Fixes

- **"Leads Assigned" now explains itself.** The card counts leads created in your selected date range, not leads worked — a subtitle now says so directly, instead of only showing on hover.

---

## v10.9.3 — 12 Aug 2026
### 📞 Power Dialer — Call Log Fixes

#### Bug Fixes

- **No more "Unknown" with nothing else to go on.** A call that isn't matched to a real name now shows the phone number instead — much easier to recognize who actually called.
- **Call duration is now visible** on every logged call.
- **Download a recording** directly from the call log, next to the player.
- **Search and filter your call list** — by outcome, or by name/company/phone — and it's now paginated instead of one long unbroken list.

#### Known limitation (not a bug)

- Some SDRs see zero recordings even on calls they know were answered. We traced this to Aircall itself not generating a recording for those specific calls — confirmed by comparing raw call data between an SDR whose recordings work and one whose don't. This needs a check in Aircall's own settings, not a CRM fix.

---

## v10.9.2 — 12 Aug 2026
### 📊 Analytics Hub — Accuracy Fixes

#### Bug Fixes

- **The same number no longer disagrees with itself.** Calls, emails, and meeting counts could previously show differently depending on which pod or date filter you had selected — they now agree everywhere.
- **A call to a brand-new number is no longer lost.** If the phone number doesn't match an existing lead yet, one is created automatically instead of the call going untracked.
- **Connect Rate now counts a real answer as a real answer.** Previously it only counted a call as "connected" if someone manually logged an outcome — now it also recognizes when the call was genuinely answered.
- **Removed the Research metric** from Analytics Hub — it tracked something the team no longer manages this way, and mostly just added confusion.

#### Under the Hood

- `backend/models.py`: new shared `assign_lead()`/`disqualify_lead()` helpers so pod assignment and lead-closing fields can't drift out of sync at any call site again.
- `backend/dialer_service.py`: Aircall's live webhook and nightly historical sync now auto-create a lead on an unmatched number (mirroring the existing Klenty sync pattern), and both write a native "answered" signal for Connect Rate.
- `backend/routes/analytics_routes.py`: shared pod-scope and date-bucket helpers applied consistently across `/funnel`, `/trend`, `/email-breakdown`, and `/batch-summary`.
- Backfilled 2,578 leads' pod assignment and 80 leads' close date on production to match the fixed logic going forward.

---

## v10.9.1 — 12 Aug 2026
### 📞 Aircall Everywhere — Drawer Fixes

#### Bug Fixes

- **The drawer's own trigger button is no longer hidden behind the drawer** — it now sits above the panel, reachable at all times.
- **You can now close the drawer any time** (except mid-call) — a close button and Escape key both work, even before you've logged in. Previously there was no way to dismiss it until login finished.
- **Opting out of Aircall Everywhere no longer leaves a squeezed, half-empty page** — that was a real bug, not a cosmetic gap.
- **Visual polish**: a clearer header, a better-framed login screen, a properly separated "Prefer your Desktop app?" link.

---

## v10.9.0 — 11 Aug 2026
### 📞 Aircall Everywhere — Global Drawer

#### New Features

- **Log into Aircall right in your browser, from anywhere in the app.** A new drawer, opened from the icon next to your other topbar actions, lets you connect Aircall Everywhere once — after that, the ordinary Call button on any lead rings straight into your browser, no Desktop app required.
- **The page stays readable while you're on a call.** The drawer no longer covers or dims the rest of the screen — the page shrinks to make room, so you can keep reading the lead's details while you talk.
- **A quick one-time tip** explains the drawer the first time you see it, including the one thing that matters most: dial from the lead's own Call button, not the pad inside the drawer, so the call stays attached to the right lead.

#### Under the Hood

- `frontend-react/src/features/aircall-everywhere/`: new home for the login hook and drawer component, moved out of Power Dialer since this is no longer scoped to one page.
- `frontend-react/src/layout/NavTopbar.jsx` / `NavHub.css`: drawer trigger and panel, mounted in the persistent app shell so it survives navigating between pages.
- `frontend/css/style.css`: `.view-container` now shrinks (synced transition) instead of the drawer sitting on top of it.
- The pre-existing "Dial" (manual number) button now hides itself once the drawer is your real dialing path — still available if you're on Alternate Messenger or haven't logged into the drawer yet.
- Backend: a real cross-agent call-matching bug fixed along the way — two SDRs dialing leads that share a phone number could have had their in-progress calls mixed up; now scoped correctly to each agent.

---

## v8.9.6 — 08 Jun 2026
### ⚡ Analytics Hub — Instant Navigation (No Reload on Return Visits)

#### Bug Fixes

- **Analytics Hub no longer reloads when you navigate back to it:** Previously, every time you left the Analytics Hub and returned (e.g. checked Leads, then came back), the entire hub re-initialised — destroying all loaded data and re-fetching every chart from scratch. This was a silent bug where the app was calling `unmount()` at the wrong time, wiping the React tree on every navigation. Fixed: the hub now stays alive when you leave and resumes instantly when you return.

#### Under the Hood

- `frontend/js/app.js`: `unmount()` now only fires when genuinely leaving analytics. Navigate-back calls the new `navigate()` method (no teardown, no API calls).
- `frontend-react/src/pages/Analytics/AnalyticsHub.jsx`: `onFiltersChange` now uses a stable `useCallback` reference — prevents a secondary data load triggered by React re-render prop diffing.
- No database changes. No new environment variables.

---

## v8.9.5 — 08 Jun 2026
### ⚡ Analytics Hub — 6× Fewer API Calls, Faster Load

#### Bug Fixes

- **Analytics Hub was making 6 duplicate API requests per visit — now it makes 1:** A Chrome DevTools audit revealed three separate bugs causing the funnel, SDR table, trend, and AI insight endpoints to fire up to 6 times per session. All three root causes are fixed:
  1. An async pod-list fetch was incorrectly making the filter state appear to change — triggering a second full data load every time the pod list arrived.
  2. The AI insight badge (e.g. "Low connect rate") was re-running its Groq AI request on every data refresh, not just when filters changed.
  3. The CSS stylesheet was missing a version string — browsers were serving a stale cached version after deploys.

- **AI insight badge updates at the right time:** The "Low connect rate" and "High effort" badges in the Analytics Hub now update only when you change a filter (POD, date range, or batch) — not on every background data refresh. Fewer unnecessary AI calls, faster updates when filters actually change.

#### Under the Hood

- 19 new backend edge case tests added (cross-user isolation, pin lifecycle, filter context injection, cache key isolation). Full suite: 1,574 passed, 0 failures.
- No database changes. No new environment variables.

---

## v7.2.0 — 27 May 2026
### 🛡️ Dialer Hardening — Smarter Phone Validation & Better Error Messages

#### Improvements

- **Phone numbers with extensions now work automatically:** If a lead's phone number includes an extension (e.g. `+1 800-887-8965 ext 288`), the extension is now automatically stripped before dialling. Previously this caused a silent failure — the call never went through. Now the call connects correctly and a log note records the stripped extension.

- **Dots in phone numbers handled correctly:** Phone numbers formatted with dots (e.g. `+1.212.555.1234`) are now cleaned automatically before dialling. No more manual cleanup needed.

- **Invalid numbers caught before dialling — with a clear message:** Numbers that can never connect (Indian toll-free 1800/1860 service lines, invalid US area codes like 011x/010x, numbers that are too short or too long) are now blocked immediately with a plain-English explanation. Previously these caused a raw API error that gave no useful information.

- **Alternate Messenger error messages are now actionable:** When Alternate Messenger rejects a call, you now see exactly why — e.g. *"Alternate Messenger says: phone number not reachable"* or *"rate-limiting — wait a few seconds and try again"*. Every error type has a specific message and a suggested next step instead of a raw technical error code.

- **Consistent behaviour across both dialers:** Aircall and Alternate Messenger now share the same phone validation logic — the same number that's caught on one dialer is caught on the other.

#### Under the Hood

- 91 new automated tests added — 1,273 tests total, 0 failures
- No database changes, no new environment variables, no migration steps required

---

## v6.8.1 — 25 May 2026
### 🚨 P1 Hotfix — Calls Broken for Ad-Hoc Numbers

#### Bug Fixes
- **Calls to unlisted numbers now work (P1 fix):** Dialling a number not already in the CRM caused a server error (HTTP 500) and the call never started. The system tries to create a temporary lead record for unrecognised numbers — this was failing because a required internal field (`sf_lead_id`) was left empty. Fixed: the field is now auto-populated with a unique internal ID so the call can proceed immediately.

---

## v6.8.0 — 25 May 2026
### 🛡️ Staging Stability & SDR UX Refinements

#### Bug Fixes
- **Alternate Messenger Call Recordings Now Visible**: Recordings from Alternate Messenger calls were never appearing in the lead Calls tab. The root cause was that the system was using the global Aircall provider to fetch recording URLs for Alternate Messenger calls — a mismatch that silently returned no data. The recording refresh logic now uses the correct provider per call. Recordings will appear on the next page load for completed calls.
- **Test Suite Isolation & Reliability**: Refactored backend public API key auth to inject the request's DB session dynamically, fixing database connection bleed and making the full backend unit test suite completely stable. Mapped mock URL responses to prevent real network calls during testing.
- **Manual Dial Sync Active Hidden**: The Dial/Call buttons are now dynamically hidden on lead details and lists if a manual dial sync is actively running.
- **Clear Filter Page Reload**: Clicking the "Clear Filters" button on the lead list view now triggers a clean page reload to completely reset all filter inputs and pagination states.
- **SDR Settings Dialer Toggle**: SDRs can now toggle the Alternate Messenger WebRTC dialer widget on or off directly within their Settings panel.
- **SDR Error Logs Resolve Cleaned**: Removed the redundant "Resolve" buttons from the System Error Logs view for SDR-role users, restricting resolution permissions to administrators.
- **Compact Call Log Modal UI**: Streamlined the call log details modal to occupy less screen space and improve visual hierarchy.

---

## v6.5.0 — 22 May 2026
### ⚡ Performance Hotfix + CORS Fix

#### Bug Fixes
- **Call Logs now load in under 300ms** (was 3–8 seconds): The System Logs → Call Logs page was loading all 11,000+ call records into memory to compute summary stats. Replaced with a direct SQL aggregation — load time dropped by ~95%.
- **CORS error fixed**: All API calls from the production app (`alternatecrm.staging.in`) were being blocked by the browser with a CORS error. Fixed by updating the server's allowed-origins configuration.
- **Login speed improved**: On every login, the system fetched a user's entire lifetime call history just to count today's calls. Now queries only today's data directly from the database.
- **SDR Performance page faster**: Status counts on the SDR performance report were computed in Python by iterating all leads. Now computed as a single SQL query.

#### Infrastructure
- 3 new database indexes added on call tables — date-range filters and sort queries are now significantly faster as call volume grows.

---

## v6.4.8–v6.4.9 — 22 May 2026
### 🛡️ Edge Case Hardening + Test Infrastructure

#### Bug Fixes
- **Timer cross-call bleed fixed**: If a new call started within 1.5 seconds of the previous call's widget closing, the old 45s safety timer could accidentally fire against the new call. Each timer now locks to its specific call ID.
- **Calls tab retry window extended**: On slower networks the automatic Calls tab switch after logging an outcome could miss its timing window. Extended from 600ms → 1200ms.
- **Outcome modal shows correct lead name**: For ad-hoc (non-lead-page) dials, the outcome modal now always shows the correct lead name instead of a blank field.
- **Dialer phone field consistency**: `GET /api/dialer/my-phone` now returns `from_number` (canonical field name) matching all other dialer endpoints — prevents silent field-name mismatches.

#### Infrastructure
- 175 automated tests passing, 0 failures
- New `00-sanity.spec.js` pre-flight suite: 13 checks that validate frontend reachability, API auth, CORS, and database before running the full test suite

---

## v6.4.4–v6.4.7 — 22 May 2026

### 📞 Alternate Messenger Dialer — Declined Call & UX Fixes

A targeted reliability sprint fixing three issues discovered during live testing.

#### Bug Fixes

- **Declined call stuck on "Ringing…" forever (v6.4.5 + v6.4.6):** When the recipient pressed Decline on their phone, the Alternate CRM dialer widget stayed frozen showing "Ringing…" indefinitely. Root cause: Alternate Messenger's status API has a 7–30 second lag before reflecting the declined state. Fixed with two backend guards — Guard 1 immediately returns "Call Ended" if the call's end-time is already recorded, and Guard 2 auto-closes any Alternate Messenger call that has been ringing for more than 50 seconds with no answer. A third 45-second client-side timeout was also added as a safety net.

- **Outcome modal appearing behind the dialer and vanishing (v6.4.7):** After a call ended, the "Log your call outcome" modal briefly flashed and then disappeared, hiding behind the Alternate Messenger widget. Fixed — the outcome modal now always appears on top of everything.

- **Calls tab not refreshing after logging outcome (v6.4.7):** After submitting a call outcome, the app reloaded the lead but left the Overview tab open — the SDR had to manually click the Calls tab to see the new entry. Fixed — the app now automatically switches to the Calls tab after an outcome is logged.

- **Ad-hoc dial call not registered in history (v6.4.4):** When using the Ad-hoc Dial panel, the call was not appearing in call history because the call record was never created in the database. Fixed — manual dials now correctly create a call record and appear in the Calls tab.

#### Improvements

- **Calls tab auto-refresh (v6.4.4):** After a Alternate Messenger call ends, the Calls tab now automatically reloads its data. If you were already on the Calls tab when the call ended, the new entry appears instantly — no page refresh or manual click required.

---

## v6.4.x – 21 May 2026


### 📞 Alternate Messenger Dialer Reliability + Search Fix

A series of improvements and fixes to the Alternate Messenger dialer integration and global search.

#### Bug Fixes

- **Ad-hoc dial was broken (v6.4.1):** Clicking "Phone Bridge" or "Browser Call" in the Ad-hoc Dial panel did nothing — the widget went blank. Fixed. The call now initiates correctly with a "Connecting…" spinner while the call is being set up.

- **Random lead name appearing in widget footer (v6.4.1):** When the ad-hoc dial panel was used, a previous lead's name (e.g. "Melanie Pratt / No Answer") appeared in the widget footer. Fixed — the footer no longer shows stale call history during an ad-hoc dial.

- **Full-name search not working (v6.4.2):** Searching "Melanie Pratt" in the top search bar returned no results, even though she was in the system. Fixed — the search now matches across both first and last name columns together, not just individually.

#### Improvements

- **Button clean-up for Alternate Messenger users (v6.4.0):** The redundant "Call via Alternate Messenger" and "Message" buttons no longer appear for SDRs using the Alternate Messenger dialer — the floating widget handles both. Aircall users who also have Alternate Messenger messaging enabled still see the Message button.

- **Call history pagination (v6.4.0):** The Calls tab on a lead now loads 10 records at a time. A "Load more" button appends the next page without resetting the view. Previously all calls loaded at once regardless of how many there were.

- **Search completeness (v6.4.3):** Search now checks 9 fields: first name, last name, full name (first+last), full name (last+first), email, company, primary phone, secondary phone, and company phone. Searching by company phone number now works.

- **Search performance (v6.4.3):** The search bar now waits for at least 2 characters before querying — prevents unnecessary server hits on single keystrokes.

---

## v5.16.0 – 20 May 2026

### 🎯 SDR UX Overhaul — Call Modal v2, Lead Navigation, Aircall Auto-Sync, Multi-Number Calling

The biggest SDR workflow upgrade since v5.0. Four high-impact improvements based on direct SDR feedback.

#### New Features

- **📞 Redesigned Call Outcome Modal (F1):** The call logging modal now works in three clear steps. Step 1 asks "Did the call connect?" — tap **No / Voicemail** or **Yes, Connected** to continue. Step 2 shows the right outcome chips for your answer. Step 3 (Yes branch) expands a meeting scheduler when you select Meeting Confirmed. No more scrolling through a long dropdown — the right options appear automatically. Keyboard shortcuts: `Y`/`N` for branch selection, `1`–`9` to pick a chip, `Enter` to submit.

- **⬅️ ➡️ Lead Navigation Bar (F2):** A sticky **Prev / Next** bar appears at the top of every lead detail page, letting you move through your lead list without going back to the table. Use `Alt+←` / `Alt+→` keyboard shortcuts. The bar shows your position (e.g. "Lead 3 of 47") and the name of the adjacent lead.

- **🤖 Aircall Auto-Sync (F3):** When you tag a call in Aircall with a standard tag (No Answer, Left Voicemail, Meeting Booked, etc.), Alternate CRM automatically logs the outcome — **no manual logging required**. If you prefer to log it yourself, your manual entry takes precedence (idempotent: the system never overwrites a manually logged outcome). Admins can customise the tag-to-outcome mapping in Settings → Dialer → Aircall.

- **📱 Multi-Number Split Button (F4):** When a lead has more than one phone number on file (e.g. mobile + company phone), the call button becomes a **split button** — click the arrow to pick which number to dial. The last-used number is remembered for the session.

#### Admin Notes

- Aircall Auto-Sync uses your existing Aircall webhook URL — no new configuration needed for standard tags.
- Custom tag mappings can be set in **Admin → Settings → Dialer → Aircall Tag Mapping** (UI in Phase 2 — default mapping is active from day one).

---

## v5.15.x – 15 May 2026

### 🔧 Outcome Gate, Dialer Hardening & Bug Fixes

A series of stability and UX improvements shipped across v5.15.0–v5.15.5.

#### New Features

- **Automated Outcome Gate (v5.15.0):** After every dialer-initiated call, a sticky banner + modal automatically prompts you to log the outcome. You cannot accidentally skip it. If you dismiss the banner, a note is automatically added to the lead's timeline.
- **Independent Dialer Test Buttons (v5.15.0):** Admins can now test Aircall and Alternate Messenger credentials independently from Settings → Dialer — no need to toggle providers off/on.

#### Bug Fixes

- **Duplicate call log entries fixed (v5.15.1 & v5.15.2):** Calls are now matched by exact DB UUID — one call always produces exactly one log entry.
- **Discovery gate stuck "Log outcome first" (v5.15.3):** Fixed — the gate now clears immediately after logging an outcome without requiring a page refresh.
- **Call entry label stuck on "In Progress" (v5.15.3):** Fixed — shows "Outcome Logged" state correctly.
- **Meeting Complete / Demo Failed TypeError (v5.15.2):** Fixed — buttons work correctly without throwing an unhandled error.
- **Admin user deletion 500 error (v5.15.4):** Fixed — deleting a user no longer throws an IntegrityError.

---

## v5.13.0 – 13 May 2026


### 🔍 SDR Discovery Pipeline — Full Workflow Completion

Completes the end-to-end SDR discovery meeting lifecycle. SDRs can now log discovery calls, advance leads through structured discovery stages, and trigger the demo scheduling workflow — all from the lead detail page.

#### New Features

- **📞 Add Discovery Call:** "Add Discovery Call" button calls the real `POST /leads/{id}/add-discovery` API (was a client-side no-op). Increments `discovery_meeting_count` on the lead and logs the activity.
- **✅ Complete Discovery:** "Complete Discovery" button advances the lead to `Discovery Complete` stage. Requires at least one discovery meeting logged.
- **📅 Schedule Demo:** "Schedule Demo" button becomes visible at `Discovery Complete` stage, advancing the lead to `Demo Scheduled`.
- **⚠️ Max-Attempts Banner:** Warning banner rendered directly on the lead detail header when a lead has reached the maximum discovery meeting attempts.
- **📅 Meeting Confirmed Modal:** Call modal now shows a required datetime picker when "Meeting Confirmed" is selected as the outcome.

#### Backend

- **`backend/models.py`** — `discovery_meeting_count INTEGER DEFAULT 0` added to `Lead` model
- **`backend/migrations.py`** — V36 migration: `ADD COLUMN IF NOT EXISTS discovery_meeting_count` (raw `information_schema` check — bypasses SQLAlchemy inspector cache)
- **`backend/routes/lead_routes.py`** — New `POST /leads/{id}/add-discovery` endpoint; `_lead_to_dict` exposes `discovery_meeting_count`
- **`backend/routes/admin_routes.py`** — Emergency `/api/admin/force-add-column` endpoint for raw-SQL DDL when startup migration silently fails

#### E2E Tests

- **`tests/sdr-lead-page-p1.spec.js`** — P1 SDR workflow suite (15 tests)
- **`tests/sdr-lead-page-p2.spec.js`** — P2 Discovery Stage suite (selector fix: replaced `:has-text()` in `querySelector` with Playwright locator API)
- P3–P4 suites added for full lifecycle coverage

#### Migration Notes

`discovery_meeting_count` added via V36 migration. Auto-applied on startup. Migration uses raw `information_schema` check to avoid SQLAlchemy inspector caching issues on staging PostgreSQL. Force-apply endpoint available at `/api/admin/force-add-column` if startup migration is skipped.

#### Breaking Changes

None — all changes are additive and backward-compatible.

---

## v5.12.3 – 13 May 2026

### 🛡️ P1 Hardening — Import Route Resilience

Hardens the lead import pipeline against transient database failures to prevent split-brain data states.

#### Changes

- **`backend/routes/admin_routes.py`** — Every per-row lead creation loop now wraps each row in `db.begin_nested()` (savepoint). One constraint violation no longer corrupts the session (`PendingRollbackError`) and crashes the entire import.
- **`backend/routes/admin_routes.py`** — `LeadUploadLog` now added to session and committed in a single atomic `db.commit()` with the leads. Eliminates split-brain risk where leads land but the upload log is lost on transient DB error.
- **`docs/AGENT_PROTOCOL.md`** — Rule 11 added: bans separate `db.commit()` for lead write and upload log; mandates `db.begin_nested()` in import loops.
- **`docs/RELEASES.md`** — v5.12.3 entry added.

#### Migration Notes

No database schema changes. No manual steps required.

#### Breaking Changes

None.

---

## v5.11.0 – 12 May 2026

### 🩺 Integration Health Diagnostics — Dialer & Chat

Two new auth-protected endpoints let admins instantly diagnose integration failures without digging through logs or environment dashboards.

#### New Endpoints

**`GET /api/dialer/health`** — Checks the Alternate Messenger Contact Center (calling) stack:
- Provider configured (`messenger` / `aircall` / `none`)
- API credentials present (shared or separate, safely masked)
- `from_number` (caller ID) set — the #1 cause of silent call failures
- Live API ping with real connectivity result

**`GET /api/chat/health`** — Checks the Alternate Messenger Conversations (messaging) stack:
- `messenger_enabled` flag toggled on
- `api_key`, `user_id`, `account_id` all set
- `sender_id` (outbound WhatsApp/SMS number) present
- Live API ping via `list_conversations(page_size=1)`

Both return `{ "status": "ok" | "degraded", "checks": { key: { ok, message } } }`. No secrets are exposed — all credential values are masked (e.g. `abc***xyz`).

#### Files changed
- **`backend/routes/integration_health_routes.py`** [NEW] — Both diagnostic routes
- **`backend/main.py`** — Registered `integration_health_router` (V35)

#### Breaking changes
None — read-only diagnostic endpoints, no schema or data changes.

---

## v5.10.0 – 12 May 2026

### 💬 Alternate Messenger Floating Widget — Unified Messaging Surface

The Alternate CRM messaging interface has been unified into a single floating widget. The old iframe-based Conversations tab is deprecated. SDRs can now message directly from any lead without a page reload.

#### What's new

- **💬 Message button** — A green **Message** button in the lead detail action row opens the floating Alternate Messenger widget for that lead (name, phone pre-loaded).
- **🪟 Floating widget (unified surface)** — `MessengerWidget` is now the only messaging interface. It floats over the page, supports active-call state (timer, disconnect), and exposes a no-phone guard for leads without a number.
- **📞 Timer sync** — Widget timer anchors to the exact call start time from the `alternate:call-started` event — no drift between dialer and messaging UI.
- **🚫 No-phone guard** — Widget shows a "No phone number" notice instead of a blank compose area when the lead has no valid number.
- **⚙️ Admin-controlled** — Super Admins enable this via **Settings → Sync → Alternate Messenger Messaging**. SDRs without it enabled see no UI change.

#### Files changed

- **`frontend/js/messenger_widget.js`** — Dynamic header (lead name + phone), no-phone guard, timer anchoring, dialer suppression scoped to active calls, loading state for compose area
- **`frontend/js/app.js`** — Widget boot post-login; injects `messenger_sender_id` from SyncSettings; exposes `window._openMessagingWidget(lead)`
- **`frontend/js/views/lead_detail.js`** — Iframe tab deprecated; 💬 Message button + Conversations tab now invoke the floating widget
- **`frontend/js/views/dialer_widget.js`** — Added `startTime` to `alternate:call-started` event payload
- **`frontend/css/messenger_widget.css`** — Removed dead `.cw-powered-by` styles; added dynamic header lead-info styles
- **`frontend/index.html`** — Registered `messenger_widget.css` and `messenger_widget.js`

#### Breaking changes

Iframe-based Conversations tab is deprecated. The floating widget is now the canonical messaging surface.

#### Migration notes

No database changes required. Feature is opt-in via Settings → Sync → Alternate Messenger Messaging toggle.

---

## v5.9.0 – 11 May 2026

### 🔍 Error Logs — System Health Visibility for Admins

Alternate CRM now automatically captures every frontend and backend error and surfaces it in plain English inside **Audit Logs → Error Logs**. No more digging through Render logs or browser consoles.

#### What's new

**Error Logs tab** inside Audit Logs shows a live feed of all system errors — translated from technical exceptions into plain-English descriptions any admin can understand. Each card shows:

- **Severity** — Critical (server crash) or Warning (failed API call, upload error, etc.)
- **Plain-English title and description** — e.g. "A background operation failed unexpectedly — an async task failed without being caught"
- **What to do** — actionable hint for the admin
- **Who triggered it** — user email and timestamp
- **Occurrence count** — if the same error fired 10 times, one card shows ×10 instead of 10 separate entries
- **Resolve** — one-click to mark as resolved; the card fades out and the badge clears

#### Filters
Filter by **Severity** (All / Critical / Warning), **Category** (API, Dialer, Research, Upload, Salesforce, Auth), and **Status** (All / Unresolved / Resolved).

#### Role-based visibility
- **Super Admin** — sees all errors across all users
- **Pod Admin** — sees errors from their pod SDRs only
- **SDR** — sees their own errors only

#### Automatic housekeeping
Error logs older than **15 days** are automatically purged nightly — the list stays clean without manual intervention.

#### Performance impact
Zero. All error capturing is fire-and-forget — errors are logged in a background thread and never block or slow down the page.

---

## v5.8.2 – 11 May 2026

### 🐛 Bug Fix: Research → Calling Gate Always Blocking

Fixed a critical SDR workflow blocker where the "Complete AI research first" guard prevented lead status transitions to **Calling** even when all four required research fields were fully populated.

### Root Cause

The frontend validation in `lead_detail.js` was querying DOM elements by ID (`document.getElementById('research-company')` etc.) to check field values. These IDs do not exist in the DOM — research fields are rendered as read-only `<div>` elements, not `<input>` elements. As a result, all four lookups returned `null`, and the gate always evaluated fields as empty, permanently blocking the transition.

### Fix

Replaced DOM element lookups with direct checks against the in-memory `lead` JavaScript object — the same source used by the existing `countResearchFilled()` function. The four fields validated are:

- `lead.research_company`
- `lead.research_contact`
- `lead.research_hypothesis`
- `lead.research_personalization`

The gate now correctly reflects the backend data state: if all four fields are non-empty strings, the transition to Calling is permitted.

### Files Changed

- **`frontend/js/views/lead_detail.js`** (lines 1037–1056) — Validation logic refactored to use `lead` object instead of DOM queries

### Testing

- 22/22 backend tests passing
- No test coverage existed for the frontend gate (gap noted for future Playwright spec)
- Manually verified against backend `move_lead_kanban` gate at `lead_routes.py` — both now consistently require all 4 research fields

### Breaking Changes

None — no API or schema changes. Pure frontend logic fix.

---

## v5.8.0 – 8 May 2026

### 🤖 AI Research Prompt Editor (Super Admin)

Super Admins can now view, customize, and reset the AI research prompt used to generate lead intelligence. The editor lives in **Settings → AI Settings** and gives full control over what context the AI focuses on.

### New Features

- **✍️ Prompt Editor (Settings → AI Settings):** A new card allows Super Admins to write a custom research prompt. The editor includes:
  - Live character counter with color thresholds (green → amber → red)
  - Click-to-insert `{lead_context}` variable chip — injects all lead fields into the prompt automatically
  - **Custom** badge when a prompt is active; **Default** badge when using the system prompt
  - Save and Reset to Default buttons
- **🔄 Dynamic Prompt Injection:** The AI research backend now reads the custom prompt from the database and injects `{lead_context}` at runtime. If no custom prompt is configured, the system default is used seamlessly.

### Bug Fixes

- **🧪 Sandbox Tab Rendering:** Fixed the "Loading sandbox configuration..." placeholder persisting below the rendered sandbox UI in Settings → Sync.
- **⚡ Sandbox Refresh Timeout (Critical):** The "Refresh from Production" flow was failing with a request timeout because the entire database was being exported in a single HTTP response (~10–50MB). Fixed by splitting into per-table requests:
  - `GET /api/admin/sandbox/export/tables` → returns table list + row counts (fast, <1s)
  - `GET /api/admin/sandbox/export/table/{name}` → exports one table at a time (30s max each)
  - The refresh worker now loops table-by-table — each request stays well within Render's 30s timeout

### Backend

- **`backend/models.py`** — `research_prompt` (TEXT, nullable) added to `SyncSettings`
- **`backend/migrations.py`** — V31: idempotent `ADD COLUMN IF NOT EXISTS research_prompt`
- **`backend/routes/admin_sync_routes.py`** — `research_prompt` exposed in GET/PATCH sync-settings API
- **`backend/routes/ai_research_routes.py`** — `_build_prompt()` injects custom template; `_get_llm_config()` reads from DB
- **`backend/routes/sandbox_routes.py`** — New `/export/tables` + `/export/table/{name}` endpoints; `_do_refresh` refactored to per-table loop

### Frontend

- **`frontend/js/views/settings_ai_dialer.js`** — Prompt Editor card with char counter, variable chip, save/reset
- **`frontend/js/views/settings.js`** — Sandbox tab loading placeholder cleanup fix

### Migration Notes

- V31 migration runs automatically on startup — idempotent, no manual steps
- `research_prompt = NULL` → system default prompt is used (fully backward compatible)

### Breaking Changes

None — all changes are additive and backward-compatible.

---

## v5.7.6 – 8 May 2026

### 🐛 Bug Fixes

- **AI Research broken in prod (P1)** — The 🤖 AI Research button showed `"Unexpected end of JSON input"` for all SDRs. Root cause: the fetch URL used a relative path (`/api/leads/.../ai-research`) which hit the static frontend server (HTML 404) instead of the backend API in the decoupled production setup. Fixed to use `${API_BASE}` consistent with all other API calls.
- **Research save silently failed** — `patchLeadResearch` in `api.js` called `res.json()` without checking `res.ok`, so HTTP 4xx/5xx errors returned silently as plain objects instead of throwing. The Save button showed ✅ even when the save failed, leaving research fields empty in the DB and blocking the move to Calling.
- **Progress ring misleading** — Sub-text said "11 more to unlock Calling" but only 4 core fields are actually required by the backend. Updated to say "X required fields left to unlock Calling" and "✅ Core research done — you can move to Calling" once the 4 required fields are filled.
- **Null-safe field collection** — Save handler now uses `?.value ?? null` to skip fields not present in the DOM, preventing previously-saved values from being overwritten with blank strings on partial page load.

### Breaking Changes

None — frontend-only change, no migration required.

---

## v5.7.5 – 7 May 2026

### ⚙️ Deployment Process Hardening

Enforced disciplined, error-proof production deployment protocols following two consecutive P1 outages. All operational rules consolidated into a single canonical file; automated safety gates introduced.

### Process & Tooling

- **`docs/AGENT_PROTOCOL.md`** — Created single source of truth merging `MYAGENT.md`, `Dev_Protocol.md`, and `DEPLOYMENT_PROTOCOL.md`. Eliminated conflicting rules across 5 overlapping docs.
- **`docs/command.txt`** — Shrunk to 5-line startup pointer to `AGENT_PROTOCOL.md`
- **`scripts/pre-deploy-check.sh`** — New interactive pre-deploy gatekeeper: validates branch, tests, migration safety, staging health, and release note presence. **Mandatory before any merge to `main`.**
- **`.gitmessage`** — New commit message template enforcing `<type>(<scope>): <summary>` format with mandatory `What / Why / Risk / Testing` fields
- **`docs/RELEASES.md`** — New deploy-time release tracker; backfilled entries for v5.6.x through v5.7.4
- **`scripts/close_day.sh`** — Added EOD gate: warns if commits landed on `main` today without a corresponding release note entry

### Rules Enforced (new in AGENT_PROTOCOL.md)

- `git merge --no-edit` is **forbidden** — all merges to `main` require a human-readable message
- AI agent must **never** push to `main` without explicit user approval — even during an active incident
- One RCA → one new checklist item within 24h
- `/api/health/deep` must return `db_tables_accessible: true` before any merge to `main`

### Breaking Changes

None — documentation and scripting only. No application code changed.

### Commit

`497168c` — `process: enforce deployment discipline — commit template, pre-deploy script, release notes`

---

## v5.7.4 – 7 May 2026

### 🛡️ Migration Safety & Deep Health Check

Full infrastructure hardening following the 7 May P1 deadlock outage. Ensures data migrations run exactly once and health checks accurately reflect database accessibility.

### Infrastructure

- **`migrations.py`** — `_applied_migrations` tracker table created on first startup. All 14 historical data migrations now idempotent — each runs exactly once, tracked by name. Subsequent restarts skip all 14 instantly (zero DB scans).
- **`migrations.py`** — `SET LOCAL lock_timeout = '10s'` added to all `ADD COLUMN` DDL. Unguarded `ALTER TABLE` on hot tables is now impossible.
- **`app_state.py`** — New module. `startup_complete` boolean flag set `True` when all migrations finish.
- **`main.py`** — Sets `app_state.startup_complete = True` at end of startup thread. Prevents false "ready" signals.
- **`auth_routes.py` `/api/health`** — Exposes `startup_complete` field. Always returns HTTP 200 to prevent Render restart loops during long migrations.
- **`auth_routes.py` `/api/health/deep`** — New endpoint. Runs `SELECT 1 FROM leads LIMIT 1` with `statement_timeout = '2s'`. Returns `db_tables_accessible: true/false`. Detects lock outages before users notice.

### Migration Notes

- Creates `_applied_migrations` table on first deploy (`CREATE TABLE IF NOT EXISTS` — fully idempotent)
- All 14 historical migrations backfilled and recorded on first startup
- No manual intervention required

### Verified on staging

No — hotfix deployed directly to production during P1 recovery (staging was also affected)

### Rollback commit

`637dfa4`

### Commit

`09ded47` — `hardening: migration tracker, lock_timeout, improved health checks`

---

## v5.7.3 – 7 May 2026

### 🚨 P1 Hotfix — DB Deadlock on Startup

Emergency fix for production outage caused by unconditional `ALTER TABLE leads` on every startup conflicting with a running data migration on a large production table.

### Root Cause

`ALTER TABLE leads ALTER COLUMN status TYPE VARCHAR(255)` ran unconditionally on every startup. On 7 May deploy, it took `AccessExclusiveLock` on the `leads` table at the same time the V24 migration `UPDATE leads SET times_called = 0` was still running — blocking all API traffic behind an indefinite lock.

### Fix

- **`migrations.py`** — ENUM→VARCHAR conversion now checks `information_schema.columns` first. Skips `ALTER TABLE` if column is already `character varying`. Idempotent.
- **`migrations.py`** — Added `SET LOCAL lock_timeout = '5s'` on ENUM conversion DDL as a hard ceiling even if the guard fails.

### Impact

- Production down ~15–20 min (Render health check restarts + lock hold)
- All authenticated API calls returning 503
- Fix deployed and verified by monitoring `/api/health/deep` response

### Verified on staging

No — emergency hotfix during active P1 outage. Staging also affected.

### Rollback commit

`d4e61ef` (prior deploy — note: this commit caused the deadlock, do not redeploy)

### Commit

`ace5361` — `fix: skip ALTER TABLE if column already VARCHAR to prevent startup deadlock`

---

## v5.7.2 – 6 May 2026

### 🏗️ Full Production Frontend Decoupling

Separated frontend static assets from the backend API service. Frontend is now served via a dedicated Render static site with a global CDN; backend serves JSON API only.

### Infrastructure

- **`render.yaml`** — Added `messenger-frontend-prod` static site service for production
- **`render.yaml`** — Set `SERVE_FRONTEND=false` on `messenger-crm-prod` backend
- **`render.yaml`** — Added `FRONTEND_URL` and `FRONTEND_URLS` env vars for CORS and Google SSO redirects
- **`frontend/js/views/settings_ai_dialer.js`** — Webhook URL now uses `API_BASE` instead of `window.location.origin` — required for decoupled architecture
- **`frontend/js/config.js`** — `window.__APP_CONFIG__` injected at build time via Render build command

### Known Issue — Triggered P1 Outage

This deploy triggered the 7 May DB deadlock. The V24 migration `UPDATE leads SET times_called = 0` ran for the first time on production data (large table), overlapping with the unconditional `ALTER TABLE leads ALTER COLUMN status` from the same startup. Both held conflicting locks → all API traffic blocked.

**Root cause fixed in v5.7.3.**

### Verified on staging

Partial — CORS and login flow tested; DB migration interaction on large tables not tested

### Rollback commit

Previous working commit before decoupling

### Commit

`d3bb151` — `feat: full production decoupling — render.yaml + dialer webhook + docs`

---

## v5.7.1 – 6 May 2026

### 🛡️ System Hardening & Upload Center Fixes

Post-incident infrastructure hardening and three Upload Center bug fixes addressing wizard crashes, rollback dialog instability, and column auto-detection failures.

### Infrastructure

- **🧠 OOM Prevention:** Added `MAX_CSV_ROWS = 5000` server-side cap to reject oversized uploads before they exhaust memory. Returns a clear 400 error with the row count and limit.
- **🏥 Deep Health Check:** `/health` endpoint now runs a live `SELECT 1` against the database and reports pool utilization (`pool_size`, `checked_in`, `checked_out`, `overflow`). Returns `"db": "ok"` or `"db": "unreachable"` with HTTP 503 on failure.
- **⚙️ Pool Hardening:** Tightened connection pool settings — `pool_pre_ping=True`, `pool_recycle=1800`, and `max_overflow=5` to prevent stale connections and connection storms.

### Bug Fixes

- **💥 Upload Wizard Crash Fix:** Fixed `ReferenceError: currentStep is not defined` crash in the CSV upload wizard caused by undeclared variables in `upload_csv.js`. Added proper `let` declarations for `currentStep`, `csvData`, `headers`, and `columnMap`.
- **🔄 Rollback Dialog Auto-Dismiss Fix:** Replaced the native `confirm()` dialog in the batch rollback flow with a custom async modal. The native dialog was auto-dismissing on some browsers due to rapid re-renders, causing accidental rollbacks. The custom modal uses a Promise-based pattern with explicit Accept/Cancel buttons.
- **🗺️ COLUMN_MAP Auto-Detection Fix:** Fixed `first_name` and `last_name` columns not being auto-detected during CSV upload. Root cause: `COLUMN_MAP` only included the space-separated variants (`first name`, `last name`) but not the underscore variants. Added `first_name` → `first_name` and `last_name` → `last_name` mappings.

### Backend

- **`backend/main.py`** — `MAX_CSV_ROWS` constant, pool config hardening, deep health check endpoint
- **`backend/routes/admin_routes.py`** — Row cap enforcement in upload route

### Frontend

- **`frontend/js/views/upload_csv.js`** — Variable declarations fix
- **`frontend/js/views/upload.js`** — Custom rollback confirmation modal, COLUMN_MAP underscore variants

### Breaking Changes

- None. All changes are backward-compatible.

### Migration Notes

- No database migrations required.
- Uploads exceeding 5,000 rows will now be rejected — users must split large files.

---

## v5.7.0 – 6 May 2026

### 🎯 Dynamic Call Outcomes — Config-Driven Outcome Management

Replaces hardcoded call outcomes with a fully dynamic, admin-configurable system. Super Admins can now enable/disable outcomes, create custom outcomes, require notes, and assign outcomes to behavioral groups — all from a new Sync tab in Settings, with zero code changes or redeployment needed.

### New Features

- **⚙️ Admin Outcome Configuration (Settings → Sync):** A new "Call Outcomes" card in the Sync settings tab provides full CRUD management of call outcomes:
  - Toggle any outcome enabled/disabled via switches
  - Create up to 10 custom outcomes with name, group, and action assignment
  - "Notes Required" checkbox per outcome — forces SDRs to provide notes when selecting that outcome
  - Custom outcomes display a ✦ badge and can be deleted; builtin outcomes cannot
  - Visual counter shows custom outcome slots used (X/10)
  - Save persists the full configuration to the database as JSON

- **🏷️ Outcome Groups & Actions:** Each outcome belongs to a behavioral group (`positive`, `negative`, `neutral`, `not_answered`, `terminal`) and has an associated action (`continue`, `schedule_callback`, `disqualify`, `no_action`). The `disqualify` action is restricted to the `terminal` group, enforced both client-side and server-side.

- **🚪 "Left the Company" Auto-Disqualification:** A new builtin outcome "Left the Company" (terminal group, disqualify action) automatically moves leads to "Disqualified" status when selected, streamlining the data hygiene workflow.

- **📝 Notes-Required Enforcement:** Outcomes flagged with `notes_required: true` block call logging until the SDR provides notes. The call logging modal dynamically renders the notes textarea and validation based on the selected outcome's configuration.

### Bug Fixes

- **📞 Alternate Messenger API 400 "Invalid call_id" Fix:** Fixed HTTP 400 errors from the Alternate Messenger API caused by legacy `DialerCall` records that stored phone numbers (e.g. `3634040093`) in the `provider_call_id` field instead of actual Alternate Messenger call IDs. Added validation guards to `fetch_call()`, `get_call_status()`, and `get_recording_url()` that skip API calls when `provider_call_id` looks like a phone number (pure 7-15 digit string).

- **🧭 Navigation Test Stabilization:** Fixed 8 pre-existing Playwright test regressions caused by past navigation restructuring:
  - Lead Detail (#9): Fixed company group header rows interfering with row selectors
  - Analytics (#15, #23): Fixed ambiguous nav selectors when multiple "analytics" items exist
  - Assignments (#16): Adjusted tab detection selectors
  - Lead Filter (#17): Increased staging API timeouts for cold-start latency
  - Kanban (#10): Intentionally skipped (deprecated feature)
  - Admin Panel (#4): Increased `navigateTo()` wait from 1200ms → 2500ms for slow staging cold-starts
  - Assignments SDR Filter (#13): Corrected `#sdr-filter` → `#assigned-sdr-filter` (wrong element ID from pre-v4.8.1 rename)

### Backend

- **`backend/models.py`** — New `get_outcome_config(db)`, `get_valid_outcomes(db)`, `get_enabled_outcomes(db)`, `get_outcome_by_value(value, db)` helpers; DB-backed config with graceful fallback to defaults
- **`backend/routes/call_routes.py`** — `VALID_REASONS` and `DEFINITIVE_OUTCOMES` now derived from config at runtime; notes-required enforcement in `log_call`
- **`backend/routes/admin_routes.py`** — Full PATCH validation for `outcome_config`: required fields, duplicate detection, group/action compatibility, 10-outcome cap
- **`backend/messaging_provider.py`** — Phone-like `provider_call_id` guard on all API-calling methods
- **`scripts/migration/add_outcome_config_column.py`** — Idempotent migration to add `outcome_config` TEXT column to `SyncSettings`

### Frontend

- **`frontend/js/views/settings_sync.js`** — Interactive outcome configuration UI with toggle switches, group/action dropdowns, notes-required checkboxes, add/delete custom outcomes, and save with validation
- **`frontend/js/views/modals.js`** — Dynamic outcome dropdown and notes-required validation in the call logging modal
- **`frontend/index.html`** — Navigation restructured; Sync tab settings consolidated

### Testing

- **🧪 29 New API Tests:** `test_models.py` (9 tests), `test_call_routes.py` (7 tests), `test_admin_routes.py` (11 tests) — covering DB-backed config, runtime validation, PATCH validation, and edge cases
- **🧪 29 New Playwright E2E Tests:** `outcome-config-admin.spec.js` (12 tests) and `call-outcome-flow.spec.js` (8 tests) for admin UI and SDR flow; 9 additional tests in `super-admin-flow.spec.js` for previously uncovered Settings tabs and Metrics page
- **✅ 827 Backend Tests Collected** (51 Alternate Messenger provider tests pass)
- **✅ 86/86 Playwright Tests Pass** (11 skipped — deprecated features)

### Database Migration

- **`outcome_config`** TEXT column added to `SyncSettings` table
- Migration script: `scripts/migration/add_outcome_config_column.py` (idempotent, safe to re-run)
- Must be run on production before deployment: `DATABASE_URL=<prod_url> python scripts/migration/add_outcome_config_column.py`

### Breaking Changes

- None. All existing outcomes continue to work. Default configuration matches the previous hardcoded behavior exactly.

---

## v5.6.0 – 4 May 2026

### 📞 Alternate Messenger Dialer — WebRTC Browser Calling & Call Mode Selector

Stabilizes the Alternate Messenger Contact Center browser-based calling experience with LiveKit WebRTC integration. SDRs now hear and speak through the browser directly — no external phone bridge required. A new in-dialer Call Mode Selector lets SDRs toggle between Browser Call and Phone Bridge modes before each call.

### New Features

- **🌐 LiveKit WebRTC Integration:** Calls via the Alternate Messenger dialer now use the LiveKit WebRTC SDK (`livekit-client` v2.9.1) for real-time browser audio. When a call is initiated, the dialer widget automatically joins the LiveKit room, activates the microphone, and attaches remote audio streams — delivering sub-second voice connection with no external app
- **📞 Call Mode Selector:** Before placing a call, a new "How would you like to call?" dialog lets the SDR choose:
  - **🌐 Browser Call** (default) — call happens in-browser via WebRTC
  - **📱 Phone Bridge** — call is bridged to the SDR's registered phone number (requires admin configuration)
- **🔒 HMAC Authentication:** All Alternate Messenger API calls now use the `AlternateMessengerAuthManager` for secure HMAC token generation, replacing the previous credential-based approach
- **📦 Payload Alignment:** Removed legacy/unsupported fields (`senderId`, `callMode`) from the `initiate_call` API payload, ensuring strict alignment with the Alternate Messenger API v2 specification

### Backend

- **`backend/messaging_provider.py`** — HMAC auth via `AlternateMessengerAuthManager.get_token()`; cleaned `initiate_call` payload
- **`backend/dialer_service.py`** — Updated provider factory with `call_mode` → `use_agent_phone` mapping
- **`backend/routes/dialer_routes.py`** — Added `call_mode` parameter propagation from frontend to provider

### Frontend

- **`frontend/index.html`** — Added `livekit-client` v2.9.1 CDN script for WebRTC support
- **`frontend/js/app.js`** — `handleCallAction()` passes selected `call_mode` through to the API layer
- **`frontend/js/views/dialer_widget.js`** — Complete WebRTC lifecycle: Room join → microphone activation → remote audio attachment → graceful disconnect. Call Mode Selector UI with radio buttons and mode descriptions

### Testing

- **🧪 773 Tests Passing (0 Failed):** Updated `test_messenger_floating_button.py` edge case tests to correctly mock `AlternateMessengerAuthManager` HMAC auth and the updated payload structure
- **✅ 18 Edge Cases Verified:** Duplicate prevention, null/empty IDs, special characters, concurrent calls, and WebRTC cleanup scenarios

### Known Limitations

- Phone Bridge mode requires admin-configured SDR phone numbers (not yet available in production)
- Hold action and recording playback await further backend webhook integration
- Network reconnection during WebRTC calls relies on default LiveKit SDK behavior

### Breaking Changes

- None. Aircall integration is fully preserved. Default call mode is Browser Call. SDRs must be explicitly assigned to `messenger` to see the new dialer.

### Migration Notes

- No database migrations required for this release.
- WebRTC requires HTTPS and microphone permissions in the browser.

---

## v5.5.0 – 4 May 2026

### 🐛 Bug Fix: "15 Unassigned" in Upload History

Fixed a UI bug where all rows in the Upload Center batch detail showed "15 Unassigned" regardless of actual SDR assignments. Root cause was a hardcoded `per_page: 15` limit and the frontend reading the wrong field name (`sdr_name` instead of `assigned_to`).

### 🏷️ Feature: Upload Tagging System

Added an optional free-text **Tag** field to the upload wizard. Users can tag uploads with a source label (e.g. "Apollo", "Lusha", "Hunter") to track where enriched lead lists originated.

- Tag input available in both **CSV Upload** and **Google Sheets Import** wizards
- Tags are displayed as a 🏷️ chip next to the filename in the upload history table
- Tags are stored in the database and exposed via API for future filtering/reporting
- Empty or whitespace-only tags are stored as NULL (no tag)

### 📊 Daily Digest: Working-Day Comparisons

The Daily Digest now intelligently skips weekends when computing trend comparisons. Previously, requesting a Saturday or Sunday digest would compare against the previous Saturday/Sunday — which typically had no data, producing misleading "∞% change" metrics.

- **Weekend auto-shift**: Saturday/Sunday requests automatically shift to the previous Friday
- **Comparison date alignment**: The comparison date (last week) also shifts to the nearest working day
- **Adjustment banner**: A blue info banner appears in the digest header when a weekend date was auto-adjusted
- Response includes `is_working_day` and `original_date` metadata

### Tests

- 15 new test cases covering all three changes in `test_v26_upload_tag_digest.py`
- Full regression suite: 730 passed, 0 failures

### Backend

- **`backend/models.py`** — Added `tag` column (VARCHAR, nullable) to `LeadUploadLog`
- **`backend/migrations.py`** — V26 migration for `tag` column
- **`backend/routes/admin_routes.py`** — Tag ingestion/exposure in upload + batch APIs, `sdr_name` convenience field
- **`backend/routes/analytics_routes.py`** — `_prev_working_day()` helper, weekend adjustment logic

### Frontend

- **`frontend/js/api.js`** — Tag parameter added to `uploadLeadSheet()` and `importGoogleSheet()`
- **`frontend/js/views/upload.js`** — Tag UI inputs, tag chip in history, fixed field mapping
- **`frontend/js/views/upload_csv.js`** — Tag state management for CSV wizard
- **`frontend/js/views/upload_gsheet.js`** — Tag state management for GSheet wizard
- **`frontend/js/views/digest.js`** — Weekend adjustment info banner

---

## v5.4.0 – 29 April 2026

### 📞 Alternate Messenger Contact Center Dialer — Dual-Dialer Architecture

Adds a second dialer provider (Alternate Messenger Contact Center) alongside the existing Aircall integration. SDRs can now be individually assigned to either dialer, and calls via Alternate Messenger happen directly in the browser using a LiveKit-based WebRTC widget.

### New Features

- **📞 Alternate Messenger Contact Center Provider:** Full integration with the Alternate Messenger Contact Center API for browser-based calling. Supports call initiation, hold, mute, disconnect, call status polling, recording retrieval, and transcript display
- **🌐 In-Browser Dialer Widget:** A floating, draggable WebRTC call widget powered by LiveKit. Includes real-time call duration timer, mute/hold/hangup controls, recording indicator, and glassmorphic styling with mobile-responsive layout
- **👤 Per-SDR Dialer Routing:** Each SDR can be assigned a dialer provider (`aircall` or `messenger`) via the `dialer_provider_override` column in user settings. The system dynamically resolves the correct provider at call time
- **🔄 Dual-Sync Architecture:** Nightly call sync and startup catch-up jobs now support both providers — each provider's sync runs independently, ensuring call history stays complete for all SDRs regardless of their dialer assignment
- **🔗 Webhook Support:** Dedicated webhook endpoint (`/api/webhooks/messenger`) for real-time call event processing — handles call started, answered, ended, and failed statuses with automatic call log updates
- **📋 Call History Provider Badge:** The Calls tab on lead detail now shows a "via Alternate Messenger" badge for calls made through the Alternate Messenger dialer, alongside the existing "via Aircall" badge

### Backend

- **`backend/messaging_provider.py`** — New file. Full `DialerProvider` implementation with retry/exponential backoff for API resilience
- **`backend/routes/dialer_routes.py`** — Added `/api/calls/{id}/action` (hold/mute) and `/api/calls/disconnect` endpoints, plus `/api/webhooks/messenger` webhook receiver
- **`backend/dialer_service.py`** — Updated provider factory to support `messenger` alongside `aircall`
- **`backend/scheduled_jobs.py`** — Dual-sync architecture for nightly and startup call synchronization
- **`backend/models.py`** — Added `dialer_provider_override` field to User model

### Frontend

- **`frontend/js/views/dialer_widget.js`** — New file. Complete in-browser dialer widget with call state management
- **`frontend/js/app.js`** — Integrated `handleCallAction()` to auto-launch widget when Alternate Messenger call returns LiveKit credentials
- **`frontend/js/api.js`** — Added call action and disconnect API functions
- **`frontend/js/views/lead_calls_tab.js`** — Provider badge support for Alternate Messenger calls
- **`frontend/css/style.css`** — ~200 lines of dialer widget CSS with glassmorphism and animations

### Testing

- **🧪 51 New Tests:** Comprehensive test suite (`test_messaging_provider.py`) covering constructor/URL normalization, auth headers, call initiation (browser + phone bridge), disconnect, hold/mute actions, status polling, recording retrieval, webhook parsing (all event types), pagination, timestamp parsing, and HTTP retry logic (429 backoff, 500 immediate fail)
- **✅ 701 Total Tests Passing:** Full regression suite green (0 failures)

### Breaking Changes

- None. Aircall integration is fully preserved. The default provider remains `aircall` — SDRs must be explicitly assigned to `messenger` to use the new dialer.

### Migration Notes

- No database migrations required for this deployment phase. The `dialer_provider_override` column can be set directly in the database or via a future admin UI.

---

## v5.3.0 – 28 April 2026

### 🔄 Batch Rollback, Data Alignment & UX Stability

This release introduces a 12-hour batch rollback feature for upload safety, aligns lead list counts with dashboard metrics by globally excluding parked leads, and improves the Upload History and sidebar UX for admins.

### New Features

- **🔄 12-Hour Batch Rollback:** Admins can undo an entire import batch (CSV or Google Sheet) within 12 hours of upload. Leads that have been worked (call history, status changes beyond initial assignment) are protected and excluded from rollback. A real-time countdown timer shows remaining rollback window in the Upload History UI
- **📋 Expandable Upload History:** Upload History rows now expand to show per-SDR assignment details — which SDR received which leads — directly in the row, without navigating away
- **⏱️ Rollback Countdown Timer:** A live countdown badge shows the remaining rollback window (e.g. "11h 42m remaining") for each eligible batch. Expired batches show an "Expired" badge

### Bug Fixes

- **📊 Lead Count Alignment:** Dashboard and Leads page now show identical counts. Leads with parked statuses (e.g., "No Phone - Parked") are globally excluded from list/kanban views to match dashboard metrics
- **🤖 AI Research Auto-Trigger Fix:** Relaxed the AI Research auto-trigger condition — now fires when fewer than 3 research fields are filled (previously required exactly 0), fixing cases where partial research blocked auto-population

### Improvements

- **📅 Sidebar Reorganization:** "Daily Digest" moved directly below "Dashboard" for better admin accessibility. "Today's Calls" restricted to SDR role only — hidden for Super Admin and Pod Admin
- **🔒 Rollback Safety Guards:** Protected leads with call history, status changes, or progressed statuses from accidental deletion during rollback. Uses row-level locking (`SELECT FOR UPDATE`) to prevent concurrent rollback conflicts

### Testing

- **🧪 26 New Stability Tests:** Comprehensive test suite (`test_stability_ux_fixes.py`) covering all rollback edge cases (expiry, protected leads, concurrent access), parked-lead filtering, and assignment detail queries
- **🔧 10 Pre-Existing Test Fixes:** Resolved admin test failures caused by missing phone numbers in test data — aligned test fixtures with the v5.2.0 phone validation business logic
- **✅ 104/104 Tests Passing:** Full regression suite green across admin, lead, and stability test suites

### Technical Details

- **Backend:**
  - `backend/routes/admin_routes.py` — New `POST /api/admin/leads/upload-logs/{log_id}/rollback` endpoint with 12h window, `FOR UPDATE` locking, cascading cleanup of `LeadStatusLog`, `DialerCall`, and associated metadata
  - `backend/routes/lead_routes.py` — Added `PARKED_STATUSES` exclusion to `get_leads`, `get_my_leads`, and `get_kanban_leads` endpoints
  - `backend/tests/test_stability_ux_fixes.py` — **New file.** 26 tests covering rollback, parked-lead filtering, and UX logic
  - `backend/tests/test_admin_routes.py` — Fixed 10 test failures by adding valid phone numbers to test fixtures

- **Frontend:**
  - `frontend/js/views/upload.js` — Overhauled Upload History: rollback buttons, expandable assignment rows, countdown timers, status indicators
  - `frontend/js/api.js` — Added `rollbackUploadBatch()` API function
  - `frontend/js/views/lead_detail.js` — Relaxed AI Research auto-trigger from `=== 0` to `< 3` fields
  - `frontend/js/app.js` — "Today's Calls" hidden for non-SDR roles
  - `frontend/index.html` — "Daily Digest" moved below "Dashboard" in sidebar

### Breaking Changes

- None. All changes are backward-compatible.

### Migration Notes

- No database migrations required.
- Rollback window is fixed at 12 hours from upload timestamp — not configurable in this release.

---

## v5.2.0 – 27 April 2026

### 📵 No-Phone Lead Quarantine — Data Quality & SDR Protection

Leads without valid phone numbers now automatically bypass SDR assignment and are quarantined into a "No Phone - Parked" status. This ensures SDRs only receive actionable leads and that analytics reflect accurate performance data.

### New Features

- **📵 Phone Validation on Upload:** CSV and Google Sheet imports now validate phone fields (`phone`, `phone_secondary`, `company_phone`). Rows without any valid phone number (≥7 digits) are skipped with a count reported in the upload response (`no_phone_skipped`)
- **🚫 Status Quarantine:** Phoneless leads are set to `"No Phone - Parked"` status — a new quarantine state that prevents assignment to SDRs
- **🔄 Auto-Revert on Phone Addition:** When a phone number is added to a parked lead, its status automatically changes to `"Lead Assigned"`. If an SDR adds the number, the lead is assigned to them; if an Admin/Pod Admin adds it, the lead stays unassigned
- **📊 Dashboard "No Phone" Card:** Admin dashboard now shows a red-accented 📵 card displaying the count of parked leads needing phone numbers
- **🔒 Assignment Guards:** Both `bulk-assign` and `auto-assign-all` endpoints now filter out parked leads, preventing accidental assignment

### Improvements

- **📈 Analytics Accuracy:** Parked leads are excluded from the analytics funnel, SDR performance table, and daily digest — ensuring metrics reflect only actionable pipeline
- **📋 Dashboard Stats Accuracy:** Total Leads count on the dashboard excludes parked leads to show actionable lead count only

### Technical Details

- **Backend:**
  - `backend/models.py` — Added `PARKED_STATUSES = {"No Phone - Parked"}` constant
  - `backend/routes/admin_routes.py` — `_has_valid_phone()` and `_lead_data_has_phone()` helpers; upload validation + assignment guards
  - `backend/routes/lead_routes.py` — Auto-revert logic in `update_lead`; parked exclusion in `get_dashboard_stats`
  - `backend/routes/analytics_routes.py` — Parked lead exclusion in funnel, SDR table, and daily digest queries

- **Frontend:**
  - `frontend/js/views/dashboard.js` — New "No Phone" stat card with red accent (admin-only, conditional)

### Breaking Changes

- None. All changes are backward-compatible.

### Migration Notes

- One-time bulk cleanup required: existing phoneless leads must be migrated to "No Phone - Parked" status and unassigned. A cleanup script is provided at `backend/scripts/staging_cleanup_phoneless.py`.

---



### 📊 Daily Digest — Super Admin Leadership Summary

A new one-page operational summary designed for Super Admin leadership, providing high-signal visibility into daily SDR performance without navigating multiple screens.

### New Features

- **📊 Daily Digest Page (Super Admin Only):** A dedicated dashboard accessible from the sidebar with a single-page summary of the day's operational health:
  - **6 KPI Cards with Deltas:** Leads Assigned, Calls Made, Connect Rate, Meetings Booked, Emails Sent, and Disqualified — each showing a percentage delta comparison vs. the same weekday from the previous week
  - **Pipeline Flow Transitions:** Visual breakdown of leads moving between pipeline stages during the selected day
  - **SDR Performance Snapshot:** Activity-sorted table of all SDRs with their day's calls, emails, meetings, and research completions
  - **Notable Events:** Auto-detected highlights including top performer of the day, stuck leads (no activity in 7+ days), and batch uploads
  - **Date Picker:** Navigate to any historical date to review past digests (future dates blocked)
  - **PDF Export:** One-click download of the digest as a formatted PDF for sharing with stakeholders

### Performance Improvements

- **⚡ Assignment Endpoints Optimization:** Switched unassigned/assigned lead endpoints from full `_lead_to_dict` serialization to lightweight `_lead_to_summary` — reducing payload size and response time for admin assignment views
- **🔧 N+1 Query Fix:** Replaced `joinedload` with `subqueryload` for call_logs in assignment routes, eliminating redundant queries on large lead sets
- **📅 Chronological Sorting:** Added `created_at` field to summary serializer and applied descending sort by creation date for consistent lead ordering

### Technical Details

- **Backend:**
  - `backend/routes/analytics_routes.py` — New `GET /api/admin/analytics/daily-digest` endpoint with 6 optimized queries; Super Admin only; date-scoped with weekday-aware delta calculation
  - `backend/routes/_lead_helpers.py` — Added `created_at` to `_lead_to_summary()` output
  - `backend/routes/admin_assignment_routes.py` — `subqueryload` for call_logs, `order_by(created_at.desc())`, switched to `_lead_to_summary`
  - `backend/routes/admin_routes.py` — Same optimization applied to legacy assignment endpoints

- **Frontend:**
  - `frontend/js/views/digest.js` — New async digest view with skeleton-first loading
  - `frontend/css/digest.css` — Dedicated stylesheet (~566 lines) for digest layout, KPI cards, delta badges, and PDF export formatting
  - `frontend/index.html` — Digest CSS and nav item registered
  - `frontend/js/app.js` — Digest route registered with Super Admin guard

### Breaking Changes

- None. All changes are backward-compatible.

### Migration Notes

- No database migrations required.

---

## v5.0.1 – 22 April 2026

### 🔧 Post-Deploy Stabilization — Security, UX & UI Fixes

This patch release addresses three issues discovered during post-deployment verification of v5.0.0. All three were deployed same-day after validation on staging.

### Security Fix

- **🔒 View-As Token Isolation:** Fixed a critical bug where the "View As" feature (Super Admin impersonating another role) permanently overwrote the admin's own JWT token in `localStorage`, causing the admin's actual role to change after exiting View-As mode. The fix uses `sessionStorage` for the impersonated token, preserving the original token in `localStorage`. A visual amber banner now clearly indicates when View-As mode is active, with a one-click "Exit" button that restores the original session.

### New Features

- **⌨️ Search Hotkeys (⌘K / Ctrl+K):** Added keyboard shortcuts to instantly focus the global search bar. Press `⌘K` (Mac) or `Ctrl+K` (Windows/Linux) from anywhere in the app. Additionally, pressing `/` (forward slash) also focuses the search bar when not already in a text input. A subtle `⌘K` hint badge is now displayed inside the search bar placeholder.

### Bug Fixes

- **📦 POD Management — Add SDR Dropdown Overflow:** Fixed the "Add SDR" dropdown in POD Management being clipped/hidden behind the card boundary. Root cause: the parent `.pod-card` container had `overflow: hidden` which clipped the absolutely-positioned dropdown. Fixed by setting `overflow: visible` on pod cards and adding `z-index: 1000` to the dropdown to ensure it renders above adjacent cards.

### Technical Details

- **Frontend:**
  - `frontend/js/auth.js` — `parseJwt()` refactored to read from `sessionStorage` first (View-As token), falling back to `localStorage` (real token). New `enterViewAs()` / `exitViewAs()` helpers manage token lifecycle.
  - `frontend/js/app.js` — Added `⌘K` / `Ctrl+K` / `/` keyboard event listeners with `preventDefault()` to avoid browser address bar hijack. Search bar now displays a `⌘K` hint badge. Event listeners exclude focus when user is already in an input/textarea/contenteditable element.
  - `frontend/css/style.css` — Added `.pod-card { overflow: visible }` and `.add-sdr-dropdown { z-index: 1000 }` to fix dropdown clipping. Added View-As banner styling (`.view-as-banner`) with amber background and slide-down animation. Added `⌘K` hint badge styling.
  - `frontend/js/views/pods.js` — No logic changes; CSS-only fix for dropdown overflow.

### Breaking Changes

- None. All changes are backward-compatible.

### Migration Notes

- No database migrations required.
- Super Admins currently in View-As mode should log out and log back in to pick up the new token isolation behavior.

---

## v5.0.0 – 22 April 2026

### 🚀 Performance & UX Re-Engineering

This major release addresses critical user-reported workflow latency, navigation bugs, timezone discrepancies, and search limitations. All changes are targeted at reducing SDR friction and improving platform responsiveness.

### New Features

- **📞 Universal Search — Phone Number Support:** The global search bar now indexes `phone` and `phone_secondary` fields. SDRs can search leads by phone number (full or partial match), including E.164 format with `+` prefix. Search results display the phone number when matched.
- **💀 Skeleton-First Architecture:** All blocking spinner-based loading states in **Admin**, **Assignments**, and **Audit Logs** views have been replaced with animated skeleton loaders (`showLoader()`). This provides immediate visual feedback during API fetches, reducing perceived load time by 60-80%.

### Bug Fixes

- **🔄 Leads Tab State Persistence:** Fixed the issue where switching tabs (e.g. Leads → Dashboard → Leads) reset all filters, pagination, and sort settings to defaults. The `sessionStorage` state is now preserved across navigation and only clears naturally on browser tab close. Users can still use "Clear Filters" to reset manually.
- **⏰ Task Reminder Timezone Fix:** Fixed task reminders firing 5+ hours late (e.g. 11 AM reminder alerting at 4:30 PM). Root cause: frontend was sending naive ISO strings (`YYYY-MM-DDTHH:MM:SS`) without timezone offset, which the backend parsed as UTC. Now uses `toISOString()` to convert local time to UTC before submission.
- **📅 Notification Delay Fix:** Same timezone root cause as above — notifications set for morning were appearing the next day due to UTC/local time mismatch.
- **📊 Analytics Trend Chart 500 Error:** (v4.13.1 hotfix) Fixed `AttributeError: type object 'Lead' has no attribute 'updated_at'` by switching to `status_changed_at` in the trend query.

### Technical Details

- **Backend:**
  - `backend/routes/search_routes.py` — Added `models.Lead.phone.ilike()` and `models.Lead.phone_secondary.ilike()` to both admin and SDR search query paths
  - `backend/routes/analytics_routes.py` — Fixed `updated_at` → `status_changed_at` in trend endpoint
  - `backend/tests/test_search_routes.py` — **New file.** 18 comprehensive test cases covering phone search (primary, secondary, partial match, E.164 format, dashes, null phone edge case), SDR scope enforcement, SQL injection safety, result limits, and edge cases

- **Frontend:**
  - `frontend/js/views/admin.js` — Imported `showLoader`, replaced inline spinner
  - `frontend/js/views/assignments.js` — Imported `showLoader`, replaced inline spinner
  - `frontend/js/views/audit_logs.js` — Replaced inner `loadTab()` spinner with skeleton rows
  - `frontend/js/views/sdr_settings.js` — Imported `showLoader`, replaced inline spinner
  - `frontend/js/views/sf_logs.js` — Replaced table and detail modal spinners with skeleton rows
  - `frontend/js/views/audit_sf_logs.js` — Replaced detail modal spinner with skeleton rows
  - `frontend/js/app.js` — Removed aggressive `sessionStorage.removeItem('leads_view_state')` on navigation; added `sessionStorage.clear()` on logout to prevent state leaking between users; added phone display in search results with hover effects
  - `frontend/js/views/lead_detail.js` — Changed task `due_time` from `${date}T${time}:00` to `new Date(...).toISOString()` for correct timezone handling
  - `frontend/index.html` — Updated search placeholder to "Search leads, phone, SDRs..."

### Breaking Changes

- None. All changes are backward-compatible.

### Migration Notes

- No database migrations required.
- Existing task reminders created before this fix may still have incorrect UTC offsets. New tasks created after deployment will use correct timezone handling.

---

## v4.13.0 – 21 April 2026

### New Features

- **🔌 Public API — CMT ↔ Salesforce Bridge:** A new authenticated Public API allows external tools (e.g. CMT) to query Alternate CRM's configured Salesforce connection without requiring Google SSO.
  - **Endpoint:** `GET /api/public/sf/account` — looks up a Salesforce Account (or Lead fallback) by `messaging_provider_id` or `company_name`
  - **Auth:** `X-API-Key: <key>` header — key generated and revoked by Super Admins in Settings → Public API tab
  - **Lookup Priority:** Account by messaging_provider_AccountId__c → Account by Name (exact then LIKE) → Lead fallback (same logic)
  - **Response:** Returns `sf_account_id`, `account_name`, `sf_url` (Lightning deep-link), `confidence` (exact/like), `matched_by`, optional `candidates[]` when LIKE fallback returns multiple matches
  - **Health Check:** `GET /api/public/health` — unauthenticated liveness probe

- **⚙️ Public API Admin UI (Settings → Public API tab):**
  - Generate / Revoke API key with one click
  - Copy-to-clipboard key display (shown only once on generation)
  - Live status indicator (Active / Not configured)
  - Quick-reference API documentation inline

- **📖 Help Guide — APIs Section:** New "🔌 APIs" section in the Help guide (Super Admin only) documenting the Public API endpoints, request/response format, and auth requirements

### Bug Fixes

- **🔑 Public API 401 Fix:** Fixed 401 Unauthorized errors on the Public API admin tab caused by the frontend sending the wrong `localStorage` key (`alternatecrm_token` instead of `crm_token`) when authenticating admin requests
- **🔧 Admin Routes 500 Fix:** Fixed 500 Internal Server Error on `POST /api/admin/public-api-key/generate` caused by a missing `logger` definition in `admin_routes.py` (NameError at runtime)
- **🏢 Company Ownership on Re-Upload (Critical Fix):** Fixed a lead assignment bug where uploading a new batch containing companies that already existed in a previous batch would split those companies across multiple SDRs. The `pod_company_sdr_map` was an in-memory dict re-initialized each upload, so cross-batch company ownership was invisible to the assignment logic. Now queries the DB before falling back to round-robin — if the company already has an SDR owner in the pod, new leads for that company go to the same SDR. Fix applied to both CSV upload and Google Sheets import routes.

### Technical Details

- **Backend:**
  - `backend/routes/public_api_routes.py` — New file. Public API router with `/health` and `/sf/account` endpoints; SOQL injection protection via `_escape_soql()`; SF URL builder handles both `sf_instance` and `base_url` attributes
  - `backend/auth.py` — Added `require_api_key` dependency: reads `X-API-Key` header, decrypts stored key using `APP_ENCRYPTION_KEY`, compares using `hmac.compare_digest` (timing-safe)
  - `backend/models.py` — Added `PublicApiKey` model (id, key_encrypted, created_at, created_by)
  - `backend/migrations.py` — Migration V23: creates `public_api_keys` table
  - `backend/main.py` — Registered `public_api_router`
  - `backend/routes/admin_routes.py` — Added `GET /api/admin/public-api-key/status` and `POST /api/admin/public-api-key/generate` and `DELETE /api/admin/public-api-key/revoke` endpoints; added missing `logging` import
  - `backend/routes/admin_upload_routes.py` — Added `_get_existing_company_sdr_in_pod()` helper; DB lookup injected before round-robin in both `upload-sheet` and `import-gsheet` routes
- **Frontend:**
  - `frontend/js/views/settings.js` — New Public API tab with key generation, revoke, copy, and status UI; fixed `localStorage` key from `alternatecrm_token` → `crm_token`
  - `frontend/js/views/user_guide.js` — New APIs section (Super Admin only) with endpoint docs

### Security

- API key stored encrypted at rest using `Fernet` symmetric encryption (`APP_ENCRYPTION_KEY`)
- Key comparison uses `hmac.compare_digest` to prevent timing attacks
- Key is only shown once at generation — not recoverable from the UI after that point

### Breaking Changes
None — Public API is additive. All existing endpoints unchanged.

---

## v4.12.0 – 20 April 2026

### New Features

- **📊 Analytics Dashboard Redesign (Super Admin):** Full redesign of the Analytics Dashboard for the Super Admin persona — unified, hierarchical, and context-aware view of all SDR activity.

  **Filter Hierarchy (strict top-to-bottom):**
  - ① POD → ② Date Range → ③ Batch → ④ Date/Time Refinement
  - Step Pills guide the user through each stage; downstream filters are visually locked and disabled until their prerequisite is selected
  - Batch filter labels follow the format: `[Source] · [Date]` (e.g. `Upload · Apr 10`, `Google Sheet · Apr 14`)
  - Breadcrumb trail anchors the current filter context persistently at the top of the page

  **Insight Bar:**
  - Rule-based status tags (e.g. `🔴 No Calls Today`, `🟡 Low Connect Rate`, `🟢 On Track`)
  - Live AI Recommendation tag — Groq-backed, non-blocking load, 2-minute client cache

  **Funnel Strip:** Horizontal `Leads → Calls → Connects → Meetings` with conversion % between each stage

  **6 KPI Metric Cards:** Leads, Research, Emails, Calls, Connect %, Disqualified

  **Trend Chart:**
  - 5 metric toggles: Calls, Meetings, Research, Disqualified, Emails
  - Scrollable SDR pills to scope the chart to a single SDR without changing global filters

  **All Batches Mode:**
  - View toggle switches the SDR table to a full-width batch comparison table
  - Shows per-batch: Leads, Calls, Connect %, Meetings, Emails — with a totals row and source icons

### Technical Details

- **Backend (`analytics_routes.py`):** Extended `/filters` to accept `pod_id`, `date_from`, `date_to` for scoped batch retrieval; extended `/trend` with `research` and `disqualified` series and `sdr_id` scoping; added `POST /ai-recommendation` (Groq-backed, 2-min server-side cache); added `/batch-summary` for All Batches comparison table
- **API (`api.js`):** Added `fetchAnalyticsAiRecommendation()`, `fetchAnalyticsBatchSummary()`, updated `fetchAnalyticsFilters()` to accept scope params
- **Frontend (`analytics.js`):** Full rewrite — skeleton-first loading, module-level state, strict filter cascade, breadcrumb, insight bar, trend chart with toggles and SDR pills, All Batches table
- **CSS (`style.css`):** ~260 lines added — step pills, breadcrumb, insight bar AI skeleton, funnel strip, 6-col KPI grid, SDR pills, metric toggles, connect % badges, batch comparison table

### Breaking Changes
None — additive-only change. All existing analytics behavior preserved when no new filters are used.

---

## v4.12.0 (patch) – 20 April 2026

### Improvements

- **🔍 Searchable SDR Picker:** Replaced the horizontal scrollable SDR pill row with a compact, search-driven picker. Includes an "All SDRs" reset button, a search input that filters the full SDR list (not just pod-scoped), and a dismissable chip showing the selected SDR.
- **📐 Chart Layout Fix:** The trend chart panel and SDR performance panel are now independently sized (`align-items: start` on the grid). Previously the chart would stretch to match the tall SDR table, creating an oversized, empty chart area.
- **🗂 SDR Panel Scroll:** The SDR performance panel is capped at `max-height: 440px` with internal `overflow-y: auto`. The table scrolls inside the panel — no more whitespace below the chart when many SDRs are shown.
- **⏩ Compact Pagination:** Replaced large "Prev / Next" buttons with compact `←` / `→` icon buttons and a `N / M` page indicator to reduce vertical footprint.

### Bug Fixes

- Fixed SDR search returning "No SDRs found" when a pod filter was active (was searching the pod-filtered list instead of `_allSdrs`).
- Fixed "All SDRs" pill toggle not deselecting after clicking it while already selected.
- Fixed Y-axis scale resetting incorrectly when switching metric toggles.
- Fixed chart canvas overflowing its container on wide viewports (added `overflow: hidden` + `min-width: 0` to panel).

### Breaking Changes
None


## v4.11.2 – 19 April 2026

### Bug Fixes

- **📊 Batch Filter Fix (Critical):** Fixed the analytics dashboard showing 0 leads and incorrect metrics when a batch is selected. Root cause: the `leads` table has no `upload_log_id` column, and the previous fallback used `lead_source == "uploaded"` which excludes the majority of leads (which use `gsheet:` or `upload:` prefixes). New approach: resolves the batch UUID to the actual `lead_source` string (e.g., `gsheet:Google Sheet:2026-04-16T10:51:38`) via filename prefix matching and applies exact-match filtering across ALL analytics endpoints
- **📈 Consistent Batch Filtering Across All Endpoints:** Extended batch filter support to `/trend`, `/sdr-table`, and `/email-breakdown` endpoints — previously only `/funnel` attempted (broken) batch filtering
- **📧 Email Breakdown Source Filter:** Fixed the email-breakdown endpoint using exact-match instead of LIKE for prefix-based source filters (google_sheet, uploaded), ensuring correct email counts when filtering by source

### Technical Details

- New helper: `_resolve_batch_lead_source(db, upload_log_id)` — resolves batch UUID → exact `lead_source` string via filename prefix + time-window matching
- Removed broken `upload_log_id` column reference in `_apply_lead_filters()`
- All 4 analytics endpoints now accept `upload_log_id` query param and apply consistent batch filtering
- When no batch is selected, ALL behavior is 100% unchanged (additive-only fix)

### Verification

- **42 passed, 5 xfailed** (unchanged test results)
- Production DB verification: Apr 16 batch correctly resolves to 842 leads, 87 calls, 1 meeting
- Cross-verified all 3 production batches resolve correctly

### Breaking Changes
None

---

## v4.11.1 – 19 April 2026

### Bug Fixes

- **📊 Source Filter Normalization:** Cleaned up lead source dropdown in Analytics. Raw import strings like `gsheet:Google Sheet:2026-03-25` are now normalized to clean labels (Google Sheet, Uploaded, Salesforce, Manual). All 7 analytics endpoints use consistent prefix-based matching via a shared `_lead_source_filter()` helper
- **👥 Pod Filter Missing:** Fixed the Pod filter not rendering for Super Admins. Root cause: the code read from a non-existent `localStorage('crm_user')` key. Now imports `isSuperAdmin` directly from `auth.js` (decoded from the JWT)
- **🔗 Pod → SDR Cascading Filter:** Added `pod_id` to SDR objects in the `/filters` API. Selecting a Pod now dynamically filters the SDR dropdown to show only SDRs in that Pod
- **☑️ Inactive SDR Detection:** Overhauled the inactive SDR logic. SDRs are now flagged as inactive if they have `NULL last_login_at` AND zero activity (no calls + no emails). Previously, the 90-day threshold was never met on staging where all SDRs had NULL login timestamps
- **📅 Meetings Count Accuracy:** Fixed meetings count showing `0` for time-filtered views. Meetings are now counted from ALL leads assigned to an SDR regardless of lead creation date, since meetings reflect historical pipeline success
- **📡 Activity Feed Placement:** Moved the "Show Activity Feed" toggle from below all content to between the SDR Performance table and the Activity Trend chart for better visibility

### Testing

- **🧪 5 New Backend Tests:** Source normalization, SDR `pod_id` inclusion, meetings count accuracy, inactive SDR flag logic, and `{value, label}` filter response structure
- **42 passed, 5 xfailed** (Postgres `date_trunc` — expected on SQLite)

### Breaking Changes
None

---

## v4.11.0 – 18 April 2026

### New Features

- **Analytics Hub:** Unified dashboard replacing the separate "SDR Metrics" and "Activity Feed" nav items.
  - **4 KPI cards:** Leads Assigned, Research Complete (with 5-field breakdown), Emails Sent, Calls Made, Connect Rate, Avg Retries, Meetings Booked
  - **Research deep-dive:** Company / Contact / Hypothesis / Personalization / Hook each shown with fill-rate bar as a current snapshot
  - **Email funnel:** Sent → Opened → Replied broken down by sequence stage (Intro, Follow-up 1, Follow-up 2, Additional)
  - **Activity trend chart:** Auto-granularity (daily ≤14d / weekly ≤90d / monthly), stacked Chart.js line chart
  - **SDR performance table:** Sortable, paginated, optional inactive-SDR toggle; per-row calls, connect rate, emails, meetings
  - **Shared filter bar:** Period presets (7D / 30D / 90D / All) + custom date range + Pod (Super Admin only) + Lead Source + Upload Batch; all filters persist state via URL-safe state in memory
  - **CSV export:** Streaming download via authenticated fetch blob — no token-in-URL exposure
  - **Async skeleton-first loading:** All 4 sections load independently and simultaneously; no section blocks another; skeleton shimmer renders in <5ms
  - **Server-side TTL cache (2 min):** Near-instant warm loads for high-volume datasets; invalidated on filter change
  - **Access control:** Pod Admins auto-scoped server-side; Super Admins have full cross-pod visibility
  - **Edge-case safety:** Division-by-zero via `NULLIF`, NULL call outcomes excluded from connect-rate denominator, legacy outcome normalisation at query time

### Internal / Backend

- `backend/routes/analytics_routes.py` — 6 endpoints: `/funnel`, `/trend`, `/sdr-table`, `/email-breakdown`, `/filters`, `/export`
- `frontend/js/views/analytics.js` — new async analytics view
- `frontend/js/api.js` — 6 new export functions for Analytics Hub
- `frontend/css/style.css` — analytics component styles added
- `frontend/index.html` — new `analytics-nav-item` (visible to all Admins)
- `frontend/js/app.js` — analytics route registered; old `metrics` / `activity-feed` routes redirect to `analytics`
- `backend/main.py` — analytics router registered

### Removed

- "SDR Metrics" and "Activity Feed" sidebar items hidden; both routes redirect to the unified Analytics hub

---

## v4.10.3 – 16 April 2026 (Security Hotfix)


### Bug Fixes

- **🔒 Dashboard Priority Queue — Phone Masking (Hotfix):** Fixed a data-leakage bug where SDRs could see full phone numbers in the Dashboard Priority Queue before completing research. The `dashboard.js` render path was missing the `research_complete` gate that already existed in `lead_list.js`. SDRs now see a **🔒 Hidden** badge until research is complete. The **Call** button is also blocked for masked leads to prevent the number leaking via `data-phone`. Admins are unaffected.

### Breaking Changes
None

---

## v4.10.2 – 16 April 2026

### Improvements (Internal Architecture)

- **🏗️ Admin Route Modularization (Phase 2):** Split the monolithic `admin_routes.py` into focused sub-modules:
  - `admin_user_routes.py` — user management and access control
  - `admin_assignment_routes.py` — lead assignment and bulk operations
  - `admin_upload_routes.py` — lead import, preview, and log management
  - `_admin_helpers.py` — shared utilities (lead caps, sync settings, email validation)
  - `admin_routes.py` retained as a backward-compatible thin shim/coordinator
- **🧩 Circular Dependency Elimination:** Extracted shared logic into `_admin_helpers.py` to decouple modules and prevent import cycles
- **📧 Email Sanitizer Fix:** `email_utils.py` signature stripping now correctly handles `Best regards,` and `--` patterns. Default `max_len` set to 200

### Breaking Changes
None — existing imports continue to work via the shim

---

## v4.10.1 – 16 April 2026

### Testing

- **🧪 Test Suite Stabilization (448 passing, 2 xpassed):** Resolved all failing tests following the Phase 2 modularization:
  - `TestSanitizePreview` — updated assertions to match new signature-stripping and `max_len=200` defaults
  - `TestSyncThreadMessages` — fixed `ValueError` by ensuring `JWT_SECRET` is set at the module level in test files
  - Full 448-test suite green; no regressions

### Breaking Changes
None

---

## v4.10.0 – 16 April 2026

### New Features

- **📂 Batch Tracker in Upload Center (Admin Only):** Moved the Upload Batch Tracker out of the Activity Feed and into a dedicated **"📂 Batch Tracker"** tab inside the Upload Center for a cleaner, more intuitive workflow:
  - **Summary stat cards** — Total Batches, Total Leads in DB, Meetings Scheduled, Overall Conversion %
  - **Date range filter** — All Time / Today / Last 7 Days / Last 30 Days / This Quarter
  - **POD filter** — Scopes all metrics and lead counts to a selected POD
  - **Expandable batch cards** — Visual status bar (five statuses), legend, avg calls/lead, deleted-leads warning
  - **Per-lead drill-down** — Click any batch card to lazy-load a paginated table (50/page) showing every lead: name, company, status, assigned SDR, call count, last call outcome, and research completion flag
  - **Lead navigation** — Click a lead name to go directly to that lead's detail page
  - **GSheet & CSV batches** — Both import types appear correctly with their respective icons and type labels
  - **Legacy batch support** — Leads uploaded before batch tracking was introduced are grouped under "Legacy / Pre-tracked Uploads"

### Bug Fixes

- **🔗 Lead Link Fix in Batch Tracker:** Lead name links in the drill-down table now correctly navigate to the lead detail page using `window._navigateToDetail()`. The previous implementation dispatched a custom DOM event that was never consumed, causing clicks to silently fail.

### Improvements

- **🧹 Activity Feed Cleanup:** Removed ~485 lines of now-dead Upload Batch Tracker code from `activity_feed.js` (the code was moved to `upload.js` in the batch above). The Activity Feed tab is now exclusively focused on real-time call/email/status/research events.

### API Changes

- **`GET /api/admin/leads/upload-batch-metrics`** — Existing endpoint. Now exclusively consumed by Upload Center. Accepts `date_range` and `pod_id` query params.
- **`GET /api/admin/leads/upload-batch-metrics/{log_id}/leads`** — Existing endpoint. Accepts `pod_id`, `page`, `per_page`. Returns paginated per-lead drill-down for a specific batch (or `"legacy"` sentinel for pre-tracked uploads).

### Breaking Changes
None

---

## v4.9.0 – 13 April 2026

### New Features

- **🔒 Research-First Workflow:** Enforced a mandatory research-first workflow for SDRs. The `Phone` and `Secondary Phone` fields are now masked and hidden behind a "Hidden (Complete Research)" badge until all 11 research fields are filled.
- **🤖 AI Research Auto-Trigger:** Clicking any of the research accordions (`Company Basics`, `Call Strategy`, or `Customer Engagement`) automatically triggers the AI Research generation, provided no research has been started yet.
- **🎯 Auto-Expanded Call Strategy:** As soon as a lead is moved to the `Calling` status, the Call Strategy accordion automatically expands, making the Hook and Pitch Angle immediately visible for faster dialing context.

### Breaking Changes
None

---

## v4.8.2 – 13 April 2026

### Bug Fixes

- **📞 Aircall Empty Response Crash (Hotfix):** Fixed a production issue where the Aircall dialer integration would crash (`JSONDecodeError`) when the API returned an HTTP success code but an empty response body. Call initiation now handles empty responses gracefully and logs specific endpoint data for troubleshooting instead of failing silently.

### Breaking Changes
None

---

## v4.8.1 – 10 April 2026

### New Features

- **📵 No-Phone Disqualification:** Leads without phone numbers can now be disqualified directly using the "No Phone Number" reason — no call logging required. A yellow info banner appears on no-phone leads to guide users.
- **🗑️ Direct Lead Deletion:** Admin-only "Delete Lead" button on the lead detail page with confirmation modal — no need to navigate to the Assignments tab for single-lead deletion.
- **👤 SDR Filter for All Leads tab:** Admins can now filter leads by assigned SDR on the All Leads page. Date filters auto-clear when an SDR is selected to ensure all their leads are visible.

### Bug Fixes

- **🔧 Assignments SDR Filter:** Fixed the SDR filter on the Assignments tab not filtering results. Root cause: duplicate `id="sdr-filter"` across the All Leads and Assignments tabs caused `getElementById` to always target the wrong (hidden) element. Renamed to unique ID.
- **🔧 SDR Filter Date Collision:** Fixed SDR filter showing zero results when the default 6-month date range excluded older leads. Dates now auto-clear on both SDR selection and page reload with a persisted SDR filter.

### Breaking Changes
None

---

## v4.8.0 – 10 April 2026

### New Features

- **📡 Unified Activity Feed (Admin Only):** A centralized, real-time dashboard that aggregates all SDR interactions — calls, emails, status changes, and research — into a single filterable, paginated view for leadership:
  - **📊 Stats Cards:** Total Activities, Meetings Booked, Call Connect Rate, and Email count at the top
  - **🎯 Call Strategy View:** Expanded call detail shows personalization angle, research hypothesis, call notes, recording player, and transcript
  - **📧 Structured Email Section:** Email details display subject, direction, body preview, and open tracking stats in a professional grid layout
  - **📝 Notes / Summary Column:** Replaced "Research Hook" with an intelligent preview showing call notes, email subjects, or status transitions
  - **🔍 Cross-Time Search:** When searching by lead or company, date filters are automatically bypassed to search across all time
  - **🧹 Activity Deduplication:** Shows only the latest activity per lead per type — 5 calls to the same lead produce only 1 row
  - **🎙️ Recording & Transcript Access:** Call recordings and transcripts surfaced directly in the expanded detail panel
  - **📥 CSV Export:** Download all filtered activities as a spreadsheet with Call Strategy column
  - **🔒 Access Control:** Super Admins see all; Pod Admins see only their POD's SDRs; SDRs have no access

### API Changes

- **`GET /api/admin/activity-feed`** — New endpoint. Accepts `page`, `per_page`, `type`, `sdr`, `pod_id`, `outcome`, `date_range`, `search` query params. Returns paginated activity data with stats. Auth: `require_admin`.

### DB Changes
None — uses existing tables (CallLog, DialerCall, LeadEmailActivity, LeadStatusLog, Lead).

### Breaking Changes
None

---

## v4.7.0 – 9 April 2026

### New Features

- **⬇️ Lead Deprioritization (Post-Call Priority Queue):** SDR leads are now automatically deprioritized after calls are logged, keeping the My Leads table focused on fresh, unworked contacts:
  - **🔴 High** (score ≥ 75): Default. Fresh leads, never called today.
  - **🟡 Medium** (score 40–74): Lead was called once today. Amber "Called Today" badge shown.
  - **⬇️ Deprioritized** (score < 40): Lead was called 2+ times today. Row visually muted. "Deprioritized" badge shown.
  - My Leads table is ordered **priority_score DESC** first, so High leads always surface above Medium and Deprioritized ones.
  - **Re-prioritization is manual**: An **↑ Re-prioritize** button appears on Medium and Deprioritized rows. Clicking it resets the lead to High priority (score 100) and immediately refreshes the table.
  - An amber info banner at the top of My Leads explains the scoring logic to SDRs.
  - Admins are **not affected** — no priority badges appear in the All Leads view.

### API Changes

- **`PATCH /api/leads/{lead_id}/priority`** — New endpoint. Accepts `{ priority_score: 0–100 }`. Used by the Re-prioritize button to restore a lead to High (100). Auth-protected; follows same lead-access rules as other PATCH endpoints.
- **`GET /api/leads/my` response** — Now includes `priority_score` field on each lead summary.

### DB Changes

- **`leads.priority_score`** — New `INTEGER NOT NULL DEFAULT 100` column on the `leads` table. Added in migration V22. Existing leads receive `priority_score = 100` (High) on migration.

### Breaking Changes
None

---

## v4.6.2 – 8 April 2026

### Bug Fixes
- **🔍 Call Back Later Filter (Regression Fix):** Fixed critical data-integrity bug where leads with a *historical* "Call Back Later" call outcome were incorrectly surfacing in the filter, even if their *most recent* call had a different outcome (e.g. "Meeting Confirmed"). Root cause: the `_apply_filters` UNION subquery matched any historical call. Now uses a `ROW_NUMBER()` window function ranked subquery — only the **most recent call per lead** (across both `call_logs` and `dialer_calls`) is evaluated against the requested outcome filter
- **🕐 Task Time Picker Missing:** Fixed task creation form which was missing a time input field. SDRs can now set both a due date **and** a due time when creating a task on a lead

### Improvements
- **🛡️ Task Creation Error Handling:** The "Add Task" button now shows a loading state and restores itself on API failure, preventing silent crashes and ghost task UI entries. A toast notification is shown if the API call fails
- **🔗 API Update:** `addLeadTask()` now accepts and forwards an optional `due_time` parameter to the backend

### Testing
- **🧪 +4 Backend Regression Tests** in `test_outcome_filter.py`:
  - `test_historical_outcome_does_not_match_filter` — the Amy Miller regression case
  - `test_most_recent_dialer_call_overrides_older_call_log` — DialerCall ordering
  - `test_no_calls_lead_excluded_from_all_outcome_filters` — zero-call exclusion
  - `test_meeting_confirmed_filter_correct_after_escalation` — escalation correctness
- **🧪 16 Playwright E2E Tests** in `tests/task-and-outcome-filter.spec.js` covering outcome filter precision, task CRUD, time picker, error toast, snooze/dismiss state, and sessionStorage filter persistence

### Breaking Changes
None

---

## v4.6.1 – 8 April 2026

### Bug Fixes
- **🔍 Dialer Outcome Filter:** Fixed critical bug where leads contacted via Aircall or Alternate Messenger dialer were silently excluded from outcome-based filters (e.g. clicking "Call Back Later" on the dashboard). Root cause: `_apply_filters` only queried the `call_logs` table. Now uses a `UNION` of both `call_logs` and `dialer_calls` tables, so all leads with a matching outcome appear regardless of which dialer was used
- **🔔 Task Notification Stability:** Fixed "ghost task" bug where snooze and dismiss buttons removed a task from the notification panel even when the API request failed (e.g. network drop). UI now only updates after a confirmed server response. On failure, the button re-enables with an error tooltip so the SDR can retry

### Testing
- **🧪 43 New Tests:** Comprehensive test coverage for task lifecycle and outcome filtering:
  - `test_task_routes.py` — 33 tests: task CRUD, pending task polling, snooze (5/15/30/60 min + clamping to 15 for invalid values), dismiss, and SDR ownership enforcement
  - `test_outcome_filter.py` — 10 tests: CallLog outcome filter, DialerCall-only filter regression test, UNION de-duplication, `/my` endpoint outcome filter, empty result, XSS escaping in `_lead_to_summary`

### Breaking Changes
None

---

## v4.6.0 – 8 April 2026

### New Features

- **🔔 Task Notification Bell:** A persistent bell icon in the SDR top bar surfaces task reminders in real time. Tasks appear in the panel when their due date **and** due time have been reached. Tasks without a due time are excluded from the notification system — time-based precision is intentional
- **📊 30-Second Background Polling:** The frontend polls `GET /api/my/tasks/pending` every 30 seconds. The endpoint returns all due, non-done, non-dismissed tasks for the authenticated user, respecting snooze windows server-side. Results are capped at 50 tasks per poll to prevent payload bloat
- **🌐 Browser Push Notifications:** On the first due task detected, the browser's Notification permission prompt is triggered. If granted, a native OS-level push notification fires with the count of pending tasks — works even when Alternate CRM is not the active tab. Uses `tag: "task-reminder"` to collapse repeated alerts into a single notification
- **🔔 In-App Chime:** A soft two-tone audio chime (Web Audio API oscillator) plays whenever the pending task count increases since the last poll. Operates independently of browser push permission
- **⏰ Snooze (15m / 1h):** Each notification item has two snooze buttons. The action calls `PATCH /api/my/tasks/{id}/snooze` with `{ minutes }`. The backend sets `snoozed_until` and the task is excluded from poll results until that timestamp passes. Invalid minute values are clamped to 15
- **✕ Dismiss:** Permanently removes a task from the notification panel by setting `dismissed = true` via `PATCH /api/my/tasks/{id}/dismiss`. The underlying task record on the lead is preserved — dismiss only silences the reminder
- **🔗 Open Lead shortcut:** Each notification item has an **Open Lead** button that closes the panel and navigates directly to the lead's detail page without any extra clicks

### Backend

- `GET /api/my/tasks/pending` — returns due, undismissed, unsnooze-expired tasks for the current user with lead name and company joined
- `PATCH /api/my/tasks/{id}/snooze` — sets `snoozed_until` offset by N minutes (allowed: 5, 15, 30, 60; clamped to 15 for invalid values)
- `PATCH /api/my/tasks/{id}/dismiss` — sets `dismissed = true`; task remains in DB

### Database

- **V21:** Added `dismissed` (string, default `"false"`) and `snoozed_until` (timestamp, nullable) columns to `tasks` table

### Scope

- Notification bell is **SDR-only** — admins are excluded at init time
- All snooze/dismiss actions are user-scoped — SDRs cannot affect each other's notifications

### Breaking Changes
None

---

## v4.5.0 – 7 April 2026

### New Features
- **🆕 Universal Lead Creation:** The "+ New Lead" button is now visible and functional for **all user roles** (SDR, Pod Admin, Super Admin). Previously limited to admins only
- **📝 Expanded Lead Form:** The creation form now includes: First Name, Last Name, Company, Title/Role, Phone, Secondary Phone, Email, LinkedIn URL, and Initial Status — organized in a clean two-column grid layout
- **🔗 Auto-Assign to Creator:** Newly created leads are automatically assigned to the creating user, so they appear immediately in "My Leads". Designed for the mid-call referral use case where an SDR gets a new contact during a conversation
- **🏢 Pod Scoping:** Leads created by SDRs automatically inherit the creator's Pod assignment for proper team scoping

### Security
- **🔒 Backend Auth Guard:** Added authentication requirement (`get_current_user`) to the `POST /api/leads` endpoint. Initial status is restricted to "Lead Assigned" or "Research" only to prevent data integrity issues

### Improvements
- **✅ Client-Side Validation:** Last Name and Company are required. Email format is validated. Toast notifications replace raw `alert()` dialogs
- **📊 Audit Trail:** Every manually created lead gets a `CREATE_LEAD` activity log entry and an initial status change record for full traceability

### Breaking Changes
None

---

## v4.4.1 – 7 April 2026

### Improvements
- **📐 Sidebar Toggle Relocated:** Moved the sidebar collapse/expand button from the bottom of the sidebar to a floating circular button at the top edge. The button now sits outside the sidebar container, on the boundary between the sidebar and main content area. Uses a subtle `‹`/`›` chevron with a white circle and drop shadow for a cleaner, more modern appearance

### Breaking Changes
None

---

## v4.4.0 – 7 April 2026

### New Features
- **📐 Collapsible Sidebar:** Toggle between a full 260px expanded sidebar (with labels) and a compact 72px icon-only mode. State persists via localStorage across sessions. Hover tooltips show navigation labels in collapsed mode. Works for all user roles and on mobile
- **📧 Email Origin Tagging:** All outbound emails sent via Alternate CRM now include a subtle footer — "Alternate CRM · Powered by Alternate Messenger" (9px, light gray) — plus an invisible `X-Mailer: Alternate CRM CRM / Alternate Messenger` header for programmatic tracking

### Bug Fixes
- **✉️ Email Formatting Preserved:** Emails typed with line breaks and paragraphs are now delivered with formatting intact. Plain-text body is converted to HTML (`\n` → `<br>`) before sending via Nylas — previously, all line breaks were collapsed into a single paragraph by email clients

### Improvements
- **🎨 Sidebar Scrollbar Hidden:** Removed visible scrollbar from sidebar navigation for a cleaner look (Firefox, Chrome, Safari, Edge)

### Breaking Changes
None

---

## v4.3.3 – 6 April 2026

### Bug Fixes
- **📊 SDR Metrics — Non-SDR Users Excluded:** SDR Metrics dashboard (KPIs, daily trends, per-SDR table, and CSV/XLSX export) now only includes users with the SDR role — Super Admins and Pod Admins are no longer counted in metrics, preventing inflated activity numbers
- **✉️ Email Connect Redirect Fix:** After connecting email via Nylas OAuth, SDRs are now correctly redirected to My Settings (`#my-settings`) instead of the admin Settings page (`#settings`) which caused a blank page
- **🔔 Email Connect Toast:** Success confirmation toast ("Email connected successfully!") now appears for both SDRs and admins after OAuth redirect — previously it was not visible due to the wrong route

### Breaking Changes
None

---

## v4.3.2 – 6 April 2026 (Hotfix)

### Bug Fixes
- **📧 Email Body Truncation:** Fixed emails being cut off at ~200 characters — the `_sanitize_preview()` function had a 500-character hard limit and an aggressive signature-stripping regex that was removing valid email content. Full email bodies (including sender name, company, and phone number) are now preserved
- **👁️ Open Count Inflation:** Fixed email open counts being inflated by the sender's own views — when an SDR viewed their sent email in Gmail's Sent folder, the tracking pixel fired and incremented the count. The webhook now skips the first open event for outbound emails (sender heuristic)
- **✂️ Signature Preservation:** Removed signature stripping from the email sanitizer — sign-offs like "Best, Aman" were being incorrectly removed, losing the sender's contact information
- **🔑 Multi-Grant Email Repair:** Fixed the startup email repair to try all connected Nylas mailbox grants (not just the first one) — emails sent by different SDRs are stored under different grants
- **🐛 Regex Syntax Error:** Fixed `re.error: unterminated character set` on production — the pattern `[^]*?` is valid in JavaScript but invalid in Python. Replaced with `[\s\S]*?`

### Data Fixes Applied
- Reset all inflated open counts to 0 — existing data was unreliable due to sender open tracking
- Re-fetched and re-processed all email bodies from Nylas API to restore truncated content

### Technical Details
- **Risk Score:** 0.75 (high) — changes scoped to email module only
- **Affected Flows:** 14 (email send, sync, webhook, repair, attachment download)
- **No impact on:** Salesforce sync, lead assignment, authentication, dialer

### Breaking Changes
None

---

## v4.3.0 – 6 April 2026

### New Features
- **✉️ Email UI Redesign:** Replaced gradient chat bubbles with a professional, enterprise-grade flat card layout — outbound emails have an amber left border, inbound emails have a blue left border
- **📎 Attachment Support:** Email cards now display attachment chips with download links — click to download directly from the email view
- **🔄 Auto-Refresh Tabs:** Email and Calls tabs auto-refresh content when switching between them, ensuring data is always current

### Improvements
- **📏 Smart Card Sizing:** Email cards use `min-width` and `fit-content` for responsive sizing — short emails no longer stretch to full width
- **🎨 Visual Consistency:** Unified email card styling with consistent padding, typography, and spacing across all email types

### Bug Fixes
- **📐 Short Content Fix:** Fixed email cards for brief messages (e.g., "Hi") expanding to full container width instead of fitting content
- **💬 Bubble Sizing Fix (V21):** Fixed email bubble sizing issues from the previous gradient-based design

### Breaking Changes
None

---

## v4.2.0 – 2 April 2026

### New Features
- **💬 Conversations Tab:** New lead detail tab that loads the Alternate Messenger messaging component, enabling SDRs to message leads directly from Alternate CRM. Includes per-SDR `messenger_user_id` tagging, phone fallback (uses secondary phone when primary is missing), and graceful error handling when the service is unavailable
- **📧 Email Open Tracking:** Outbound emails now include Nylas tracking pixels. When a recipient opens an email, Alternate CRM records the first open timestamp and total open count. The Email tab shows a green "Opened" badge with view count and first-opened time, or a gray "Sent" badge for unread emails
- **👁️ Per-SDR Conversations Identity:** Each SDR can be assigned a unique `messenger_user_id` in the Admin panel, linking their Alternate CRM identity to the Conversations system for proper message attribution

### Improvements
- **📱 Phone Fallback:** Conversations tab uses `phone_secondary` when `phone` is missing, ensuring more leads can be messaged
- **🔒 Webhook Resilience:** The `message.opened` webhook handler gracefully handles unknown messages, empty payloads, missing fields, and rapid-fire duplicate events without crashing

### Database Migrations
- **V19:** Added `messenger_user_id` column to `users` table
- **V20:** Added `opened_at` (timestamp) and `open_count` (integer) columns to `lead_email_activity` table

### Breaking Changes
None

---

## v4.1.1 – 1 April 2026

### Improvements
- **🔒 Security Hardening:** Internal security improvements for production readiness — logging cleanup, authentication defaults tightened, credential handling improved
- **🔧 My Settings Navigation:** "My Settings" now only appears for SDR and Pod Admin users — Super Admins use the full Settings page instead

### Bug Fixes
- **🗑️ Lead Delete Fix:** Fixed bulk delete failing for leads with email activity or dialer call records (NotNullViolation on lead_email_activity)

### Breaking Changes
None

---

## v4.1.0 – 1 April 2026

### New Features
- **🏢 Company-Level Call Resolution:** When any lead at a company has a successful meeting outcome (Meeting Scheduled / Meeting Confirmed), all other leads at that company are flagged with a "Company Connected" indicator. This prevents redundant outreach to contacts at companies where a meeting is already booked
  - **Lead List:** "✅ Company Connected" badge in company group headers and subtle hint on individual lead rows
  - **Lead Detail:** Amber "Company Already Connected" banner with the name of the resolved contact
  - **Call Modal:** Warning banner when initiating a call to a lead at a resolved company
  - **Matching Logic:** Case-insensitive, whitespace-trimmed company name matching with database-level index for performance
  - **Batch Processing:** List views use optimized batch resolution to prevent N+1 query issues

### Bug Fixes
- **📊 SDR Metrics Meeting Count Fix:** Fixed critical discrepancy where SDR Metrics showed only 2 meetings instead of the actual 7. Root cause: the `SCHEDULE_MEETING` activity log event was only emitted from the UI status-change path, not from the call outcome auto-transition path (Meeting Confirmed → Meeting Scheduled). Now both paths emit the event correctly
- **📊 Historical Data Backfill:** Backfilled 5 missing `SCHEDULE_MEETING` activity events in production to correct historical SDR Metrics data

### Improvements
- **🧪 26 New Tests:** Comprehensive E2E test suite covering company resolution detection, batch processing, API integration, activity log emission, leaderboard accuracy, and edge cases (whitespace normalization, null companies, multiple meetings, case-insensitive matching)
- **📇 Database Index:** Added `LOWER(company)` index on leads table for optimized company-level queries

### Breaking Changes
None

---

## v4.0.2 – 31 March 2026

### Bug Fixes
- **📞 Aircall User Matching Fix:** Fixed critical pagination bug where only 50 of 92 Aircall users were fetched — users on page 2+ (including active SDRs) could not initiate calls from Alternate CRM. Root cause: Aircall API returns `total` and `per_page` in meta, not `total_pages`; code defaulted to 1 page
- **📋 Duplicate Call Entries Fix:** When an SDR logged a call outcome after an Aircall call, two separate entries were created (one manual, one Aircall). Now the outcome and notes are attached to the existing Aircall record — single unified entry with both call data (duration, recording, transcript) and SDR-logged outcome

### Improvements
- **📞 Meeting Scheduled Outcome Behavior:** "Meeting Scheduled" call outcome no longer auto-transitions the lead status. Lead stays in "Calling" for tentative bookings. Only "Meeting Scheduled (Confirmed)" transitions the lead to Meeting Scheduled status, triggers Salesforce sync, and initiates AE hand-off

### Breaking Changes
None

---

## v4.0.1 – 31 March 2026

### Bug Fixes
- **📊 Metrics Dashboard Fix:** Fixed production metrics showing zeros for active SDRs, leads, and meetings. Root cause: stale login-only rows in `user_activity_daily_summary` prevented fallback to real-time activity data
- **📈 Leads Processed Accuracy:** Changed leads processed calculation to count actual lead work (status updates + calls logged) instead of view events which were not being tracked
- **👤 User Activity Status Fix:** Activity badges (Active/Idle/Inactive) now use real heartbeat and interaction data instead of OAuth login timestamps — prevents silent Google SSO re-auth from inflating activity status
- **🧹 Stale Session Cleanup:** Sessions without a heartbeat for >30 minutes are now auto-closed, eliminating zombie sessions that accumulated when users closed their browser tab without logging out

### Improvements
- **✉️ Email Connect UX:** After connecting email via Nylas OAuth, users are now redirected back to the Settings page (instead of Leads) with a success toast notification confirming the connection
- **🔗 Same-Tab OAuth:** Email connect now navigates in the same browser tab instead of opening a popup, ensuring the callback redirect lands correctly

### Breaking Changes
None

---

## v4.0.0 – 30 March 2026

### Architecture Overhaul
- **⚡ Email Sync Rewrite (502 Fix):** Rewrote email sync from `async` to fully synchronous — eliminated session corruption caused by mixing async HTTP calls with sync SQLAlchemy. Emails now return instantly from cache while Nylas syncs in a background task with its own isolated DB session
- **🚀 Webhook Performance (503 Fix):** Replaced O(N) in-memory lead table scan with O(1) SQL-indexed phone lookup — webhook response time dropped from ~5s to <50ms, eliminating Aircall timeout cascades
- **🔄 Background Task Architecture:** Email sync now runs via FastAPI `BackgroundTasks` with dedicated DB sessions — request thread returns immediately, sync runs asynchronously without blocking the UI

### Improvements
- **📱 Phone Format Matching:** SQL-level candidate generation handles E.164 (+918552628000), digits-only (8552628000), dashes (+91-855-262-8000), and spaces (+91 85526 28000) — all matched via indexed query, not Python loops
- **✉️ Email Preview Cleanup:** Quoted text, forwarded messages, and signatures stripped from email previews using pattern-matched regex (On Date wrote, Forwarded message, Original Message, >, Best regards, --)
- **♿ Accessibility Fix:** Replaced invalid `<label for=FORM_ELEMENT>` wrappers with `<div role="button">` on email compose toggles

### Testing
- **🧪 40 New Root Cause Tests:** Dedicated test suite (`test_root_cause_fixes.py`) covering sanitize preview, sync function behavior, SQL phone matching, background task isolation, and webhook resilience
- **🧪 Total Test Coverage:** 237 tests across 13 test files — all passing

### Breaking Changes
None — all changes are backward compatible. Existing data and APIs unchanged.

---

## v3.10.0 – 27 March 2026

### New Features
- **📞 Aircall Dialer Integration:** Full click-to-call dialer integration with Aircall — one-click calling from lead detail, automatic call tracking, and call recording capture
- **🎙️ Call Recording Playback:** Embedded audio player on call cards — listen to recordings and download them directly from the lead's Calls tab
- **📄 Transcript Support:** Call transcripts display inline with expandable sections (requires Aircall transcription plan)
- **📊 Unified Calls Tab:** Merged manual call logs and Aircall dialer calls into a single, sorted Calls tab with stats (Total Calls, Connected, Avg Duration, Last Called)
- **✉️ Email Tab:** Emails moved to a dedicated tab alongside Overview and Calls — threaded view with quoted text stripping
- **⚙️ Dialer Configuration:** Super Admins can configure Aircall API credentials and select phone numbers in Settings → Dialer tab

### Improvements
- **🔒 Auto-Call Tracking:** When Aircall is enabled, calls are tracked automatically — manual call logging is disabled to prevent duplicates
- **📱 Phone Format Normalization:** Phone matching handles all formats (spaces, dashes, parentheses) using digits-only comparison
- **🔄 On-Demand Enrichment:** Calls with missing data (duration=0, no recording) are enriched from Aircall's API when viewed
- **⚡ Cache-Busting:** Frontend JS includes version parameter for reliable deployments

### Bug Fixes
- Fixed race condition where dialer config wasn't loaded when clicking the call button
- Fixed manual call modal appearing after dialer call initiation (even on error)
- Fixed orphaned Aircall records not linked to leads (phone format mismatch)
- Fixed FAILED initiation records showing as 0s ghost entries in the calls list
- Fixed email preview showing raw quoted/forwarded text

### Breaking Changes
None

---

## v3.9.2 – 27 March 2026

### New Features
- **🏢 Company Filter:** Added a company dropdown filter to All Leads / My Leads page — SDRs can filter leads by hospital/company to view all personas at once without switching pages
- **📌 Pagination Persistence:** Leads page now remembers current page, search query, and active filters when navigating to a lead detail and back — no more jumping back to page 1

### Improvements
- **📱 Phone Fallback:** Phone column now shows secondary phone number when primary phone is missing — "No Phone" only appears when both fields are empty (applies to leads table + dashboard Recent Leads)
- **🎨 Filter Bar Layout:** Restructured All Leads header — title pinned left, all filter controls (search, company, status, source, dates) in a single inline row that wraps cleanly
- **🏆 Leaderboard Cleanup:** SDRs without a POD assignment no longer show a stray "—" dash under their name

### Bug Fixes
- **📞 Secondary Phone Upload:** Fixed bug where `phone_secondary` was extracted from CSV mapping but never saved to the database — affected both file upload and Google Sheets import
- **🗺️ COLUMN_MAP Auto-Detect:** Added auto-detection for secondary phone column headers: "secondary phone", "other phone", "alternate phone", "home phone", "personal phone"

### Breaking Changes
None

---

## v3.9.1 – 27 March 2026

### New Features
- **👤 Auto-Assign SDR on Upload:** Upload Center now includes an "Assign to SDR" dropdown (File Upload + Google Sheets tabs). Select an SDR or Pod Admin to automatically assign all newly created leads during import. Default: No assignment (unassigned)

### Bug Fixes
- **⏱️ Time Spent Fix:** SDR Metrics "Time Spent" values now use activity-based heartbeats instead of raw login-logout duration — eliminates inflated idle-time metrics
- **✉️ Email Validation in Upload:** Company names in the Email column (e.g., "Vasan Eye Care") are no longer treated as email addresses for duplicate detection — was causing 70%+ false-positive skips
- **🔧 SDR Dropdown Filter:** Upload Center "Assign to SDR" dropdown now shows only SDR and Pod Admin roles (Super Admins excluded)

### Breaking Changes
None

---

## v3.9.0 – 26 March 2026

### New Features
- **🤖 AI Research Auto-Fill:** One-click AI-powered lead research using Groq LLM (Llama 3.3 70B). Populates 10+ research fields automatically with company-level caching to avoid redundant API calls
- **🏢 Company Grouping:** Leads table now groups leads by company with visual headers showing company name and lead count — SDRs can see all contacts from the same company at a glance
- **📵 No-Phone Highlighting:** Leads without phone numbers are visually highlighted (yellow row + red badge) so SDRs are not penalized for not calling them
- **📝 Notes Preview:** Latest note from each lead is shown directly in the leads table (content snippet, author, timestamp) — no need to click into each lead
- **⚙️ AI Settings (Admin):** Super Admins can configure LLM provider, API key, and model from the Settings page

### Improvements
- **🔄 Keep-Alive Ping:** Server now self-pings every 10 minutes to prevent Render free-tier cold starts
- **✨ Cold Start Overlay:** Friendly "Alternate CRM is waking up" overlay with auto-retry when server is starting (replaces raw 503 error)
- **🔒 XSS Prevention:** Note content is HTML-escaped server-side before rendering
- **🔍 Case-Insensitive Grouping:** Company groups are case-insensitive ("Acme" and "acme" merge together)
- **📱 Safari Compatibility:** Cold-start health check now works on Safari <16.4

### Bug Fixes
- Fixed empty-string phone ("" or whitespace) not being detected as no-phone
- Fixed potential row duplication in paginated leads with notes (switched to subqueryload)

### Breaking Changes
None

---

## v3.8.1 – 26 March 2026

### Bug Fixes
- **✉️ Email Name Display:** Inbound email replies in lead detail now show the lead's name instead of their email address
- **👤 Duplicate Name Cleanup:** Added admin endpoint to fix leads where full name was incorrectly imported into both `first_name` and `last_name` (e.g., "Arthur Lao Arthur Lao" → "Arthur Lao")
- **📊 SDR Metrics — Chart Stacking:** Fixed "No data yet" messages stacking up when switching date range filters
- **📊 SDR Metrics — KPI Accuracy:** Meetings Scheduled KPI now correctly counts from activity logs instead of always showing 0
- **📊 SDR Metrics — Per-SDR Table:** Added real-time data fallback so the Per-SDR Performance table shows data even before daily aggregation runs
- **📊 SDR Metrics — Daily Trend:** Charts now fall back to raw activity logs when no pre-aggregated daily summaries exist

### Improvements
- All three SDR Metrics endpoints (`/summary`, `/daily-trend`, `/sdr-table`) now consistently fall back to aggregating from raw `UserActivityLog` and `LoginLog` tables when `UserActivityDailySummary` is empty

### Breaking Changes
None

---

## v3.8.0 – 25 March 2026

### New Features
- **📞 Secondary Phone Field:** New editable "Secondary Phone" on lead detail page — auto-populated from sheet imports when multiple phone columns exist
- **🔗 LinkedIn Profile Link:** Clickable "View Profile" link on the lead detail Contact Information card
- **🏢 Company-Based Round Robin:** Auto-assign groups all contacts from the same company to a single SDR (both `pod_routes.py` and `admin_routes.py` endpoints)
- **✉️ Nylas Email Integration:** Full OAuth flow, email sending, activity logging, and HMAC-SHA256 webhook listener for inbound email tracking

### Improvements
- **📱 Broadened Phone Mapping:** Upload now recognizes 20+ phone column variants (e.g., "Enriched Mobile Phone", "Direct Phone", "Contact Number")
- **⚡ Assignments Tab Performance:** 5-10x faster load — cached per-lead settings query (1 DB hit instead of 400+) and added eager loading for relationships

### Bug Fixes
- Fixed company contacts being split across multiple SDRs during round-robin assignment (second endpoint in `admin_routes.py` was missing company grouping)
- Fixed timezone drift in `timeInStatus` metrics (5.5-hour offset on UTC timestamps)

### Breaking Changes
None

---

## v3.7.0 – 24 March 2026

### New Features
- **🔍 SDR Filter on Assignments:** Filter both Unassigned and Assigned leads tables by a specific SDR
- **📦 Bulk Unassign:** Select multiple assigned leads and unassign them in one click (Pod Admin + Super Admin)
- **🗑️ Bulk Delete:** Permanently delete selected leads with all associated data — Super Admin only
- **✅ Floating Action Bar:** Context-aware bulk action toolbar that appears when leads are selected, with Assign, Unassign, and Delete options

### Improvements
- **Lead Assigned Filter Fix:** Status filter for "Lead Assigned" now correctly shows matching leads
- **E2E Test Suite Expansion:** Expanded from 35 to 48 end-to-end tests covering Upload Center, Audit Logs, SDR Metrics, Assignments, and role-based nav restrictions

### Bug Fixes
- Fixed "Lead Assigned" status filter incorrectly hiding leads without assignees
- Fixed `ImportError` in pod routes (stale `MAX_ACTIVE_LEADS` constant)

### Breaking Changes
None

---

## v3.6.0 – 23 March 2026

### New Features
- **🚀 Alternate CRM Rebrand:** Renamed from "Alternate Messenger CRM" to "Alternate CRM" across all user-facing surfaces
- **✨ Revamped Login Page:** New dark navy + amber/gold design with floating spark animations, feature cards (Lead Enrichment, Smart Deduplication, SDR Prioritization), and updated demo role buttons

### Improvements
- Updated tagline: "Turn raw leads into qualified prospects"
- Demo login buttons now match actual roles (Super Admin, Pod Admin, SDR)
- Responsive login layout for mobile screens

### Breaking Changes
None

---

## v3.5.2 – 23 March 2026

### Bug Fixes
- Fixed metrics export (CSV/XLSX) returning 401 Unauthorized — frontend was using wrong localStorage key for auth token
- Fixed backend export endpoint not accepting token from query parameter (required for browser-initiated downloads)

### Breaking Changes
None

---

## v3.5.1 – 23 March 2026

### Improvements
- **Enriched Salesforce Push:** When leads reach the push stage, we now send 19 fields instead of 7 — includes Title, Website, Industry, NumberOfEmployees, AnnualRevenue, City, State, Country, Street, PostalCode, and SDR research notes as Description
- Research hypothesis, personalization, company and contact notes are concatenated into the SF Description field

### Breaking Changes
None

---

## v3.5.0 – 23 March 2026

### New Features
- **🏆 Leaderboard Time-Periods:** Filter rankings by 7 Days, 30 Days, 90 Days, or All Time
- **SDR Self-Highlight:** Your row is highlighted with a "You" badge on the leaderboard, even if you're not in the top 3
- **📈 SDR Metrics UX:** Date range picker with presets (7D/30D/90D/180D), SDR name search filter, and pagination (10 rows/page) on the Per-SDR table
- **📸 User Guide Screenshots:** All 8 major sections now include embedded screenshots from the live app

### Improvements
- **⚙️ Settings Revamp:** Simplified to 2-tab layout (Connection + Sync Settings) — removed Profile tab, kept Data Summary sidebar
- **Settings hidden for SDRs:** Settings is now admin-only — SDRs no longer see the Settings nav item
- **Sync Settings restricted:** Only Super Admins can see/modify Sync Settings — Pod Admins see Connection tab only
- **Pod Admin SF view:** Pod Admins see read-only Salesforce connection status instead of credential form

### Bug Fixes
- Fixed Pod Admin Settings showing Salesforce credential form (should be read-only)
- Fixed Pod Admin seeing Sync Settings tab (should be Super Admin only)

### Breaking Changes
None

---

## v3.4.0 – 18 March 2026

### New Features
- **📤 Upload Center:** Dedicated page for importing enriched lead sheets — drag-and-drop file picker, smart field mapping, CSV/XLSX/XLS support, upload history and stats
- **Update Existing:** Toggle to update duplicate leads instead of skipping them during import

### Bug Fixes
- Fixed upload sheet skipping all entries when CSV contained a "result" column
- Removed duplicate Active Lead Cap from POD Settings

### Breaking Changes
None

---

## v3.3.0 – 18 March 2026

### New Features
- **Opportunity Outcome:** Pod Admin / Super Admin can mark leads as Won or Lost with optional notes
- **SDR Transparency:** SDRs see the outcome badge on lead detail and leads table (read-only)
- **Inline Badge:** Meeting Scheduled leads show Won/Lost/⏳ tag in the table

### Improvements
- Outcome changes logged in status history (audit trail)

### Breaking Changes
None

---

## v3.2.0 – 18 March 2026

### New Features
- **Admin Panel Overhaul:** Stats cards (Total / Active / Never Logged In / Revoked), search bar, POD filter, sortable columns, activity badges (🟢🟡🔴⚪), CSV export, pagination
- **Unified Audit Logs:** Merged SF Logs into a 4-tab view (Activity Log, Login History, Feedback, SF Logs) with date filters
- **Feedback System:** All users can submit bug reports, feature requests, and feedback via sidebar
- **Date Range Picker:** Added to All Leads table (default last 6 months)

### Bug Fixes
- Lead detail page now survives browser refresh (SPA fix)

### Breaking Changes
None

---

## v3.1.0 – 17 March 2026

### Bug Fixes
- SDRs can no longer move leads backward in the pipeline — only Pod Admins and Super Admins can
- Resolved `isTerminal` reference error on lead detail page

### Improvements
- Added frontend unit tests for `utils.js`, `auth.js`, and `api.js` using Vitest

### Breaking Changes
None

---

## v3.0.0 – 16 March 2026

### New Features
- **Three-Role System:** Super Admin, Pod Admin, SDR with role-based access
- **POD Management:** Create and manage PODs with team assignments
- **Salesforce Integration Logs:** Full SF API logging with filters, detail modal, and CSV export
- **Research Phase:** Guided research workflow before calling
- **SDR Performance:** Drill-down analytics per SDR
- **User Guide:** In-app searchable help guide with role-based content
- **Configurable Multi-POD:** Toggle to allow SDRs in multiple PODs

### Breaking Changes
- Role system changed from single-role to three-role hierarchy

---

## v2.0.0 – 11 March 2026

### New Features
- **Dashboard:** Stats tiles, recent leads, leaderboard widget
- **Lead Management:** Full lead lifecycle with Kanban board
- **Call Logging:** Log calls with outcomes, notes, and auto-status transitions
- **Salesforce Sync:** Two-way sync with configurable settings
- **Google SSO:** Single sign-on authentication
- **Lead Assignments:** Manual and Round Robin distribution

### Breaking Changes
None — initial release
