# RCM CRM — User Guide

> **Version:** v4.12.0 · **Last Updated:** 20 April 2026

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Dashboard](#2-dashboard)
3. [My Leads](#3-my-leads)
4. [Lead Detail](#4-lead-detail)
5. [Analytics Dashboard (Super Admin / Pod Admin)](#5-analytics-dashboard)
6. [Upload Center (Admin)](#6-upload-center)
7. [Assignments (Admin)](#7-assignments)
8. [Settings (Super Admin)](#8-settings)
9. [User Guide & Release Notes (In-App)](#9-user-guide--release-notes)

---

## 1. Getting Started

### Logging In
1. Navigate to your CRM URL.
2. Click **Sign in with Google** — use your company Google account.
3. You will be redirected to your role-specific dashboard automatically.

> First-time users must be added by a Super Admin before they can log in.

### Roles

| Role | Access |
|------|--------|
| **Super Admin** | Full access — all leads, users, POD management, SF logs, analytics, settings |
| **Pod Admin** | Manages their POD's leads, SDRs, and analytics |
| **SDR** | Works assigned leads — research, calling, logging activity |

### Signing Out
Click your avatar in the bottom-left corner of the sidebar, then click the **⏻** button.

---

## 2. Dashboard

### Super Admin / Pod Admin Dashboard
- **Stats row:** Total Leads, Lead Assigned, Calling, Meetings Scheduled
- **Recent Leads table:** Latest activity across the org (or pod)
- **Leaderboard widget:** Top 5 SDRs by meetings booked
- **📊 Live Activity Feed:** Real-time stream of calls, status changes, and research events

### SDR Dashboard
A 5-tile funnel showing your personal pipeline:

| Tile | Meaning |
|------|---------|
| My Leads | Total leads assigned to you |
| New Leads | Untouched leads (Lead Assigned status) |
| Research Pending | Awaiting research completion |
| Calling | In your active calling queue |
| Meetings Booked | Moved to Meeting Scheduled |

Below the tiles: **Today's Call Outcomes**, **Priority Queue**, and the **Leaderboard** widget.

---

## 3. My Leads

The lead list is your primary workspace as an SDR.

### Filters
- **Search** by name, company, email, or phone
- **Company filter** — view all contacts from one organisation
- **Status filter** — filter by pipeline stage
- **Source filter** — filter by import batch or source
- **Date range** — narrow to a specific period

### Priority System
Leads are ranked automatically after each call:

| Priority | Score | Badge |
|----------|-------|-------|
| 🔴 High | ≥ 75 | Default — fresh / not called today |
| 🟡 Medium | 40–74 | Called once today |
| ⬇ Deprioritized | < 40 | Called 2+ times today (row muted) |

Click **↑ Re-prioritize** on any Medium or Deprioritized lead to instantly restore it to High.

### Phone Masking
Phone numbers are masked (`🔒 Hidden`) until all research fields are completed. This enforces the research-first workflow.

---

## 4. Lead Detail

### Tabs
- **Overview** — contact information, status, tasks, notes
- **Calls** — unified call history (manual + Aircall dialer), recordings, transcripts
- **Emails** — full email thread with open tracking
- **Conversations** — RCM messaging integration

### Research Accordions
Three collapsible sections: **Company Basics**, **Call Strategy**, **Customer Engagement**.
- Clicking any accordion auto-triggers AI research if no research has been started yet.
- The **Call Strategy** accordion auto-expands when a lead transitions to Calling status.

### Call Logging
1. Click the **📞 Call** button (or use the Aircall dialer).
2. After the call, select an outcome (Connected, Voicemail, Call Back Later, Meeting Confirmed, etc.).
3. Add notes and click **Save**.

> For Aircall calls, outcomes and notes are attached to the existing Aircall record — no duplicate entries.

### Tasks
- Click **+ Add Task** to set a reminder with a due date and due time.
- Tasks fire a notification bell and optional browser push notification when due.

---

## 5. Analytics Dashboard

> **Available to:** Super Admin, Pod Admin

### Accessing Analytics
Click **📊 Analytics** in the sidebar.

### Filter Hierarchy (POD → Date → Batch → Refine)

The Analytics Dashboard uses a strict top-to-bottom filter flow:

```
① Select POD  →  ② Select Date Range  →  ③ Select Batch  →  ④ Refine Date/Time
```

Each step unlocks the next. Locked steps are visually dimmed. A **breadcrumb bar** at the top always shows the active filter context.

### SDR Picker

Instead of a scrollable pill row, the trend chart has a **searchable SDR picker**:

1. Click the 🔍 search input — a dropdown of all SDRs in the selected pod appears.
2. Type to filter by name.
3. Click an SDR's name — their data is scoped into the trend chart as a removable chip.
4. Click the **✕** on the chip (or **All SDRs** button) to reset.

### Insight Bar

Below the filters, the Insight Bar shows:
- **Rule-based tags** (🔴 No Calls Today / 🟡 Low Connect Rate / 🟢 On Track)
- **🤖 AI Recommendation** — live Groq-backed suggestion, loads non-blocking, cached for 2 minutes

### Funnel Strip

Horizontal pipeline funnel: **Leads → Calls → Connects → Meetings** with % conversion between each stage.

### KPI Metric Cards

6 cards in a single row:

| Card | Description |
|------|-------------|
| Leads | Total leads assigned in the selected period |
| Research | Leads with research completed |
| Emails | Outbound emails sent |
| Calls | Total calls made |
| Connect % | Connected calls ÷ Total calls |
| Disqualified | Leads disqualified |

### Activity Trend Chart

- **5 metric toggles:** Calls, Meetings, Research, Disqualified, Emails — click to show/hide each line.
- **SDR Picker** (see above) — scope to a single SDR or view all.
- Chart height is fixed at 260px to maintain readability.

### SDR Performance Table

Sortable table of all SDRs in the selected scope:

| Column | Description |
|--------|-------------|
| SDR | Name |
| Calls | Calls made in period |
| Connect % | Call connection rate |
| Meetings | Meetings booked |
| Emails | Emails sent |

- **Pagination:** Use **←** / **→** buttons. Page indicator shows `N / M`.
- **Show Inactive SDRs** toggle — reveals SDRs with no recent activity.
- Table is capped at `440px` height and scrollable internally.

### All Batches Mode

Click the **📦 All Batches** toggle (top-right of the SDR table panel) to switch to a full-width batch comparison table:

| Column | Description |
|--------|-------------|
| Batch | Source label and date |
| Leads | Leads in this batch |
| Calls | Calls made on batch leads |
| Connect % | Connection rate |
| Meetings | Meetings from batch leads |
| Emails | Emails to batch leads |

A **Totals** row summarises all batches.

---

## 6. Upload Center

> **Available to:** Super Admin, Pod Admin

### Tabs
- **File Upload** — drag-and-drop CSV/XLSX/XLS import
- **Google Sheets** — import directly from a Google Sheets URL
- **Batch Tracker** — view and drill into all previous import batches

### File Upload Steps
1. Drag a file into the upload zone or click to browse.
2. Map columns using the smart field-mapping UI (auto-detects most common headers).
3. Select assignment: **Assign to SDR** or **Assign to Pod** (round-robin distributed).
4. Toggle **Update Existing** if you want to update duplicate leads instead of skipping.
5. Click **Upload**.

### Batch Tracker
- **Summary cards:** Total Batches, Leads in DB, Meetings Scheduled, Overall Conversion %
- **Filters:** Date range and Pod
- **Expandable batch cards:** Click any card to see every lead — name, company, status, SDR, call count, last outcome, research status
- **Lead navigation:** Click a lead name to go directly to that lead's detail page

---

## 7. Assignments

> **Available to:** Super Admin, Pod Admin

### Unassigned Leads Tab
- View all leads not yet assigned to an SDR
- Filter by company, status, or source
- Select leads and use **Assign** to distribute them

### Assigned Leads Tab
- View all assigned leads with their SDR
- Filter by SDR using the SDR dropdown
- **Bulk Unassign** — select and release leads back to the pool
- **Bulk Delete** (Super Admin only) — permanently remove leads

---

## 8. Settings

> **Available to:** Super Admin (full), Pod Admin (connection tab only)

### Connection Tab
- Salesforce credentials and OAuth status
- Nylas email integration and OAuth
- Aircall API key and phone number configuration

### Sync Settings (Super Admin only)
- Active Lead Cap per SDR
- Call Attempt limits
- Push Stage trigger (when to sync a lead to Salesforce)
- Cooldown period for terminal leads

---

## 9. User Guide & Release Notes (In-App)

Click **📖 User Guide** in the sidebar at any time to open this guide with role-aware content.

The **📋 What's New — Release Notes** section at the bottom tracks every production update, most recent first.

---

*For technical issues, contact your Super Admin or the RCM engineering team.*
