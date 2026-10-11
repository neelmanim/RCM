# Alternate CRM numbers — what each one means

If two screens disagree, the cause is almost always one of these definitions. **Last updated for v13.11.0.**

## Leads and ownership
| Word | Meaning |
|---|---|
| **Owner** | The person the lead is assigned to right now. A lead can have two owners (e.g. SDR + AE). |
| **Unassigned** | Nobody owns it. (These are shown nowhere on a rep's screen.) |
| **Lead state** (computed label, not a status) | **Unassigned** – no owner. **New to me** – owned, nobody has ever worked it. **Inherited** – owned, someone else worked it before and the current owner hasn't yet. **In progress** – the current owner has logged a call, note, email or status move since receiving it. **Meeting booked / Closed / On hold / Other** – decided by the status alone. Statuses themselves are unchanged. |
| **Given today** | Leads assigned to you today, or reset to Lead Assigned today. |
| **Ownership history** | Who owned a lead from when to when. Accurate **from the day v13.10.0 went live**; before that only today's owner is known. |

## Calls
| Word | Meaning |
|---|---|
| **Call** | A manual call log, or an outbound dialer call. A dialer call that was also logged by hand counts once. |
| **Connected / Conversation** | A call with a real outcome (anything other than no answer / voicemail / wrong number), or — when no outcome was logged — longer than the conversation threshold (Control Center, default 120 s). |

## Meetings
| Word | Meaning |
|---|---|
| **Booked** | A lead entered *Meeting Scheduled* (or skipped straight to a later meeting stage). One **booking record** per booking; a lead that books, no-shows and rebooks has two. Written by every path: call outcome, status change, Aircall tag, Salesforce sync. Records who booked it. |
| **Held** | A discovery/demo stage was reached after booking ("Mark Meeting Complete" or a later stage). |
| **No-show** | The "No-show" action was used on a booked meeting. |
| **Cancelled** | The lead was disqualified while the meeting was still only booked. |
| **Bookings before v13.11.0** | Reconstructed from today's leads and the status log (marked `backfill`); the booker is filled only when the name matched exactly one user. |

## Known differences between screens (until the shared metrics service lands)
- **Leaderboard "meetings"** counts leads the person *currently owns* that are in a meeting stage (all-time by default). It does **not** count meetings they booked in the period, and it still lists people who have left.
- **Analytics per-SDR meetings** counts by the date the lead reached a meeting stage, for the leads the person currently owns.
- **Dashboard Meetings+** is a snapshot of leads now in meeting stages.
- The meeting-stage list differs a little between screens (Dashboard Meetings+ omits discovery stages).
