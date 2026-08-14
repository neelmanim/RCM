// ── views/user_guide.js — In-app help / user guide ────────────────────────────
import { isSuperAdmin, isPodAdmin, isSDR, currentUser } from '../auth.js';

export function renderUserGuide(container) {
    const role = isSuperAdmin ? 'super_admin' : isPodAdmin ? 'pod_admin' : 'sdr';
    const roleName = isSuperAdmin ? 'Super Admin' : isPodAdmin ? 'Pod Admin' : (currentUser?.role === 'AE' ? 'AE' : 'SDR');

    // Build sections based on role
    const sections = [];

    // ── Getting Started (all roles) ──
    sections.push({
        title: '🚀 Getting Started',
        roles: ['sdr', 'pod_admin', 'super_admin'],
        content: `
            <h4>Logging In</h4>
            <ol>
                <li>Go to your CRM URL</li>
                <li>Click <strong>Sign in with Google</strong> — use your company Google account</li>
                <li>You'll be redirected to your dashboard automatically</li>
            </ol>
            <div class="guide-note">First-time users must be added by a Super Admin before they can log in.</div>

            <h4>Your Role: ${roleName}</h4>
            <table class="guide-table">
                <tr><th>Role</th><th>Access Level</th></tr>
                <tr><td><strong>Super Admin</strong></td><td>Full access — all leads, users, POD management, SF logs, settings</td></tr>
                <tr><td><strong>Pod Admin</strong></td><td>Manages their POD's leads and SDRs</td></tr>
                <tr><td><strong>SDR</strong></td><td>Works assigned leads — research, calling, logging activity</td></tr>
            </table>

            <h4>Signing Out</h4>
            <p>Click your avatar in the bottom-left corner, then click the <strong>⏻</strong> button.</p>
        `
    });

    // ── Dashboard ──
    sections.push({
        title: '📊 Dashboard',
        roles: ['sdr', 'pod_admin', 'super_admin'],
        content: role === 'super_admin' ? `
            <div style="margin-bottom:16px;"><img src="img/guide/dashboard.png" alt="Dashboard" style="width:100%;border-radius:10px;border:1px solid var(--border-color);" loading="lazy"></div>
            <p>Your org-wide command centre shows:</p>
            <ul>
                <li><strong>Total Leads</strong>, <strong>Lead Assigned</strong>, <strong>Calling</strong>, <strong>Meetings Scheduled</strong> tiles</li>
                <li><strong>📵 No Phone</strong> — red card showing leads parked due to missing phone numbers (excluded from pipeline counts)</li>
                <li><strong>Recent Leads</strong> table — latest activity across the org</li>
                <li><strong>Leaderboard widget</strong> — top 5 SDRs</li>
                <li><strong>📊 Live Activity Feed</strong> — real-time status changes</li>
            </ul>
        ` : `
            <p>Your personal command centre with a <strong>5-tile funnel</strong>:</p>
            <table class="guide-table">
                <tr><td><strong>My Leads</strong></td><td>Total leads assigned to you</td></tr>
                <tr><td><strong>New Leads</strong></td><td>Untouched leads (Lead Assigned)</td></tr>
                <tr><td><strong>Research Pending</strong></td><td>Awaiting research completion</td></tr>
                <tr><td><strong>Calling</strong></td><td>In your active calling queue</td></tr>
                <tr><td><strong>Meetings Booked</strong></td><td>Moved to Meeting Scheduled or beyond (Discovery, Demo)</td></tr>
            </table>
            <p>Below the tiles: <strong>Today's Call Outcomes</strong>, <strong>Priority Queue</strong>, and <strong>Leaderboard</strong> widget.</p>

            <h4>Clickable Call Outcome Tiles</h4>
            <p>The <strong>Today's Call Outcomes</strong> cards are interactive — click any outcome tile (e.g. <strong>"Call Back Later"</strong>, <strong>"No Answer"</strong>) to instantly jump to your Leads page with that outcome pre-filtered.</p>
            <div class="guide-tip"><strong>Tip:</strong> Start your day by clicking "Call Back Later" on the dashboard to see exactly which leads need a follow-up call today.</div>
        `
    });

    // ── Leads ──
    sections.push({
        title: '📋 Leads',
        roles: ['sdr', 'pod_admin', 'super_admin'],
        content: `
            <div style="margin-bottom:16px;"><img src="img/guide/leads.png" alt="Leads Table" style="width:100%;border-radius:10px;border:1px solid var(--border-color);" loading="lazy"></div>
            <p>${role === 'sdr' ? 'Click <strong>Leads</strong> in the sidebar to see all leads assigned to you.' : 'Click <strong>Leads</strong> to see all leads across your ' + (role === 'super_admin' ? 'organization' : 'POD') + '.'}</p>

            <h4>Filtering</h4>
            <ul>
                <li><strong>🔍 Search</strong> — filter by name, email, or company</li>
                <li><strong>Status dropdown</strong> — filter by pipeline stage</li>
                <li><strong>📞 Outcome dropdown</strong> — filter by the lead's <em>most recent</em> call outcome (e.g. <strong>Call Back Later</strong>, <strong>Meeting Confirmed</strong>, <strong>No Answer</strong>, <strong>Voicemail Left</strong>, <strong>Not Interested</strong>)</li>
                <li><strong>Source dropdown</strong> — Salesforce or Uploaded</li>
                <li><strong>🏢 Company dropdown</strong> — see all personas at one hospital at once</li>
                <li><strong>From / To date pickers</strong> — filter by creation date</li>
            </ul>
            <div class="guide-note"><strong>Outcome filter precision:</strong> Only the <strong>most recent call per lead</strong> is evaluated. A lead who was "Call Back Later" last week but was subsequently "Meeting Confirmed" will appear under Meeting Confirmed — not Call Back Later.</div>

            <h4>Last Call Outcome Badge</h4>
            <p>Every lead row shows a small <strong>last call outcome badge</strong> below their status chip — a coloured icon (e.g. 📞 No Answer, ✅ Call Back Later) so you can see call history at a glance without opening the lead.</p>

            <h4>Quick Actions</h4>
            <ul>
                <li><strong>📞 Call button</strong> — log a call without opening the lead (disabled until research is done)</li>
                <li><strong>Click a row</strong> — open the Lead Detail page</li>
            </ul>

            ${role !== 'sdr' ? `
            <h4>Assignments Tab</h4>
            <ul>
                <li><strong>SDR Filter:</strong> Filter both tables by a specific SDR to manage their workload</li>
                <li><strong>Manual assign:</strong> Check leads → pick an SDR → click <strong>Assign →</strong></li>
                <li><strong>Round Robin:</strong> Click 🔄 to auto-distribute unassigned leads evenly (respects Active Lead Cap). Leads from the same company are grouped to a single SDR.</li>
                <li><strong>Bulk Unassign:</strong> Select assigned leads → click <strong>Unassign Selected</strong> in the floating action bar</li>
                ${role === 'super_admin' ? '<li><strong>Bulk Delete:</strong> Select leads → click <strong>🗑️ Delete Selected</strong> (Super Admin only, irreversible)</li>' : ''}
                <li><strong>Unassign single:</strong> Click <strong>Unassign</strong> next to any SDR name</li>
            </ul>
            ` : ''}
        `
    });

    // ── Lead Detail ──
    sections.push({
        title: '👤 Lead Detail',
        roles: ['sdr', 'pod_admin', 'super_admin'],
        content: `
            <div style="margin-bottom:16px;"><img src="img/guide/lead_detail.png" alt="Lead Detail" style="width:100%;border-radius:10px;border:1px solid var(--border-color);" loading="lazy"></div>
            <h4>Pipeline Stepper</h4>
            <p>The visual pipeline at the top shows the lead's journey:</p>
            <ul>
                <li><strong>Green ✓</strong> = completed stages</li>
                <li><strong>Purple circle</strong> = current stage</li>
                <li><strong>Gray circles</strong> = future stages</li>
                <li><strong>Transition times</strong> between steps (e.g. "1d 0h", "&lt;1m")</li>
                <li>Lead created and assigned dates shown above</li>
            </ul>
            <div class="guide-tip"><strong>Terminal outcomes:</strong> If a lead is Unreachable or Customer Declined, a dashed red line branches down from the Calling step showing the terminal status with timestamp.</div>

            <h4>Contact Information</h4>
            <p>The Contact Information card shows:</p>
            <ul>
                <li><strong>Email, Phone, Secondary Phone</strong> — click-to-edit fields for quick updates</li>
                <li><strong>Company, Job Title</strong> — click-to-edit</li>
                <li><strong>LinkedIn</strong> — clickable "View Profile" link that opens in a new tab</li>
            </ul>
            <div class="guide-tip"><strong>Secondary Phone:</strong> Use this field for alternate contact numbers. It's auto-populated during import if the sheet has multiple phone columns, or SDRs can add it manually.</div>

            <h4>Editing Lead Info</h4>
            <p>All fields are <strong>click-to-edit</strong> — click any value, edit it, then press Enter or click away to save.</p>

            <h4>Research Phase</h4>
            <p>For leads in <strong>Research</strong> status:</p>
            <ul>
                <li>Accordion sections for structured research data</li>
                <li>Progress ring (Research Score X/11)</li>
                <li><strong>Auto-fill</strong> from enrichment data</li>
                <li>Complete research to unlock the <strong>Calling</strong> stage</li>
            </ul>

            <h4>Logging a Call</h4>
            <p><strong>With Aircall enabled:</strong> Click 📞 to place a call through Aircall — calls are tracked automatically with duration and recording. No manual logging needed.</p>
            <p><strong>Without a dialer:</strong> Click <strong>📞 Log a Call</strong> to manually record a call:</p>
            <ol>
                <li>Select the <strong>Outcome</strong> (Answered, No Answer, Left Voicemail, Call Completed)</li>
                <li>Optionally update the <strong>Lead Status</strong></li>
                <li>Add <strong>Notes</strong></li>
                <li>Click <strong>Log Call</strong></li>
            </ol>
            <div class="guide-tip"><strong>Tip:</strong> Selecting "Meeting Confirmed" moves the lead to Meeting Scheduled and triggers the qualification pipeline.</div>
            <div class="guide-warning"><strong>Unreachable detection:</strong> After multiple No Answer/Voicemail attempts, an "Unreachable" option appears. Use it to remove leads from your active pipeline when they can't be reached.</div>

            <h4>Notes & Tasks</h4>
            <ul>
                <li><strong>Notes:</strong> Type → Save Note. Time-stamped and attributed to you.</li>
                <li><strong>Tasks:</strong> Type a title, pick an optional <strong>due date</strong> and <strong>due time</strong> → Add. Check to complete, ✕ to delete.</li>
            </ul>
            <div class="guide-tip"><strong>Always set a due time</strong> for callbacks — the notification bell fires at that exact time, not just on the due date.</div>
        `
    });

    // ── Task Notifications ──
    sections.push({
        title: '🔔 Task Notifications',
        roles: ['sdr', 'pod_admin', 'super_admin'],
        content: `
            <h4>What is the Notification Bell?</h4>
            <p>The <strong>🔔 bell icon</strong> in the top-right of every page shows how many tasks are due right now. Click it to open the <strong>Notification Panel</strong>.</p>

            <h4>When do tasks appear?</h4>
            <ul>
                <li>A task fires when its <strong>due date + due time</strong> is reached (or has passed)</li>
                <li>Dismissed and completed tasks do <strong>not</strong> reappear</li>
                <li>The panel auto-refreshes every 30 seconds in the background</li>
            </ul>

            <h4>Snooze</h4>
            <p>Click <strong>Snooze</strong> on any notification to delay it. Choose from:</p>
            <ul>
                <li><strong>5 minutes</strong></li>
                <li><strong>15 minutes</strong></li>
                <li><strong>30 minutes</strong></li>
                <li><strong>60 minutes</strong></li>
            </ul>
            <div class="guide-tip">The task will reappear in the panel after the snooze period ends.</div>

            <h4>Dismiss</h4>
            <p>Click <strong>Dismiss</strong> to permanently remove a notification from the panel. The task itself is <strong>not</strong> deleted — it stays on the lead detail page. Dismissing just stops the bell from showing it again.</p>

            <div class="guide-note"><strong>Reliability:</strong> Snooze and Dismiss only update the UI <em>after</em> the server confirms the action. If there is a network issue, the button re-enables automatically so you can retry — no ghost tasks.</div>
        `
    });

    // ── Pipeline (Kanban) ──
    sections.push({
        title: '🗂️ Pipeline (Kanban Board)',
        roles: ['sdr', 'pod_admin', 'super_admin'],
        content: `
            <div style="margin-bottom:16px;"><img src="img/guide/pipeline.png" alt="Pipeline Kanban" style="width:100%;border-radius:10px;border:1px solid var(--border-color);" loading="lazy"></div>
            <p>Click <strong>Pipeline</strong> in the sidebar for a visual Kanban board.</p>
            <ul>
                <li><strong>Drag cards</strong> between columns to update status</li>
                <li>Click <strong>📞</strong> on a card to log a quick call</li>
            </ul>
        `
    });

    // ── Leaderboard & SDR Performance ──
    sections.push({
        title: '🏆 Leaderboard & SDR Performance',
        roles: ['sdr', 'pod_admin', 'super_admin'],
        content: `
            <div style="margin-bottom:16px;"><img src="img/guide/leaderboard.png" alt="Leaderboard" style="width:100%;border-radius:10px;border:1px solid var(--border-color);" loading="lazy"></div>
            <h4>Leaderboard</h4>
            <p>SDRs ranked by <strong>meetings booked</strong>. Top 3 shown as medal cards.</p>
            <ul>
                <li><strong>Time-Period Presets:</strong> Switch between <strong>7 Days</strong>, <strong>30 Days</strong>, <strong>90 Days</strong>, and <strong>All Time</strong> to see rankings for any window</li>
                <li><strong>SDR Self-Highlight:</strong> When you view the leaderboard, your row is highlighted in blue with a "You" badge — even if you're not in the top 3</li>
                <li><strong>Click any SDR name</strong> to drill into their Performance Analytics</li>
            </ul>

            <h4>SDR Performance Drill-Down</h4>
            <p><strong>Click any SDR name</strong> on the Leaderboard to see detailed analytics:</p>
            <table class="guide-table">
                <tr><td>📋 Leads Assigned</td><td>Total leads ever assigned</td></tr>
                <tr><td>🔥 Active Leads</td><td>Currently active leads</td></tr>
                <tr><td>✅ Leads Closed</td><td>Terminal or completed</td></tr>
                <tr><td>📞 Calls Made</td><td>Total call logs</td></tr>
                <tr><td>📊 Avg Calls/Lead</td><td>Average calls per lead</td></tr>
                <tr><td>🤝 Meetings</td><td>Meetings booked</td></tr>
                <tr><td>📈 Conv. Rate</td><td>Meetings / total leads %</td></tr>
                <tr><td>⏱️ Avg Time/Lead</td><td>Assignment to close time</td></tr>
            </table>
            <p>Includes a <strong>Pipeline Funnel</strong> chart and <strong>Efficiency Metrics</strong>. Use time period filters: Today, This Week, This Month, All Time.</p>
        `
    });

    // ── Admin Panel (Pod Admin+) ──
    if (role !== 'sdr') {
        sections.push({
            title: '🛡️ Admin Panel',
            roles: ['pod_admin', 'super_admin'],
            content: `
                <div style="margin-bottom:16px;"><img src="img/guide/admin.png" alt="Admin Panel" style="width:100%;border-radius:10px;border:1px solid var(--border-color);" loading="lazy"></div>
                <p>${role === 'super_admin' ? 'See <strong>all users</strong> across all PODs, organized by role tabs (Super Admins / Pod Admins / SDRs).' : 'See your <strong>POD\'s users</strong> only.'}</p>

                ${role === 'super_admin' ? `
                <h4>Stats Cards</h4>
                <p>At the top, 4 summary cards give you an instant health overview:</p>
                <table class="guide-table">
                    <tr><td><strong>Total Users</strong></td><td>Number of users across all roles</td></tr>
                    <tr><td><strong>Active (7d)</strong></td><td>Users who logged in within the last 7 days</td></tr>
                    <tr><td><strong>Never Logged In</strong></td><td>Users who have never signed in</td></tr>
                    <tr><td><strong>Access Revoked</strong></td><td>Users whose access has been revoked</td></tr>
                </table>
                ` : ''}

                <h4>Search & Filter</h4>
                <ul>
                    <li><strong>🔍 Search</strong> — filter users by name or email (instant)</li>
                    <li><strong>POD Filter</strong> — dropdown to show only users from a specific POD</li>
                    <li><strong>Sortable Columns</strong> — click Name, Email, Last Login, or POD to sort ascending/descending</li>
                </ul>

                <h4>Activity Status</h4>
                <p>Each user row shows a color-coded activity badge:</p>
                <table class="guide-table">
                    <tr><td>🟢 <strong>Active</strong></td><td>Logged in within the last 7 days</td></tr>
                    <tr><td>🟡 <strong>Idle</strong></td><td>Last login 7–30 days ago</td></tr>
                    <tr><td>🔴 <strong>Inactive</strong></td><td>Last login 30+ days ago</td></tr>
                    <tr><td>⚪ <strong>Never</strong></td><td>Never logged in — row highlighted</td></tr>
                </table>

                <h4>Actions</h4>
                <ul>
                    <li><strong>👁️ Impersonate</strong> — see CRM as that user</li>
                    <li><strong>📥 Export</strong> — download filtered list as CSV</li>
                    ${role === 'super_admin' ? `
                    <li><strong>+ Add User</strong> — name, email, role, optional POD</li>
                    <li><strong>Change roles</strong> — promote/demote users via dropdown</li>
                    <li><strong>Revoke / Restore access</strong></li>
                    <li><strong>📤 Upload CSV</strong> — bulk add/remove SDRs</li>
                    ` : ''}
                </ul>
                <div class="guide-tip"><strong>Tip:</strong> Users are paginated (10 per page). Use the search bar to quickly find specific users.</div>
            `
        });
    }

    // ── POD Management (Super Admin) ──
    if (role === 'super_admin') {
        sections.push({
            title: '👥 POD Management',
            roles: ['super_admin'],
            content: `
                <h4>Creating a POD</h4>
                <ol>
                    <li>Click <strong>+ Create POD</strong></li>
                    <li>Enter name and select a Pod Admin</li>
                    <li>Click <strong>Create</strong></li>
                </ol>
                <h4>Managing Members</h4>
                <ul>
                    <li>Each POD card shows admin, members, lead counts</li>
                    <li><strong>Add SDR</strong> dropdown to add team members</li>
                    <li><strong>Remove</strong> to take an SDR out</li>
                    <li><strong>🗑️</strong> to delete a POD entirely</li>
                </ul>
            `
        });
    }

    // ── Audit Logs (Super Admin) ──
    if (role === 'super_admin') {
        sections.push({
            title: '🔒 Audit Logs',
            roles: ['super_admin'],
            content: `
                <p>A unified view for all system logs and feedback, organized into <strong>4 tabs</strong>.</p>

                <h4>📋 Activity Log</h4>
                <p>Tracks all lead status changes across the system.</p>
                <ul>
                    <li>See who changed what lead and when</li>
                    <li><strong>Search</strong> by lead name and filter by <strong>date range</strong> (From / To)</li>
                </ul>

                <h4>🔐 Login History</h4>
                <p>Tracks all user login sessions.</p>
                <ul>
                    <li>Shows user, email, role, login/logout times, <strong>session duration</strong>, and IP address</li>
                    <li>Filter by <strong>search</strong> and <strong>date range</strong></li>
                </ul>

                <h4>💬 Feedback</h4>
                <p>User-submitted feedback about bugs or issues.</p>
                <ul>
                    <li>View feedback type (Bug / Feature / General), message, and submitter</li>
                    <li>Update feedback status inline: <strong>New → Reviewed → Resolved</strong></li>
                </ul>

                <h4>📋 SF Logs</h4>
                <p>Every Salesforce API interaction logged here.</p>
                <ul>
                    <li>Filter by Status, Operation, Object, Date Range, or Search</li>
                    <li><strong>Stats row</strong> — total, pages, success, failed counts</li>
                    <li><strong>Click 🔍</strong> on any row for full request/response detail</li>
                    <li><strong>📥 Export CSV</strong></li>
                    <li><strong>Auto-refresh</strong> toggle (30 seconds)</li>
                </ul>

                <h4>🔴 Error Logs <span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;margin-left:4px;">NEW v5.9.0</span></h4>
                <p>Automatically captures every frontend and backend error and surfaces it in plain English — no Render logs or browser consoles needed.</p>
                <ul>
                    <li><strong>Severity cards</strong> — 🔴 Critical (server errors) or 🟡 Warning (API failures, upload errors)</li>
                    <li><strong>Plain-English description</strong> — what went wrong and who it affected</li>
                    <li><strong>What to do</strong> — actionable hint on each card</li>
                    <li><strong>×N dedup badge</strong> — repeated errors collapsed into one card with an occurrence count</li>
                    <li><strong>✓ Resolve</strong> — one-click to dismiss; card fades out, badge clears</li>
                    <li><strong>Filters</strong> — by Severity, Category (API / Dialer / Research / Upload / Salesforce / Auth), and Status (Unresolved / Resolved / All)</li>
                    <li><strong>Auto-purge</strong> — logs older than 15 days are deleted nightly automatically</li>
                </ul>
                <div class="guide-note"><strong>Role visibility:</strong> Super Admins see all errors. Pod Admins see their pod's errors. SDRs see only their own.</div>
            `
        });
    }

    // ── Feedback (All users) ──
    sections.push({
        title: '💬 Send Feedback',
        roles: ['sdr', 'pod_admin', 'super_admin'],
        content: `
            <p>Click the <strong>💬 Send Feedback</strong> button in the sidebar to report bugs, suggest features, or share general feedback.</p>
            <ol>
                <li>Click <strong>💬 Send Feedback</strong></li>
                <li>Select a type: <strong>Bug Report</strong>, <strong>Feature Request</strong>, or <strong>General Feedback</strong></li>
                <li>Write your message</li>
                <li>Click <strong>Submit</strong></li>
            </ol>
            <div class="guide-note">Your feedback is reviewed by Super Admins in the Audit Logs section.</div>
        `
    });

    // ── Call & Pipeline Settings (Super Admin) ──
    if (role === 'super_admin') {
        sections.push({
            title: '📞 Call & Pipeline Settings',
            roles: ['super_admin'],
            content: `
                <p>Found in <strong>Settings → Call & Pipeline Settings</strong>:</p>
                <table class="guide-table">
                    <tr><th>Setting</th><th>Description</th></tr>
                    <tr><td><strong>Active Lead Cap</strong></td><td>Max active leads per SDR. SDRs at cap are skipped during Round Robin. <code>0</code> = pause assignments.</td></tr>
                    <tr><td><strong>Max Call Attempts</strong></td><td>No Answer/Voicemail attempts before a warning appears.</td></tr>
                    <tr><td><strong>Min Attempts for Unreachable</strong></td><td>Minimum failed attempts before "Unreachable" option unlocks.</td></tr>
                    <tr><td><strong>Terminal Lead Cooldown</strong></td><td>Days before terminal leads can be recycled. <code>0</code> = no recycling.</td></tr>
                </table>
                <h4>Salesforce Sync Options</h4>
                <ul>
                    <li><strong>Sync Customer Declined</strong> — push declined leads to SF</li>
                    <li><strong>Sync Unreachable</strong> — push unreachable leads to SF</li>
                </ul>
            `
        });
    }
    // ── Aircall Dialer (Super Admin + SDR) ──
    sections.push({
        title: '📞 Aircall Dialer',
        roles: ['sdr', 'pod_admin', 'super_admin'],
        content: `
            <h4>What is it?</h4>
            <p>Aircall integration lets SDRs make calls directly from RCM with <strong>one click</strong>. Calls are tracked automatically — no manual logging needed.</p>

            <h4>Setup (Super Admin)</h4>
            <ol>
                <li>Go to <strong>Settings → Dialer</strong> tab</li>
                <li>Enter your Aircall <strong>API ID</strong> and <strong>API Token</strong> (from Aircall Dashboard → Integrations)</li>
                <li>Click <strong>Save Credentials</strong></li>
                <li>Select a <strong>phone number</strong> from the dropdown</li>
                <li>Click <strong>Test Connection</strong> to verify</li>
            </ol>
            <div class="guide-tip"><strong>Tip:</strong> Once configured, the Aircall dialer is active for all users. Manual call logging is automatically disabled.</div>

            <h4>Making Calls (SDR)</h4>
            <ol>
                <li>Open a lead's detail page</li>
                <li>Click the <strong>📞 Call</strong> button</li>
                <li>A confirmation dialog shows the number — click <strong>Call Now</strong></li>
                <li>The call opens in your Aircall app — talk, then hang up</li>
                <li>The call is <strong>automatically logged</strong> with duration and recording</li>
            </ol>
            <div class="guide-note">When Aircall is enabled, the manual call logging modal is disabled. All calls go through the dialer automatically.</div>

            <h4>Calls Tab</h4>
            <p>The <strong>Calls</strong> tab on the lead detail page shows all calls in a unified view:</p>
            <ul>
                <li><strong>Stats bar:</strong> Total Calls, Connected, Avg Duration, Last Called</li>
                <li><strong>Call cards:</strong> Each card shows caller, phone number, duration, and timestamp</li>
                <li><strong>Filter pills:</strong> All / Connected / Missed</li>
                <li><strong>Badge:</strong> "via Aircall" for dialer calls, "Manual Log" for pre-dialer calls</li>
            </ul>

            <h4>Call Recordings</h4>
            <p>If Aircall records calls, an <strong>audio player</strong> appears on the call card:</p>
            <ul>
                <li>Press ▶️ to listen to the recording</li>
                <li>Click <strong>↓ Download</strong> to save the audio file</li>
            </ul>
            <div class="guide-warning"><strong>Note:</strong> Call transcripts require an Aircall plan with transcription enabled. Contact your Aircall admin to enable this feature.</div>
        `
    });

    // ── RCM Dialer (SDR + Admin) ──
    sections.push({
        title: '📞 RCM Dialer (Browser Calling)',
        roles: ['sdr', 'pod_admin', 'super_admin'],
        content: `
            <h4>What is it?</h4>
            <p>The RCM Contact Center integration lets SDRs make calls <strong>directly in the browser</strong> using WebRTC — no external app required. A floating call widget appears on screen with real-time controls.</p>
            <div class="guide-note"><strong>Note:</strong> Your admin assigns each SDR to either Aircall or RCM. You'll use whichever is assigned to you — the Call button works the same way regardless.</div>

            <h4>Call Mode Selector</h4>
            <p>Before each call, a <strong>"How would you like to call?"</strong> dialog lets you choose your preferred method:</p>
            <table class="guide-table">
                <tr><th>Mode</th><th>How it Works</th></tr>
                <tr><td><strong>🌐 Browser Call</strong> (default)</td><td>Call connects via WebRTC directly in your browser — you hear and speak through your computer's mic and speakers</td></tr>
                <tr><td><strong>📱 Phone Bridge</strong></td><td>Call is bridged to your registered phone number — your phone rings first, then the lead is connected</td></tr>
            </table>
            <div class="guide-warning"><strong>Microphone Permission:</strong> Browser Call mode requires microphone access. When prompted by your browser, click <strong>Allow</strong>. The site must be served over HTTPS.</div>

            <h4>Making Calls (SDR)</h4>
            <ol>
                <li>Open a lead's detail page</li>
                <li>Click the <strong>📞 Call</strong> button</li>
                <li>Select your <strong>call mode</strong> (Browser Call or Phone Bridge) and click <strong>Place Call</strong></li>
                <li>A <strong>floating call widget</strong> appears in the bottom-right corner</li>
                <li>The call connects automatically — talk to the lead</li>
                <li>Use the widget controls during the call:</li>
            </ol>
            <table class="guide-table">
                <tr><th>Button</th><th>Action</th></tr>
                <tr><td><strong>🔇 Mute</strong></td><td>Toggle your microphone on/off</td></tr>
                <tr><td><strong>⏸ Hold</strong></td><td>Place the call on hold</td></tr>
                <tr><td><strong>📞 Hang Up</strong></td><td>End the call</td></tr>
            </table>
            <div class="guide-tip"><strong>Tip:</strong> The widget is draggable — click and hold the header to move it anywhere on screen. It won't interfere with your other work.</div>

            <h4>Call Widget Features</h4>
            <ul>
                <li><strong>⏱️ Live Timer:</strong> Shows real-time call duration</li>
                <li><strong>🔴 Recording Badge:</strong> Indicates when the call is being recorded</li>
                <li><strong>📋 Auto-Logging:</strong> Calls are automatically logged with duration, recording URL, and transcript (if available)</li>
                <li><strong>📱 Mobile Support:</strong> Widget is fixed to the bottom of the screen on mobile devices</li>
            </ul>

            <h4>Calls Tab</h4>
            <p>Calls made via RCM appear in the <strong>Calls</strong> tab with a <strong>"via RCM"</strong> badge. You can:</p>
            <ul>
                <li>Listen to call recordings (if enabled)</li>
                <li>View call transcripts</li>
                <li>See call duration and outcome</li>
            </ul>

            <h4>How Dialer Assignment Works (Admin)</h4>
            <p>Super Admins can assign each SDR to a dialer provider:</p>
            <ul>
                <li><strong>Aircall (default):</strong> Calls go through the Aircall app</li>
                <li><strong>RCM:</strong> Calls happen in the browser via the floating widget</li>
            </ul>
            <div class="guide-warning"><strong>Important:</strong> Changing an SDR's dialer assignment takes effect immediately. The SDR's next call will use the new provider.</div>
        `
    });
    // ── SDR Metrics (Admin only) ──
    if (role !== 'sdr') {
        sections.push({
            title: '📈 SDR Metrics',
            roles: ['pod_admin', 'super_admin'],
            content: `
                <div style="margin-bottom:16px;"><img src="img/guide/metrics.png" alt="SDR Metrics" style="width:100%;border-radius:10px;border:1px solid var(--border-color);" loading="lazy"></div>
                <p>Click <strong>📈 SDR Metrics</strong> in the sidebar to view team performance analytics.</p>
                <ul>
                    <li><strong>Date Range Picker:</strong> Use From/To date inputs or quick presets (<strong>7D</strong>, <strong>30D</strong>, <strong>90D</strong>, <strong>180D</strong>) to filter metrics by time period</li>
                    <li><strong>Summary Cards:</strong> Total calls, meetings, active leads, and conversion rate for the selected period</li>
                    <li><strong>Daily Trend Chart:</strong> Line chart showing daily activity over the selected range</li>
                    <li><strong>Per-SDR Performance Table:</strong> Sortable table with each SDR's metrics</li>
                    <li><strong>Search Filter:</strong> Type to filter rows by SDR name in real time</li>
                    <li><strong>Pagination:</strong> 10 rows per page with Prev/Next controls</li>
                </ul>
            `
        });
    }

    // ── Activity Feed (Admin only) ──
    if (role !== 'sdr') {
        sections.push({
            title: '📡 Activity Feed',
            roles: ['pod_admin', 'super_admin'],
            content: `
                <p>Click <strong>📡 Activity Feed</strong> in the sidebar to see a unified view of all SDR interactions — calls, emails, status changes, and research — in one place.</p>
                <div class="guide-note"><strong>Purpose:</strong> Understand what happened, how the customer was connected, what's pending, and what was gathered — without opening individual leads.</div>

                <h4>Stats & Filters</h4>
                <ul>
                    <li><strong>Stats Cards:</strong> Total Activities, Meetings Booked, Call Connect Rate, Emails</li>
                    <li><strong>Type Tabs:</strong> All, Calls, Emails, Status, Research — each with a count badge</li>
                    <li><strong>Filters:</strong> POD, SDR, Outcome, Date Range, and Search</li>
                    <li><strong>Smart Search:</strong> Searching by lead or company automatically bypasses date filters to search across all time</li>
                </ul>

                <h4>Table Columns</h4>
                <table class="guide-table">
                    <tr><td><strong>Type</strong></td><td>📞 Call · 📧 Email · 🔄 Status · 🔬 Research</td></tr>
                    <tr><td><strong>Lead</strong></td><td>Click to navigate to lead detail</td></tr>
                    <tr><td><strong>Outcome / Action</strong></td><td>Call outcome, status transition, or email direction. Green <strong>REC</strong> badge if recording available</td></tr>
                    <tr><td><strong>Notes / Summary</strong></td><td>Preview of call notes, email subject, or strategy context</td></tr>
                </table>

                <h4>Expanded Call Detail</h4>
                <ul>
                    <li><strong>🎯 Call Strategy:</strong> Personalization angle and research hypothesis</li>
                    <li><strong>📝 Call Notes:</strong> What happened, outcome, and duration</li>
                    <li><strong>🎙️ Recording:</strong> Click to play call recording (if available)</li>
                    <li><strong>📃 Transcript:</strong> Scrollable call transcript (if available)</li>
                </ul>

                <h4>Email & Status Details</h4>
                <ul>
                    <li><strong>Email:</strong> Subject, direction, body preview, and open tracking stats</li>
                    <li><strong>Status:</strong> Visual from → to badge transition</li>
                </ul>

                <div class="guide-tip"><strong>Deduplication:</strong> Only the latest activity per lead per type is shown — 5 calls to one lead produce only 1 row.</div>
                <div class="guide-tip"><strong>Export:</strong> Click <strong>📥 Export CSV</strong> to download all filtered activities as a spreadsheet.</div>
            `
        });
    }

    // ── Settings (Admin only) ──
    if (role !== 'sdr') {
        sections.push({
            title: '⚙️ Settings',
            roles: ['pod_admin', 'super_admin'],
            content: `
                <div style="margin-bottom:16px;"><img src="img/guide/settings.png" alt="Settings" style="width:100%;border-radius:10px;border:1px solid var(--border-color);" loading="lazy"></div>
                <p>Settings uses a <strong>2-tab layout</strong>:</p>
                <h4>🔌 Connection Tab</h4>
                <ul>
                    <li><strong>Salesforce Connection</strong> — view status, connect/disconnect/reconnect</li>
                    <li><strong>Data Summary</strong> sidebar — lead counts by pipeline stage</li>
                </ul>
                <h4>🔄 Sync Settings Tab</h4>
                <ul>
                    <li><strong>Lead Sync Settings</strong> — sync limit, push stage, record types, sync direction</li>
                    <li><strong>POD Settings</strong> — allow SDR in multiple PODs</li>
                    <li><strong>Call & Pipeline Settings</strong> — active lead cap, max call attempts, cooldown, SF sync options</li>
                    <li><strong>Conversation Threshold (seconds)</strong> — how long a call must run to count as a real "Conversation" in Analytics (default 30s)</li>
                </ul>
                ${role === 'super_admin' ? `
                <h4>💬 Messaging Provider (RCM Conversations panel)</h4>
                <ul>
                    <li><strong>Messaging Provider</strong> — choose RCM Built-in Messaging or Aircall as the active vendor for both Sales Cadences and the RCM Widget's manual sends</li>
                    <li><strong>Aircall Number ID</strong> — required only if Aircall is selected; reuses the same Aircall API credentials already configured under Dialer settings</li>
                    <li><strong>Sandbox Test Phone Number</strong> — a real number you control. Required before the Playground's Cadence Test tab can run — see 🧪 Cadence/Messaging Sandbox below.</li>
                </ul>
                ` : ''}
                <div class="guide-note">Settings is only visible to Pod Admins and Super Admins. SDRs do not see the Settings nav item.</div>
            `
        });
    }

    // ── Cadence/Messaging Sandbox (Super Admin / Pod Admin) ───────────────────
    sections.push({
        title: '🧪 Cadence/Messaging Sandbox',
        roles: ['pod_admin', 'super_admin'],
        content: `
            <p>Test an entire Sales Cadence end-to-end — real WhatsApp/SMS sends, real provider APIs — without ever risking a real customer or polluting real reports. Found under <strong>Playground → Cadence Test</strong>.</p>
            <h4>How it works</h4>
            <ol>
                <li>Set a <strong>Sandbox Test Phone Number</strong> in Settings first (a real number you control) — the tab won't let you start without one.</li>
                <li>Pick any real, published Journey and click <strong>Create Test Lead &amp; Enroll</strong>. This creates a throwaway lead and enrolls it — no waiting for a trigger event.</li>
                <li>Click <strong>⏩ Force Next Step</strong> to advance the enrollment immediately instead of waiting out its real wait/send-window delay. Each click executes exactly one step for real and shows the provider's actual response.</li>
                <li>When you're done, <strong>🗑️ Clear All Test Data</strong> removes every test lead and its enrollments in one click.</li>
            </ol>
            <h4>The safety guarantee</h4>
            <p>A test lead's own phone field is never the real destination — <strong>every</strong> send from a test lead is redirected server-side to your configured Sandbox Test Phone Number, unconditionally. This isn't just a display filter: it's enforced at the exact point the message actually gets sent, so there's no path for a test run to reach a real lead.</p>
            <div class="guide-note">Test leads never appear anywhere in real Analytics, the SDR Performance table, CSV exports, or any activity feed — they're excluded everywhere real numbers are computed.</div>
        `
    });

    // ── APIs (Super Admin only) ───────────────────────────────────────────────
    if (role === 'super_admin') {
        sections.push({
            title: '🔌 APIs',
            roles: ['super_admin'],
            content: `
                <p>RCM exposes a secure <strong>Public API</strong> that lets external tools (like the Contract Management Tool) look up Salesforce Account or Lead records using RCM's configured SF connection — without sharing Salesforce credentials.</p>

                <div style="margin:16px 0;padding:14px 18px;background:linear-gradient(135deg,#0f172a,#1e3a5f);border-radius:12px;display:flex;align-items:center;gap:14px;">
                    <div style="font-size:2rem;">🔌</div>
                    <div>
                        <div style="font-size:0.88rem;font-weight:700;color:#fff;">Public API — CMT ↔ Salesforce Bridge</div>
                        <div style="font-size:0.75rem;color:rgba(255,255,255,0.65);margin-top:2px;">v1.0 · April 2026 · Super Admin managed</div>
                    </div>
                </div>

                <h4>🔑 Authentication</h4>
                <p>Every request must include the <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">X-API-Key</code> header. Generate the key from <strong>Settings → 🔌 Public API</strong>.</p>
                <pre style="background:#1e293b;color:#e2e8f0;padding:14px 16px;border-radius:10px;font-size:0.78rem;overflow-x:auto;line-height:1.6;">X-API-Key: rcm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</pre>
                <div class="guide-warning">Treat the key like a password — anyone with it can query your Salesforce data. Use <strong>Revoke</strong> in Settings to instantly disable access.</div>

                <h4>📋 Endpoint</h4>
                <table class="guide-table">
                    <tr><th>Property</th><th>Value</th></tr>
                    <tr><td><strong>Method</strong></td><td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">GET</code></td></tr>
                    <tr><td><strong>Path</strong></td><td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">/api/public/sf/account</code></td></tr>
                    <tr><td><strong>Auth</strong></td><td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">X-API-Key</code> header</td></tr>
                    <tr><td><strong>Format</strong></td><td>JSON</td></tr>
                </table>

                <h4>📥 Query Parameters</h4>
                <table class="guide-table">
                    <tr><th>Parameter</th><th>Required</th><th>Description</th></tr>
                    <tr><td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">rcm_messaging_id</code></td><td>Conditional*</td><td>RCM Messaging Account ID (exact match on <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">RCMMessaging_AccountId__c</code> in SF)</td></tr>
                    <tr><td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">company_name</code></td><td>Conditional*</td><td>Salesforce Account Name — exact first, then LIKE fallback</td></tr>
                </table>
                <p style="font-size:0.82rem;color:#64748b;">* At least one of the two must be provided. If both are sent, <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">rcm_messaging_id</code> takes precedence.</p>

                <h4>🔍 Lookup Logic</h4>
                <ol style="font-size:0.85rem;line-height:1.8;">
                    <li>Query <strong>Salesforce Account</strong> — exact match on <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">RCMMessaging_AccountId__c</code> or <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">Name</code></li>
                    <li>If no exact match → try <strong>LIKE search</strong> on Account Name</li>
                    <li>If still nothing → fall back to <strong>Salesforce Lead</strong> (same order)</li>
                    <li>If nothing found → returns <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">found: false</code></li>
                </ol>
                <div class="guide-note">The API always uses the SF org currently configured in RCM — no separate SF setup is needed in CMT.</div>

                <h4>📤 Example Responses</h4>
                <p><strong>Account found:</strong></p>
                <pre style="background:#1e293b;color:#e2e8f0;padding:14px 16px;border-radius:10px;font-size:0.75rem;overflow-x:auto;line-height:1.6;">{
  "found": true,
  "type": "Account",
  "sf_account_id": "001G0000010sn3FIAQ",
  "account_name": "Acme Corporation",
  "sf_url": "https://rcm-messaging.lightning.force.com/lightning/r/Account/001G0000010sn3FIAQ/view",
  "matched_by": "rcm_messaging_id",
  "confidence": "exact"
}</pre>

                <p><strong>Lead fallback:</strong></p>
                <pre style="background:#1e293b;color:#e2e8f0;padding:14px 16px;border-radius:10px;font-size:0.75rem;overflow-x:auto;line-height:1.6;">{
  "found": true,
  "type": "Lead",
  "sf_lead_id": "00QG000000abcXYZ",
  "lead_name": "John Smith",
  "company": "Acme Corp",
  "sf_url": "https://rcm-messaging.lightning.force.com/lightning/r/Lead/00QG000000abcXYZ/view",
  "note": "No Account record found. Returning matching Lead."
}</pre>

                <p><strong>Not found:</strong></p>
                <pre style="background:#1e293b;color:#e2e8f0;padding:14px 16px;border-radius:10px;font-size:0.75rem;overflow-x:auto;line-height:1.6;">{ "found": false, "message": "No Account or Lead found in Salesforce." }</pre>

                <h4>⚙️ Error Reference</h4>
                <table class="guide-table">
                    <tr><th>HTTP</th><th>Cause</th></tr>
                    <tr><td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">400</code></td><td>Neither parameter provided</td></tr>
                    <tr><td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">401</code></td><td>Missing or invalid API key</td></tr>
                    <tr><td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">503</code></td><td>Salesforce not connected in RCM</td></tr>
                </table>

                <h4>🛠️ Managing the API Key</h4>
                <ol style="font-size:0.85rem;line-height:1.8;">
                    <li>Go to <strong>Settings → 🔌 Public API</strong></li>
                    <li>Click <strong>Generate New Key</strong> — copy it immediately (shown only once)</li>
                    <li>Share it securely with the CMT team (1Password, encrypted email, etc.)</li>
                    <li>To disable access instantly → click <strong>Revoke Key</strong></li>
                </ol>
                <div class="guide-tip"><strong>Rotation:</strong> Generating a new key immediately invalidates the previous one. Update CMT before rotating.</div>

                <h4>📖 Full Documentation</h4>
                <p>The complete CMT integration guide — with cURL, Python, and JavaScript code examples — is available in <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">docs/Public_API.md</code> in the repository.</p>
            `
        });
    }

    // ── Pipeline Statuses ──
    sections.push({
        title: '🔄 Pipeline Statuses',
        roles: ['sdr', 'pod_admin', 'super_admin'],
        content: `
            <table class="guide-table">
                <tr><th>Status</th><th>Meaning</th></tr>
                <tr><td><span class="guide-badge" style="background:#e0e7ff;color:#4338ca;">Lead Assigned</span></td><td>New lead awaiting research</td></tr>
                <tr><td><span class="guide-badge" style="background:#f3e8ff;color:#7c3aed;">Research</span></td><td>SDR completing guided research</td></tr>
                <tr><td><span class="guide-badge" style="background:#dbeafe;color:#2563eb;">Calling</span></td><td>Active calling queue</td></tr>
                <tr><td><span class="guide-badge" style="background:#dcfce7;color:#15803d;">Meeting Scheduled</span></td><td>Meeting booked with the customer</td></tr>
                <tr><td><span class="guide-badge" style="background:#d1fae5;color:#065f46;">1st Discovery Meeting</span></td><td>First discovery call in progress</td></tr>
                <tr><td><span class="guide-badge" style="background:#a7f3d0;color:#047857;">Discovery Complete</span></td><td>All discovery calls done</td></tr>
                <tr><td><span class="guide-badge" style="background:#e0e7ff;color:#4338ca;">Demo Scheduled</span></td><td>Product demo call booked</td></tr>
                <tr><td><span class="guide-badge" style="background:#dbeafe;color:#1d4ed8;">Demo Done</span></td><td>Demo completed — pushed to Salesforce ✅</td></tr>
                <tr><td><span class="guide-badge" style="background:#fef3c7;color:#b45309;">Customer Declined</span></td><td>Customer declined interest — terminal ⚠️</td></tr>
                <tr><td><span class="guide-badge" style="background:#fee2e2;color:#dc2626;">Unreachable</span></td><td>Lead unreachable after multiple attempts — terminal 🔴</td></tr>
                <tr><td><span class="guide-badge" style="background:#f1f5f9;color:#475569;">Lead Unassigned</span></td><td>No SDR assigned (admin views only)</td></tr>
                <tr><td><span class="guide-badge" style="background:#fef2f2;color:#dc2626;">📵 No Phone - Parked</span></td><td>Lead has no valid phone number — quarantined from SDR assignment until a phone is added</td></tr>
            </table>
            <div class="guide-note"><strong>Terminal statuses</strong> remove the lead from active pipeline, freeing capacity. After the cooldown period, they can be recycled.</div>

            <h4 style="margin:16px 0 8px;">🏷️ Opportunity Outcome</h4>
            <p>Once a lead reaches <strong>Demo Done</strong>, it is pushed to Salesforce and becomes an opportunity. Pod Admins and Super Admins can mark the final outcome:</p>
            <table class="guide-table">
                <tr><th>Outcome</th><th>Meaning</th></tr>
                <tr><td><span class="guide-badge" style="background:#ecfdf5;color:#059669;">🎉 Won</span></td><td>Deal closed successfully</td></tr>
                <tr><td><span class="guide-badge" style="background:#fef2f2;color:#dc2626;">😔 Lost</span></td><td>Opportunity lost (admin can add reason)</td></tr>
                <tr><td><span class="guide-badge" style="background:#fffbeb;color:#b45309;">⏳ Pending</span></td><td>Awaiting outcome update from admin</td></tr>
            </table>
            <div class="guide-tip"><strong>SDRs</strong> can see the outcome on both the lead detail page and the leads table, but cannot change it.</div>
        `
    });

    // ── Tips ──
    sections.push({
        title: '💡 Tips & Best Practices',
        roles: ['sdr', 'pod_admin', 'super_admin'],
        content: role === 'sdr' ? `
            <ul>
                <li><strong>Start your day</strong> on Dashboard → work through New Leads and Research Pending first</li>
                <li><strong>Complete research</strong> before calling — the Call button unlocks after research</li>
                <li><strong>Log every call</strong> — even No Answers — so metrics and attempt tracking work</li>
                <li><strong>Watch for Unreachable warnings</strong> — mark leads as Unreachable to keep your pipeline clean</li>
                <li><strong>Drill into Performance</strong> — click your name on the Leaderboard to see your stats</li>
            </ul>
        ` : role === 'pod_admin' ? `
            <ul>
                <li><strong>Run Round Robin</strong> after each sync to distribute new leads evenly</li>
                <li><strong>Monitor your SDRs</strong> — check the Leaderboard and SDR Performance drill-downs</li>
                <li><strong>Use Assignments</strong> to manually rebalance workloads</li>
                <li><strong>Check pipeline</strong> regularly for leads stuck in one stage</li>
            </ul>
        ` : `
            <ul>
                <li><strong>Configure settings first</strong> — set Active Lead Cap, Call Attempts, and Push Stage</li>
                <li><strong>Check SF Logs</strong> after syncing to verify operations succeeded</li>
                <li><strong>Monitor SDR Performance</strong> — click names on the Leaderboard for deep analytics</li>
                <li><strong>Review terminal leads</strong> — adjust cooldown period based on team needs</li>
                <li><strong>Use POD Management</strong> to organize teams effectively</li>
            </ul>
        `
    });

    // ── Release Notes (all roles) — LAST section ──
    sections.push({
        title: '📋 What\'s New — Release Notes',
        roles: ['sdr', 'pod_admin', 'super_admin'],
        content: `
            <div style="margin-bottom:16px;">
                <p style="margin:0 0 12px 0;">Track all production updates and new features. Most recent first.</p>
            </div>

            <div class="release-entry" style="border:2px solid #6366f1;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v11.0.0</strong><span style="background:#6366f1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x2728; NEW FEATURES</span></div><span style="font-size:0.78rem;color:var(--text-muted);">14 Aug 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F9EA; Cadence/Messaging Sandbox</strong> &mdash; test an entire Sales Cadence end-to-end with real WhatsApp/SMS sends, safely. Playground's new "Cadence Test" tab lets a Super Admin or Pod Admin create a throwaway test lead, enroll it in any real published cadence, and force each step through immediately instead of waiting real days &mdash; every send is redirected to a configured Sandbox Test Phone Number, never a real lead, and test data never appears in Analytics or activity feeds.</li><li><strong>&#x2728; Aircall added as a second messaging provider</strong> &mdash; choose RCM Built-in Messaging or Aircall for Sales Cadence and Widget messaging in Settings.</li><li><strong>&#x2699;&#xFE0F; The "Conversations" threshold in Analytics is now admin-configurable</strong> (Settings &rarr; Call &amp; Pipeline Settings), instead of a fixed 30 seconds.</li><li><strong>&#x1F41B; Analytics Hub filters no longer reset when you switch tabs</strong> and the SDR Performance table's search icon is now properly centered.</li></ul></div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fef2f2,#fee2e2);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.6.37</strong><span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; PERFORMANCE</span></div><span style="font-size:0.78rem;color:var(--text-muted);">04 Aug 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x26A1; Lead detail pages and the Kanban board load faster</strong>, especially for leads with a long calling history &mdash; found while investigating yesterday's outage; the database wasn't just under-provisioned, some of these pages were also doing far more work than they needed to.</li></ul></div>
            <div class="release-entry" style="border:2px solid #6366f1;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.6.36</strong><span style="background:#6366f1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x2728; SALESFORCE SYNC</span></div><span style="font-size:0.78rem;color:var(--text-muted);">03 Aug 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x2728; Salesforce Leads now carry a lot more with them</strong> &mdash; description, SDR name, LinkedIn profile, and job title/address now populate correctly (and the SDR name/LinkedIn stay current if a lead is reassigned), instead of some being blank or silently dropped.</li></ul></div>

            <div class="release-entry" style="border:2px solid #6366f1;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.6.35</strong><span style="background:#6366f1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F6E1;&#xFE0F; HARDENING</span></div><span style="font-size:0.78rem;color:var(--text-muted);">03 Aug 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F6E1;&#xFE0F; Guarded against a rare double-recreate race</strong> for a Salesforce Lead deleted directly in Salesforce &mdash; no observed impact, a defensive fix following yesterday's recreate change.</li></ul></div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fef2f2,#fee2e2);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.6.34</strong><span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIXES</span></div><span style="font-size:0.78rem;color:var(--text-muted);">03 Aug 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F41B; A lead deleted directly in Salesforce is now actually recreated</strong>, not just unlinked &mdash; yesterday's fix cleared the stale link but didn't reliably get it back into Salesforce for a lead past its normal sync stage; it now does.</li></ul></div>

            <div class="release-entry" style="border:2px solid #6366f1;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.6.0 – v10.6.33</strong><span style="background:#6366f1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x2728; NEW FEATURES</span><span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIXES</span></div><span style="font-size:0.78rem;color:var(--text-muted);">23 Jul &ndash; 03 Aug 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F4C5; "Meeting Booked" now creates a real calendar invite</strong> &mdash; custom title, AI-drafted agenda, review-before-send, and a conflict warning.</li><li><strong>&#x2728; "Try it (Beta)" Leads experience is now open to every role</strong> &mdash; priority-sorted lists, phone-research gating, and quick-call for SDR/AE/Sales, plus column customization and bulk approve/reject on Disqualify Requests.</li><li><strong>&#x1F4DE; Fixed Klenty calls being silently dropped or misdated</strong> across sync, Connect Rate, the Inactive-SDR flag, and Analytics Hub reporting &mdash; plus an admin-triggerable backfill to recover any gap.</li><li><strong>&#x1F41B; Fixed SDR/AE being unable to see any leads at all</strong> on the redesigned Leads page, and several Analytics Hub filters/charts that were silently ignoring your selections (SDR, Lead Source, date range).</li><li><strong>&#x1F41B; A lead deleted directly in Salesforce now gets recreated automatically</strong>, and sync failures are now always visible and searchable in the Sync Logs page.</li><li><strong>&#x1F3A8; A large batch of design-system and usability fixes</strong> across the redesigned Leads page and Analytics Hub &mdash; invisible button text, broken filters, unclickable toggles, and native browser popups replaced with the app's own dialogs.</li><li><strong>&#x1F9EA; A rebuilt Call/Message widget is being tested internally</strong>, off by default &mdash; no change to your current experience yet.</li></ul></div>
            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fef2f2,#fee2e2);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.5.9</strong><span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIXES</span></div><span style="font-size:0.78rem;color:var(--text-muted);">22 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F4DE; Fixed US phone numbers being misdialed as Indian numbers</strong> in Aircall and RCM &mdash; a bare 10-digit number starting with 6&ndash;9 was incorrectly assumed to be Indian and dialed with a +91 prefix instead of +1.</li></ul></div>
            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fef2f2,#fee2e2);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.5.8</strong><span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIXES</span></div><span style="font-size:0.78rem;color:var(--text-muted);">22 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F4CA; Fixed a negative "Calls Made" count on Analytics Hub</strong> for some batch filters &mdash; an internal de-duplication count wasn't scoped to the selected batch.</li><li><strong>&#x1F3A7; Call recordings longer than 30 seconds no longer cut off mid-playback</strong> in Call Monitor.</li></ul></div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fef2f2,#fee2e2);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.5.7</strong><span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIXES</span></div><span style="font-size:0.78rem;color:var(--text-muted);">22 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F41B; Klenty integration health check fixed:</strong> The Klenty connection test was failing with "Invalid user: whoami" &mdash; it now tests against your real Klenty username.</li><li><strong>&#x1F4DD; Call transcripts now show up everywhere:</strong> Once RCM/Deepgram finishes processing a call, the transcript now appears on Call Monitor, the Lead's Calls tab, and the Activity Feed &mdash; previously it silently never rendered anywhere even when it was ready.</li><li><strong>&#x1F5E3;&#xFE0F; Transcript speakers now labeled "Speaker 1" / "Speaker 2"</strong> instead of raw "Speaker 0" / "Speaker 1".</li></ul></div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fef2f2,#fee2e2);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.5.6</strong><span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIXES</span></div><span style="font-size:0.78rem;color:var(--text-muted);">22 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F4DE; Dialer no longer gets stuck on "connecting call":</strong> A widget glitch could previously block every future call attempt until a hard refresh. Fixed with a timeout and proper error handling.</li><li><strong>&#x1F4F6; Dialer widget no longer disappears mid-call on a brief network blip</strong> (Browser Call mode) &mdash; it now waits a few seconds to see if the connection recovers on its own before ending the call.</li></ul></div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fef2f2,#fee2e2);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.5.5</strong><span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIXES</span></div><span style="font-size:0.78rem;color:var(--text-muted);">22 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F41B; Disqualify now respects dialer-logged outcomes:</strong> A lead marked "Wrong Number" (or another definitive outcome) through the in-app dialer can now be disqualified right away, without needing 5 call attempts first, and the lead page shows the correct latest disposition.</li><li><strong>&#x1F9E0; AI Research panel fixed for shared companies:</strong> Switching between two contacts at the same company no longer shows the previous contact's research.</li><li><strong>&#x1F4CA; Analytics Hub "Calls Made" now respects the batch filter</strong> the same way every other number on the page already did.</li><li><strong>&#x260E;&#xFE0F; Fixed some SDRs' calls failing with a RCM "Agent phone number is required" error</strong> &mdash; per-SDR dialer identity is now actually used when placing calls.</li><li><strong>&#x1F3A7; Call recordings: fixed "Play" failing right after a call, playback cutting off mid-recording, and a squeezed/broken player layout in Call Monitor.</strong> Every call-recording view (Call Monitor, Lead Detail, My Calls, Activity Feed) now has a working Download option too.</li><li><strong>&#x2699;&#xFE0F; Settings no longer bounces back to the Connection tab</strong> after saving a change in any other tab.</li><li><strong>&#x1F4DE; The active-call popup no longer blurs the lead details behind it.</strong></li></ul></div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fef2f2,#fee2e2);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.5.3</strong><span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; ANALYTICS FIX</span></div><span style="font-size:0.78rem;color:var(--text-muted);">21 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F41B; Fixed unreliable Analytics Hub batch filter:</strong> Selecting a batch could show "No lead data" even when the batch had leads, and the batch dropdown wasn't scoped to the selected POD/date range. Both are now fixed &mdash; batches link to leads via a real database ID instead of a filename guess, and the dropdown only ever shows batches that actually have data.</li></ul></div>
            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fef2f2,#fee2e2);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.5.2</strong><span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; SYNC FIX</span></div><span style="font-size:0.78rem;color:var(--text-muted);">20 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F41B; Fixed duplicate Salesforce leads:</strong> The same contact could get pushed to Salesforce as a new Lead on every sync. Fixed a batch-sync bug that silently lost track of successful Salesforce links, and added duplicate detection to the "New Lead" button (already present for CSV/Sheet imports).</li></ul></div>
            <div class="release-entry" style="border:2px solid #2563eb;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#eff6ff,#dbeafe);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.5.1</strong><span style="background:#2563eb;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F504; SYNC</span></div><span style="font-size:0.78rem;color:var(--text-muted);">20 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F504; Salesforce sync can now run automatically:</strong> Settings &rarr; Sync Settings has a new "Auto-Sync Schedule" toggle &mdash; pick a daily UTC time and the sync runs on its own, on top of the existing manual "Sync Salesforce" button.</li></ul></div>
            <div class="release-entry" style="border:2px solid #059669;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#ecfdf5,#d1fae5);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.5.0</strong><span style="background:#059669;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F4DE; CALLS</span></div><span style="font-size:0.78rem;color:var(--text-muted);">17 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F4DE; Klenty call activity now syncs into RCM:</strong> Calls SDRs place through Klenty now pull in automatically each night and show up as call activity, matched to the right lead (or a new lead created if none exists). Admin-only setting, no changes for SDRs.</li></ul></div>
            <div class="release-entry" style="border:2px solid #d97706;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fffbeb,#fef3c7);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.4.9</strong><span style="background:#d97706;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F4C5; CALENDAR</span></div><span style="font-size:0.78rem;color:var(--text-muted);">17 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F4C5; Calendar meeting times fixed:</strong> Meetings were showing on the day they were logged instead of the actual scheduled time. The real date/time you enter when confirming a meeting is now saved and shown correctly.</li></ul></div>
            <div class="release-entry" style="border:2px solid #7c3aed;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#faf5ff,#ede9fe);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.4.8</strong><span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F4CA; ANALYTICS</span></div><span style="font-size:0.78rem;color:var(--text-muted);">17 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F4CA; Connect Rate fixed:</strong> Connect Rate was showing 0% across the Analytics Hub, CSV export, Batch Summary, and Ask AI — it was checking for a call status that real calls never use. It now reflects real answered-call outcomes everywhere those numbers appear.</li><li><strong>&#x1F4C4; CSV export now matches the dashboard:</strong> Exporting SDR performance was missing most calls (Aircall/Klenty/RCM activity wasn't included) and used a different Connect Rate formula than the dashboard. Export now shows the same numbers you see on screen.</li><li><strong>&#x1F50D; Source filter now works on the SDR Table:</strong> Filtering SDR performance by lead source was silently being ignored — it now actually filters.</li></ul></div>
            <div class="release-entry" style="border:2px solid #16a34a;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.4.7</strong><span style="background:#16a34a;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F3AF; LEADS</span><span style="background:#0891b2;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F3A7; CALLS</span></div><span style="font-size:0.78rem;color:var(--text-muted);">16 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F3AF; Leads Hub (Beta):</strong> A redesigned All Leads experience is available to try — multi-select filters, tags, saved views, bulk and single reassignment, inline editing, a note preview per lead, and Disqualify Requests built in. Look for "Try it (Beta)" at the top of the Leads page — your classic view is unchanged until you opt in, and you can switch back anytime.</li><li><strong>&#x1F3A7; RCM call recordings fixed:</strong> Recordings were failing to appear for some SDRs when RCM's own status check had a temporary issue — recordings are no longer blocked by that unrelated check.</li></ul></div>
            <div class="release-entry" style="border:2px solid #0891b2;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#ecfeff,#cffafe);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.4.6</strong><span style="background:#0891b2;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F3A7; CALLS</span></div><span style="font-size:0.78rem;color:var(--text-muted);">16 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F3A7; Manual Dial (RCM) no longer shows two call widgets:</strong> Dialling a number directly from the Manual Dial button could show a duplicate call panel and sometimes fail to show that the call had been answered. Manual Dial now uses the same reliable call manager as calling a lead directly.</li></ul></div>
            <div class="release-entry" style="border:2px solid #0891b2;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#ecfeff,#cffafe);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.4.4</strong><span style="background:#0891b2;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F3A7; CALLS</span></div><span style="font-size:0.78rem;color:var(--text-muted);">15 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F3A7; Call recordings no longer go dead:</strong> Playing an older call recording (on a lead's Calls tab, My Calls, Activity Feed, or the Calls page) now automatically fetches a fresh link if the saved one has expired, instead of just failing to play.</li></ul></div>
            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fef2f2,#fee2e2);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.4.3</strong><span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F6AB; DISQUALIFY</span></div><span style="font-size:0.78rem;color:var(--text-muted);">14 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F6AB; Request Disqualify (SDR/AE):</strong> A "Disqualify Account" button now appears on each company in the Leads view — submit a reason and a Pod Admin will review it.</li><li><strong>&#x2705; Disqualify Requests screen (Pod Admin/Super Admin):</strong> New sidebar item to review, approve, or reject pending disqualify requests from your team.</li></ul></div>

            <div class="release-entry" style="border:2px solid #4338ca;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.4.2</strong><span style="background:#4338ca;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F4C5; CALENDAR</span></div><span style="font-size:0.78rem;color:var(--text-muted);">14 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F3A8; Visual polish:</strong> Fixed missing grid borders and tightened up the overall look.</li><li><strong>&#x1F553; Live clock:</strong> Current time and timezone now shown in the Calendar header.</li><li><strong>&#x1F4CB; Meeting details panel:</strong> Clicking a meeting now opens a details panel (name, company, phone, time) with a "Go to lead" button, instead of navigating away immediately — so you don't lose your place on the calendar.</li></ul></div>

            <div class="release-entry" style="border:2px solid #4338ca;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.4.1</strong><span style="background:#4338ca;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F4C5; CALENDAR</span></div><span style="font-size:0.78rem;color:var(--text-muted);">14 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F4C5; Day/Week/Month/List views:</strong> Calendar now has Today, Week, and Month views plus a List toggle, not just a single month grid.</li><li><strong>&#x1F517; Click a meeting to open the lead:</strong> Every meeting on the Calendar now links straight to that lead's detail page.</li></ul></div>

            <div class="release-entry" style="border:2px solid #0891b2;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#ecfeff,#cffafe);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.4.0</strong><span style="background:#0891b2;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F4C5; CALENDAR</span><span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x2705; DISQUALIFY</span></div><span style="font-size:0.78rem;color:var(--text-muted);">13 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F514; Bell notifications fixed:</strong> Task reminders stopped appearing for every SDR/AE after the topbar was rebuilt in React on 18 Jun — the bell is back and working.</li><li><strong>&#x1F4C5; Unified Calendar:</strong> A new Calendar page shows every scheduled meeting on one month view — your own for SDRs/AEs, your pod's for Pod Admins, everyone's for Super Admins. Find it in the left sidebar.</li><li><strong>&#x2705; Account Disqualify (maker-checker):</strong> AEs/SDRs can now request disqualifying every lead under an account that turns out not to be the right ICP fit. A Pod Admin reviews and approves or rejects the request before any leads are actually disqualified — no single person can bulk-disqualify a large lead set alone.</li><li><strong>&#x1F4CA; Analytics custom date range fixed:</strong> Picking a custom date range in Analytics was silently falling back to the last 30 days. Custom ranges now apply correctly everywhere.</li></ul></div>

            <div class="release-entry" style="border:2px solid #0369a1;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#eff6ff,#dbeafe);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.3.0</strong><span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F465; POD ADMINS</span><span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F4CA; ANALYTICS</span></div><span style="font-size:0.78rem;color:var(--text-muted);">8 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F465; Multiple Pod Admins per pod:</strong> A pod can now have more than one Pod Admin. Super Admins can add and remove Pod Admins directly from the Pods page — each pod shows a dedicated &quot;Pod Admins&quot; section with individual remove buttons and an &quot;Add Pod Admin&quot; dropdown. When a Pod Admin is removed and has no other pods, their role automatically reverts to SDR.</li><li><strong>&#x1F4CA; Analytics: Account-level Connect % (Acct Connect %):</strong> The SDR Performance table now shows a new &quot;Acct Connect %&quot; column. Instead of counting individual lead calls, it counts distinct companies contacted and connected — so if an SDR reaches one person at &quot;Acme Corp&quot; (which has 3 contacts in the system), that counts as 1 company connected. This gives a truer picture of account-level outreach success.</li></ul></div>

            <div class="release-entry" style="border:2px solid #6366f1;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.2.0</strong><span style="background:#6366f1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x2728; UX</span><span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F4F1; MOBILE</span></div><span style="font-size:0.78rem;color:var(--text-muted);">7 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x2194; Sidebar collapse now expands your workspace:</strong> When you collapse the left sidebar, the main content area now grows to fill the freed space — giving you ~148px of extra screen width. Previously the sidebar container reserved that space even when collapsed, wasting screen real estate.</li><li><strong>&#x1F4F1; Login screen works on mobile — portrait &amp; landscape:</strong> The login page is now fully responsive on phones in both orientations. Portrait: compact brand strip at the top with the login form centred below. Landscape: brand panel and login form sit side-by-side in a compressed layout. The three feature cards (Lead Enrichment, Smart Deduplication, SDR Prioritization) remain visible in both orientations via a horizontal swipe row.</li></ul></div>


            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff5f5,#fee2e2);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.1.0</strong><span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F6E1; STABILITY</span><span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x26A1; PERFORMANCE</span></div><span style="font-size:0.78rem;color:var(--text-muted);">7 Jul 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F9F9; Memory leak fixed — no more surprise restarts:</strong> The server was restarting every 4-8 days due to a memory leak in the RCM background sync. The nightly sync now retries failed API pages with backoff and automatically force-closes any call stuck in a non-terminal state for over 24 hours. This was the root cause of 3 forced server restarts since June 18.</li><li><strong>&#x1F50C; Zombie call pollers eliminated:</strong> When RCM returned "Call not found" (404) for a stale call, the browser kept polling every 2 seconds forever — silently accumulating in the background. Those polls now terminate immediately on 404, freeing resources.</li><li><strong>&#x26A1; Webhook response time: 1.4-2.3s → &lt;50ms:</strong> RCM webhook events were taking up to 2.3 seconds to process synchronously. They now return immediately — processing runs in the background. This prevents RCM from sending duplicate events when our server is slow.</li><li><strong>&#x1F4CA; Error logs page loads faster:</strong> The error log summary was running 4 separate database scans on every page load (1.5–3.6s). A new database index cuts this to ~50ms.</li><li><strong>&#x1F527; Ankit Bakshi can now dial:</strong> His dialer access was disabled in the system despite having valid RCM credentials. Fixed — he can now make calls.</li><li><strong>&#x1F41B; Assignments panel crash fixed:</strong> Rapidly switching away from the Assignments panel while it was still loading could crash the page with a "Cannot read properties of null" error (Diwakar Varadharajan reported this). Fixed with defensive null guards.</li></ul></div>


            <div class="release-entry" style="border:2px solid #d97706;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fffbeb,#fef3c7);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v10.0.0</strong><span style="background:#d97706;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x26A1; MAJOR RELEASE</span><span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F680; PERFORMANCE</span></div><span style="font-size:0.78rem;color:var(--text-muted);">18 Jun 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F527; Topbar buttons fully fixed:</strong> New Lead, Dial, Search (⌘K), and Ask AI were all broken after the NavHub React migration. All four are now re-wired with correct event bridging — every action works as expected.</li><li><strong>&#x2728; Ask AI rebuilt as React overlay:</strong> The Ask AI feature now opens as a proper full-screen overlay with smooth animation. Results render correctly with charts and live data — the previous blank panel bug is fixed.</li><li><strong>&#x1F4CA; Mixpanel analytics hardened:</strong> Fixed double-initialisation bug that was causing duplicate events. Added 14 new tracked events covering search, Ask AI, dashboard KPI clicks, and topbar actions.</li><li><strong>&#x1F4F1; Dashboard now responsive:</strong> The dashboard layout adapts to tablet and phone screen sizes. The login page was also made fully responsive in v9.7.12.</li><li><strong>&#x26A1; Dashboard load time: 2,051ms → ~1,600ms:</strong> Eliminated ForcedReflow, reduced layout shifts (CLS 0.52 → target ~0.04), and deferred Clarity.js to 2.8s so it no longer blocks page paint.</li><li><strong>&#x1F4B0; Shimmer skeleton replaces "Loading...":</strong> The plain "Loading..." text on first load is replaced by an animated shimmer skeleton that mirrors the real dashboard layout — giving instant visual feedback while data loads.</li><li><strong>&#x1F3D7; Structural CLS fix:</strong> Eliminated the dual-skeleton architecture that caused a 0.26 CLS shift. The React mount point now exists in HTML from parse time with its height pre-reserved — no layout shift when real content mounts.</li></ul></div>

            <div class="release-entry" style="border:2px solid #16a34a;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v9.8.0</strong><span style="background:#16a34a;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F6E0; Architecture</span></div><span style="font-size:0.78rem;color:var(--text-muted);">18 Jun 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F9F1; React sidebar &amp; topbar (NavHub):</strong> The sidebar and topbar are now powered by a React bundle — the same architecture used by the Dashboard and Analytics Hub. Role-based navigation, collapse state, tooltips, and the logout button are all handled in React. All action buttons (Dial, Sync SF, New Lead, Ask AI) are preserved and bridged back to the app.</li><li><strong>&#x1F511; Logout always visible:</strong> The sign-out button is now permanently visible in both expanded and collapsed sidebar states — it can no longer disappear.</li></ul></div>


            <div class="release-entry" style="border:2px solid #6366f1;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:8px;"><strong style="font-size:0.95rem;">v9.7.12</strong><span style="background:#6366f1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x2728; UX</span></div><span style="font-size:0.78rem;color:var(--text-muted);">18 Jun 2026</span></div><ul style="margin:0;padding-left:18px;font-size:0.83rem;"><li><strong>&#x1F4F1; Login page now mobile-responsive:</strong> The login screen now works correctly on phones and tablets. On tablet (≤768px) the brand panel becomes a compact header and the login form fills the screen below. On phone (≤480px) the brand panel condenses to logo-only and the full login form is shown — no more zooming or horizontal scrolling needed.</li></ul></div>


            <div class="release-entry" style="border:2px solid #0ea5e9;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f0f9ff,#e0f2fe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.7.11</strong>
                        <span style="background:#0ea5e9;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x2728; UX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">18 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4AC; Sidebar icon tooltips now work:</strong> When the sidebar is collapsed to icon-only view, hovering over any icon now shows a label tooltip to its right. Previously the tooltip was rendered but silently clipped by the browser — now fixed using a floating label that appears correctly above everything else on screen.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #0ea5e9;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f0f9ff,#e0f2fe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.7.10</strong>
                        <span style="background:#0ea5e9;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x2728; UX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">18 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4CB; POD Management icon updated:</strong> The POD Management sidebar icon was identical to the Leads icon (both showed a &ldquo;two people&rdquo; symbol). POD Management now uses a distinct 2&times;2 grid icon — clearly communicating &ldquo;teams / groups&rdquo; at a glance and eliminating the visual confusion.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff1f2,#fee2e2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.7.9</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIX</span>
                        <span style="background:#b45309;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x26A1; PERFORMANCE</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">18 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4DE; Calls tab: faster load, no more background noise:</strong> Opening the Calls tab was silently firing one RCM API request per historical call record. When RCM returned errors for old calls these piled up in server logs and could slow the tab. The background refresh now only runs when data is actually missing — completed calls that already have their recording, duration, and end time are skipped entirely. No user-visible change; everything loads the same, just faster.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #7c3aed;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.7.8</strong>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F4DA; INTERNAL</span>
                        <span style="background:#475569;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">Admin only</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">18 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4D6; Technical Handoff Bible published:</strong> A comprehensive internal reference page is now live at <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">/technicalunderstanding.html</code> (Admin/Super Admin only). Covers full architecture, environment variables, all integrations, deployment runbook, incident playbooks, rollback procedure, database migration system, scheduler jobs, and AI agent rules — everything needed to onboard or troubleshoot from one URL.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff1f2,#fee2e2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.7.7</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIX</span>
                        <span style="background:#b45309;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F4AA; RELIABILITY</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">17 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4A5; Fixed: server crash (OOM) after Dashboard migration to React:</strong> The production server was running out of memory and restarting. Root cause: the new React Dashboard was firing 7 API calls simultaneously the moment it opened — including a heavy Groq AI call. These have been staggered (200–800ms apart) so they no longer pile on the server at once. Dashboard still loads fully; data just fills in smoothly.</li>
                    <li><strong>&#x1F4BE; Fixed: pipeline intelligence memory leak:</strong> The Groq AI pipeline scoring cache had no size limit — it stored one entry per user and never cleaned up. It now uses the same managed cache as the rest of the app, with Redis backing and automatic 15-minute expiry.</li>
                    <li><strong>&#x26A1; Dashboard load speed unchanged:</strong> The staggered loading is barely noticeable — skeletons appear immediately, and the data cards fill in within 1 second of each other. The overall time-to-complete is the same as before.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #5B50E8;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.7.4</strong>
                        <span style="background:#5B50E8;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x2728; FEATURE</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F4CA; ANALYTICS</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">16 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4CA; Mixpanel analytics enabled:</strong> Full product analytics are now live — session recording, autocapture, and 16 custom events tracking key actions (Lead Viewed, Call Logged, Leads Filtered, Status Changed, etc.).</li>
                    <li><strong>&#x1F4F9; Microsoft Clarity enabled:</strong> Session heatmaps and recordings are now active across all pages (login + dashboard).</li>
                    <li><strong>&#x1F50D; Outcome cards now tracked:</strong> Clicking a call outcome card on the dashboard fires a tracked event with the outcome type and count.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff1f2,#fee2e2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.7.3</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">16 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4DE; SDR Dashboard: Today's calls count now correct:</strong> Calls made via RCM or Aircall (dialer) were not being counted in the "Calls Today" and "Outcomes Today" dashboard cards. Fixed — both manual and dialer calls are now included.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff1f2,#fee2e2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.7.0</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIX</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F6E1; HARDENING</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">16 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F510; View-As now shows correct data for all roles:</strong> When a Super Admin used View-As to impersonate an SDR or Pod Admin, the Dashboard was still showing the admin's own data (all leads). Fixed — View-As now correctly scopes data to the impersonated user's role and pod.</li>
                    <li><strong>&#x1F4CB; Sidebar: logo-only when collapsed:</strong> Collapsing the sidebar now shows only the RCM logo icon — the "Powered by RCM" text no longer bleeds through.</li>
                    <li><strong>&#x1F310; Pod Admin toggle: repositioned + new icons:</strong> The My Pod / Global scope toggle is now grouped with the Refresh button on the right side of the dashboard header. Lock and globe SVG icons replace the previous emojis. Toggle always defaults to My Pod on page load.</li>
                    <li><strong>&#x1F4DE; Dialer: zombie call blocking fixed:</strong> SDRs who got stuck in an "active call" block after a silent hangup will now see a purple Force Clear banner — one click to unblock. The stuck-call timeout has also been reduced from 90 minutes to 15 minutes.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #5B50E8;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.6.0</strong>
                        <span style="background:#5B50E8;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x2728; FEATURE</span>
                        <span style="background:#16a34a;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F3A8; BRAND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">16 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4CA; Dashboard: Role-based views properly applied:</strong> SDR and AE users now see only their personal KPIs and call outcomes — the Meetings Booked chart (which required admin access) is removed. Pod Admins retain the full chart and pipeline view.</li>
                    <li><strong>&#x1F517; Call Outcomes are now clickable:</strong> Click any outcome card (e.g. "Connected 3") to jump directly to the Leads view filtered by that outcome. Zero-count outcomes are hidden to keep the view clean.</li>
                    <li><strong>&#x1F510; Pod Admin: My Pod / Global toggle:</strong> Pod Admins can now switch between their pod's data and org-wide data with a single click in the dashboard header. The selected scope is remembered as you navigate.</li>
                    <li><strong>&#x1F3A8; RCM brand update:</strong> New logo is now live across the browser tab (favicon), Apple home screen icon, sidebar, and login page.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff1f2,#fee2e2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.5.7</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIX</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">Admin only</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">15 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F3AE; Fixed: Dialer Playground now tests credentials from the form:</strong> The Playground was incorrectly using the admin's own CRM dialer profile instead of the API Key, User ID, and From Number entered in Step 2. Test calls now use the form credentials directly — no profile configuration needed to run Playground tests.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #7c3aed;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.5.6</strong>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x2728; FEATURE</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">Admin only</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">15 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x2699;&#xFE0F; Admin Panel: Dialer Override now available for all roles:</strong> Super Admins and Pod Admins now have the same "Dialer Override" dropdown in Admin → Users as SDRs do. Previously this required a direct database update. Change takes effect immediately — no re-login needed.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff1f2,#fee2e2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.5.5</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIX</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">Admin only</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">15 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F3AE; Fixed: Dialer Playground crash on Step 3:</strong> The Playground would crash with "RCMDialer.mount is not a function" when advancing to the Live Test step, making it completely unusable. It now calls the CRM dialer API directly and tracks call status in the event log — no page refresh needed.</li>
                </ul>
            </div>


            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff1f2,#fee2e2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.5.4</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">15 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4DE; Fixed: "active call in progress" error no longer blocks you permanently:</strong> If a RCM call ended on the network but our system didn't receive the disconnect signal, the dialer would show "You already have an active call in progress" with no way out. It now automatically clears the stuck call and shows "✅ Cleared a stuck call. Please try calling again." — no page refresh needed.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff1f2,#fee2e2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.5.3</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">15 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x2699;&#xFE0F; Settings — Test Connection banner fix:</strong> After clicking "Test Connection" in the Dialer or RCM settings, the result banner (success or error) now clears automatically as soon as you edit any credential field. Previously the banner stayed on screen even after you had changed credentials, which was misleading.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff1f2,#fee2e2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.5.2</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">15 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4DE; Fixed intermittent crash when using the RCM widget:</strong> Some SDRs were seeing an "An unexpected JavaScript error occurred" notification while working in the app — particularly when switching tabs or using the messaging widget. This was caused by the widget trying to update itself before it had finished loading. The widget now safely ignores these early calls and the errors are gone.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #16a34a;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.5.1</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; HOTFIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">12 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4DE; Bridge mode now works correctly:</strong> When an SDR selected "Phone Bridge", RCM wasn't told it was a bridge call — so it wasn't ringing the agent's phone first. Fixed: the call mode is now correctly passed so bridge calls ring your phone before connecting to the lead.</li>
                    <li><strong>&#x2705; Caller ID format no longer assumed:</strong> Different telecom providers (Tata, Airtel, etc.) store outbound phone numbers in different formats. We were incorrectly converting the DID, causing a "Invalid from_number" error. Now the DID is sent exactly as configured in Settings — no guessing.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #16a34a;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.5.0</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; HOTFIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">12 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4DE; RCM calls now actually connect:</strong> Clicking the Call button was loading the spinner and then silently failing — the call never went through to the lead's phone. The root cause was a mismatch between what our system was sending to RCM's servers and what RCM actually expects. After testing directly against the live RCM API, the exact required format was confirmed and fixed. Calls now connect reliably on the first try.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff1f2,#fee2e2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.4.4</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">11 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F3A7; Browser call now shows a clear error if audio setup fails:</strong> When you selected "Browser Call" and RCM's servers were temporarily unavailable, the dialer used to freeze at "Ringing…" with no explanation. Now it immediately shows a clear message — "RCM did not return audio credentials — try again or switch to Phone Bridge" — and the dialer resets so you can try again right away.</li>
                    <li><strong>&#x1F3A7; Browser call now shows what to expect while ringing:</strong> The call widget now shows "🎧 Lead's phone is ringing — you'll hear them when they answer" so you know the call is in progress and don't need to do anything else.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #7c3aed;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#faf5ff,#ede9fe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.4.3</strong>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F527; IMPROVEMENT</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">11 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4F1; Bridge call now tells you what to do:</strong> When you place a call using "Phone Bridge", the dialer widget now shows a pulsing hint — "📱 Your phone will ring — answer it to connect" — so you always know to pick up your handset first before the lead is dialled. Previously it just showed "Ringing…" with no guidance.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff1f2,#fee2e2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.4.2</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">11 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4DE; RCM dialer widget is now fully visible:</strong> The call widget (showing lead name, phone, Mute / Hold / End buttons) was rendering with white text on a white background — completely invisible. Now displayed correctly with the dark-theme design it was intended to use.</li>
                    <li><strong>&#x1F3AE; Admin Dialer Playground re-enabled:</strong> Super Admins can once again access the Dialer Playground from the sidebar to test outbound calls without touching a real lead record.</li>
                    <li><strong>&#x1F4DE; Aircall call durations now heal automatically:</strong> Calls where Aircall's webhook arrived before the billing data was finalised (showing 0s duration) will now be corrected automatically during the nightly sync.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff1f2,#fee2e2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.4.1</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">11 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4DE; Call timer now starts when the lead picks up (Bridge mode):</strong> In Phone Bridge mode, the call timer was not starting when the lead answered. The timer now starts correctly the moment the lead picks up.</li>
                    <li><strong>&#x23F1;&#xFE0F; Dialler no longer gets silently locked after pressing Cancel:</strong> If you opened the mode selector (Phone Bridge / Browser Call) and then pressed Cancel without making a call, the dialler was silently blocked for the rest of your session — you could not dial anyone until you refreshed the page. This is now fixed.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #7c3aed;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#faf5ff,#ede9fe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.4.0</strong>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F527; IMPROVEMENT</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">11 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4DE; RCM dialer no longer gets stuck after a call ends:</strong> After ending a RCM call, the dialer was sometimes freezing or going blank, requiring a full page refresh before you could dial the next lead. This has been fixed — the dialer now resets itself cleanly after every call so you can dial the next lead immediately.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff1f2,#fee2e2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.3.1</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; HOTFIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">11 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4DE; Call outcome modal no longer appears on a failed dial:</strong> If your Aircall Desktop app was closed or your status was not set to Available, clicking the dial button was incorrectly showing the "Did the call connect?" logging form immediately. The call never went through, so there was nothing to log. This is now fixed — a clear error message appears instead, and the logging form only opens after a real call ends.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #16a34a;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.3.0</strong>
                        <span style="background:#16a34a;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F41B; BUG FIXES</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">10 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4DE; Aircall call durations fixed:</strong> Call durations were showing as 0s for all Aircall calls. The system was blocking the real duration from being saved when the call ended. Fixed &mdash; new calls will now show correct durations.</li>
                    <li><strong>&#x1F4CA; Analytics trend now filters by SDR:</strong> Selecting an SDR in the Activity Trend chart was filtering calls, emails, and meetings &mdash; but the Research line stayed the same. Research now correctly filters by SDR.</li>
                    <li><strong>&#x1F4C5; Duplicate dates on trend chart fixed:</strong> The trend chart was sometimes showing the same date twice on the X-axis. Fixed by normalising timezone-aware and timezone-naive timestamps.</li>
                    <li><strong>&#x1F4CB; Dashboard card updated:</strong> The &ldquo;Research&rdquo; card on the admin dashboard has been replaced with &ldquo;Demo Scheduled&rdquo; &mdash; a more meaningful pipeline metric.</li>
                    <li><strong>&#x1F4C4; SDR table now paginates at 7:</strong> The SDR Performance table now shows 7 SDRs per page with pagination controls, instead of showing all SDRs on one page.</li>
                    <li><strong>&#x1F527; Duplicate lead source filter fixed:</strong> The lead source dropdown in Analytics was showing &ldquo;Uploaded&rdquo; twice. Duplicates are now removed automatically.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #0d9488;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f0fdfa,#ccfbf1);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.2.0</strong>
                        <span style="background:#0d9488;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x26A1; PERFORMANCE</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">10 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4E6; Smaller, faster responses:</strong> All API responses are now compressed before sending — pages load faster, especially for users in India connecting to US servers.</li>
                    <li><strong>&#x26A1; Instant repeat page loads:</strong> When you navigate back to a page you recently visited, it now loads instantly from your browser cache while fresh data loads in the background.</li>
                    <li><strong>&#x1F9E0; Smarter memory usage:</strong> Lead list pages now load only the data they need instead of pulling everything from the database. App uses less memory and responds faster.</li>
                    <li><strong>&#x1F4CA; Cache monitoring:</strong> Admins can now see the cache backend status (Redis vs in-memory) in the monitoring health endpoint.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #2563eb;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#eff6ff,#dbeafe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.1.0</strong>
                        <span style="background:#2563eb;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x26A1; PERFORMANCE</span>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F680; INFRASTRUCTURE</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">10 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F680; Faster after deployments:</strong> App data now persists in a shared cache (Redis) that survives server restarts and deployments. You should no longer experience slow loads right after an update goes live.</li>
                    <li><strong>&#x1F6E1;&#xFE0F; Rock-solid reliability:</strong> If the cache layer ever has an issue, the app automatically falls back to its built-in cache — no errors, no downtime, completely transparent.</li>
                    <li><strong>&#x1F465; Better for concurrent usage:</strong> All team members now share the same cache. When one person loads a page, the data is warm for everyone else — no more redundant database hits.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #059669;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#ecfdf5,#d1fae5);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.0.1</strong>
                        <span style="background:#059669;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x26A1; PERFORMANCE</span>
                        <span style="background:#0891b2;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F527; HARDENING</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">10 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x26A1; Faster page loads across the board:</strong> Under-the-hood performance improvements significantly reduce load times for the Users list, Leaderboard, Dashboard stats, and Call Logs — especially noticeable when multiple team members are using the app at the same time.</li>
                    <li><strong>&#x1F6E1;&#xFE0F; Smarter caching:</strong> The app now prevents multiple simultaneous requests from triggering redundant database queries when the cache refreshes. This eliminates the occasional slow-load spike you may have seen right after a deployment.</li>
                    <li><strong>&#x1F4CA; Dashboard loads with one query instead of two:</strong> The pipeline status counts and parked lead count are now computed in a single database pass, reducing dashboard load time.</li>
                    <li><strong>&#x1F4DE; Call Logs optimised:</strong> The call log page now uses a more efficient query pattern — no more extra round-trips to fetch the user list before loading calls.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:2px solid #7c3aed;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v9.0.0</strong>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F465; FULL POD SCOPING</span>
                        <span style="background:#0891b2;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F527; MAJOR</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">09 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F512; Dashboard — My Pod / Global toggle (Pod Admins only):</strong> The main dashboard now shows pod-scoped stats, leaderboard widget, and activity feed by default. A new <em>&#x1F512; My Pod / &#x1F310; Global</em> toggle pill in the header lets you switch instantly — your preference is saved for the session.</li>
                    <li><strong>&#x1F3C6; Leaderboard — pod-scoped by default:</strong> Pod Admins see only their pod's SDRs and AEs on the Leaderboard page. The same toggle pill lets you switch to the global view to see the full org ranking.</li>
                    <li><strong>&#x1F4E1; Activity Feed — pod-scoped by default:</strong> The full Activity Feed page now filters to your pod's calls, emails, and status changes by default. Use the toggle to switch to org-wide view when needed.</li>
                    <li><strong>&#x1F4C8; Analytics Metrics — always pod-scoped:</strong> Summary, daily trend, and SDR performance metrics in the Analytics Hub are automatically scoped to your pod — no toggle needed.</li>
                    <li><strong>&#x1F4EC; Daily Digest — always pod-scoped:</strong> The daily digest email and digest panel now shows only your pod's SDRs, new leads, and stuck leads. Super Admins continue to see org-wide data.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #4f46e5;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.9.11</strong>
                        <span style="background:#4f46e5;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F465; POD SCOPING</span>
                        <span style="background:#0891b2;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x1F527; UX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">09 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F512; Pod Admins now see only their pod's leads:</strong> Pod Admins were previously seeing all leads org-wide, which made it difficult to manage their own pipeline. Leads are now scoped to your pod — you see leads assigned to your SDRs or tagged to your pod as an unassigned pool. Super Admins are unaffected and continue to see all leads.</li>
                    <li><strong>&#x1F310; Global / My Pod toggle on the Leads page (Pod Admins only):</strong> A new toggle pill appears in the leads filter bar for Pod Admins. Switch to <em>&#x1F310; Global</em> to see the full org-wide lead list when needed, and back to <em>&#x1F512; My Pod</em> to return to your scoped view. Your preference is saved for the session.</li>
                    <li><strong>&#x1F4CA; Dashboard stats now reflect your pod:</strong> The dashboard total, status breakdown, and kanban board all now show pod-scoped counts by default, giving Pod Admins an accurate picture of their own team's pipeline.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #059669;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#ecfdf5,#d1fae5);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.9.9</strong>
                        <span style="background:#059669;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x26A1; PERFORMANCE</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x2699;&#xFE0F; BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">09 Jun 2026</span>
                </div>

                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x26A1; Every page now loads in under 1 second (Phase 3 — Smart Caching):</strong> The dashboard, leaderboard, lead lists, SDR lead view, admin user list, and activity feed all now return in under 20ms server-side after the first load. Repeated visits within a 15&ndash;60 second window are served from an in-memory cache &mdash; no database query needed. You will notice the app feels significantly snappier on every page switch.</li>
                    <li><strong>&#x1F4CB; Lead list &amp; My Leads are now instant on repeat loads:</strong> Navigating to the lead list or your personal lead view no longer re-runs the full database query on every click. Results are cached per user and page for 15&ndash;20 seconds. If a lead is created, assigned, or its status is changed, the cache is cleared immediately so you always see fresh data when something actually changes.</li>
                    <li><strong>&#x1F527; 6 additional database indexes (infrastructure):</strong> A TRIM mismatch in the company search index meant company-resolution queries were doing full table scans. Fixed. Notes, login sessions, and assignment lookups also received targeted indexes. Backend-only change &mdash; no visible UI difference, just improved reliability under load.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #b45309;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fffbeb,#fef3c7);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.9.8</strong>
                        <span style="background:#b45309;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x26A1; PERFORMANCE</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x2699;&#xFE0F; BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">09 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x26A1; Faster dashboard, leads &amp; search (Phase 2 DB Indexes):</strong> 13 new database indexes now cover the most heavily-used query paths. The dashboard stats, lead list, leaderboard, and search bar were all relying on full-table scans &mdash; they now hit indexed columns directly. Expected improvement: dashboard loads in ~300ms (down from ~1s), search in ~150ms (down from ~530ms). No visible UI changes &mdash; just speed.</li>
                    <li><strong>&#x1F4CA; Dashboard stats query streamlined:</strong> The dashboard summary card was running an extra database count query on every page load (once per SDR session, ~20 times/visit). That redundant round-trip is removed &mdash; the count is now derived from the main query result instead.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #16a34a;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.9.7</strong>
                        <span style="background:#16a34a;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🐛 BUG FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">08 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4C4; Analytics Export now downloads correctly:</strong> Clicking the <strong>Export CSV</strong> button was accidentally navigating away from the Analytics Hub and loading a raw file URL in the browser tab &mdash; breaking the entire app until you navigated back manually. Fixed: Export now downloads the CSV to your computer while keeping you on the Analytics Hub page.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #2563eb;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#eff6ff,#dbeafe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.9.6</strong>
                        <span style="background:#16a34a;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🐛 BUG FIX</span>
                        <span style="background:#2563eb;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x26A1; PERFORMANCE</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">08 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4CA; Analytics Hub — instant navigation (no reload):</strong> Returning to the Analytics Hub from any other page no longer triggers a full data reload. All charts, filters, and pinned reports stay exactly as you left them — zero flicker, zero waiting. This fix eliminates a background bug where the hub was destroying and rebuilding itself on every visit.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #2563eb;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#eff6ff,#dbeafe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.9.5</strong>
                        <span style="background:#16a34a;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🐛 BUG FIX</span>
                        <span style="background:#2563eb;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x26A1; PERFORMANCE</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">08 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4CA; Analytics Hub — 6&#xD7; fewer API calls on load:</strong> A Chrome DevTools audit revealed the Analytics Hub was making up to 6 duplicate API requests on every visit — funnel, SDR table, trend, and AI recommendation were all firing multiple times. Root causes: an async pod-list fetch was incorrectly triggering a second data load, and the AI insight was re-running on every data refresh rather than only when filters changed. All three causes are now fixed. The hub loads once, correctly.</li>
                    <li><strong>&#x1F9E0; AI Insight badge — fires at the right time:</strong> The &ldquo;Low connect rate&rdquo; / &ldquo;High effort&rdquo; AI insight badges now update only when you actually change a filter (POD, date range, batch) &mdash; not on every background data refresh. Fewer unnecessary Groq AI requests, faster badge updates when you do change filters.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #7c3aed;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#faf5ff,#f3e8ff);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.9.4</strong>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x26A1; INFRA</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">&#x2699;&#xFE0F; BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">08 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>&#x1F4CA; API Performance Monitoring (admin-facing):</strong> Every API request now logs its response time in Render logs using Google&#x2019;s RAIL model (&lt;100ms fast, 300ms&ndash;1s slow, &gt;1s critical). Slow database queries (&gt;50ms) are flagged automatically. This is the foundation for targeted performance improvements coming in the next sprint &mdash; no SDR-facing changes.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #94a3b8;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f8fafc,#f1f5f9);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.9.3</strong>
                        <span style="background:#16a34a;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🐛 BUG FIX</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">08 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>🏷️ Error logs now show the correct dialer (admin-facing fix):</strong> When an SDR was blocked from starting a call because another call was still active, the System Logs → Error Logs entry incorrectly showed <em>"RCM Dialer"</em> as the source — even for Aircall users. Admins were being misled into investigating RCM when the issue was with Aircall. The error label now correctly reflects whichever dialer the SDR is actually using.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #fb923c;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff7ed,#ffedd5);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.9.2</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🚨 URGENT FIX</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">04 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>🛡️ Dialer no longer permanently blocks SDRs after a missed call:</strong> If a call was started but the system never received the "call ended" confirmation (e.g. you closed the browser mid-call or the provider had a brief outage), the next dial attempt would show <em>"You already have an active call in progress"</em> — even hours later. This is now fixed. Stale records are automatically cleared after 90 minutes so you can always start a new call without refreshing or contacting support.</li>
                    <li><strong>🧹 Background cleanup runs every 15 minutes:</strong> A new background process sweeps for stuck call records every 15 minutes and heals them automatically. SDRs will no longer need to switch to Klenty or wait for admin intervention when this happens.</li>
                    <li><strong>🔄 Nightly sync now recovers zombie calls:</strong> The overnight RCM data recovery job previously skipped calls it already knew about — even if the status was wrong. It now corrects any missed <em>"call ended"</em> records from the provider's history, ensuring call logs are accurate by the next morning.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #6366f1;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.9.1</strong>

                        <span style="background:#16a34a;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🐛 BUG FIX</span>
                        <span style="background:#b45309;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚡ PERF</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🖥️ FRONTEND</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">03 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>📌 Pin to Dashboard fixed:</strong> AI query results can now be pinned successfully. Previously the pin button returned an error — this is now resolved. Pin any result and it will appear as a live card on your Dashboard tab instantly.</li>
                    <li><strong>🤖 Ask AI — All query types now return results:</strong> Queries asking for comparisons (e.g. <em>"which SDR had the most calls last week?"</em>), funnels, or multi-metric breakdowns previously showed "No data". All result types now display correctly with charts and tables.</li>
                    <li><strong>💾 Saved reports sidebar polished:</strong> Each saved report now shows a clean two-line layout — title on top, query below. Short reports show a subtle <em>"tap to run"</em> hint. No more duplicated text or bare single-line entries.</li>
                    <li><strong>⚡ Dashboard loads faster:</strong> Analytics metrics now cache for 10 minutes (was 2 min). The AI Insight tag no longer causes a delay on page load — it loads silently in the background. Overall dashboard response time is significantly improved.</li>
                    <li><strong>🔔 Backend messages surface in the UI:</strong> When a batch can't be resolved or data is unavailable, the AI now shows a clear amber notice instead of an empty result.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #6366f1;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.9.0</strong>
                        <span style="background:#4f46e5;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">✨ FEATURE</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🖥️ FRONTEND</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">03 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>📌 Pin AI reports to your Dashboard:</strong> After running any AI query, hit <strong>"Pin to Dashboard"</strong> to save it as a live card. The Dashboard tab now shows your pinned reports at the top — each one re-runs automatically for fresh data every time you visit.</li>
                    <li><strong>🔄 Refresh &amp; unpin per card:</strong> Each pinned card has a <strong>🔄 Refresh</strong> button to re-run the query on demand, and an <strong>✕ Unpin</strong> button to remove it. Your dashboard layout is fully yours to configure.</li>
                    <li><strong>🎛️ Up to 5 pinned reports per admin:</strong> Pin your most-used queries — calls by SDR this week, meetings by pod, connect rate trend — and see them all on one screen without running queries manually.</li>
                    <li><strong>🔒 Pinned reports are user-scoped:</strong> Each admin sees only their own pinned cards. Pod Admins' pinned reports respect their pod scope automatically.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #6366f1;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.8.0</strong>
                        <span style="background:#4f46e5;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">✨ FEATURE</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🖥️ FRONTEND</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">03 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>👔 New AE (Account Executive) role:</strong> A dedicated AE role is now available across the entire system. AEs operate identically to SDRs — they can log calls, send emails, use the dialer, view their own leads, and appear in analytics. AE-only pods are enforced (no mixing with SDR pods). Pod Admins receive a copy of every lead assigned to an AE in their pod for oversight.</li>
                    <li><strong>🏆 AE Leaderboard:</strong> A separate AE tab on the Leaderboard shows AE-specific rankings — calls, meetings, and connect rate — without mixing into the SDR board.</li>
                    <li><strong>📊 Analytics Hub — Activity Trend chart restored:</strong> The Dashboard tab now shows the full <strong>Activity Trend</strong> line chart (Calls, Meetings, Research, Disqualified, Emails over time) with toggleable metrics — matching the analytics you had before.</li>
                    <li><strong>📊 Analytics Hub — 6 rich KPI cards:</strong> All six KPI cards now show contextual subtitles: <em>Research Complete</em> shows % of assigned, <em>Calls Made</em> shows unique leads &amp; avg/lead, <em>Connect Rate</em> shows a Low/Strong badge, <em>Emails Sent</em> shows open &amp; reply rates, and <em>Disqualified</em> shows % of assigned.</li>
                    <li><strong>📊 Analytics Hub — SDR table improvements:</strong> The per-SDR table now shows the correct <strong>Connect %</strong> column (not Conversion Rate), includes an <strong>Inactive</strong> toggle, and a <strong>Search SDR</strong> filter.</li>
                    <li><strong>💡 Analytics Hub — Insight pills:</strong> Rule-based insight badges now appear above the KPI cards (e.g. "Low connect rate at 12% — review call timing", "48 researched leads not yet called") to surface actionable patterns automatically.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #6366f1;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.6.0</strong>
                        <span style="background:#4f46e5;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">✨ FEATURE</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🖥️ FRONTEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">02 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>📊 Analytics Hub — AI query bar built into the Analytics page:</strong> The Analytics page is now the <strong>Analytics Hub</strong>. A <strong>✦ Ask AI</strong> command bar sits at the top of the page — type any question about your pipeline and the result appears inline, right above your KPI cards. No page switch needed.</li>
                    <li><strong>🔍 Global AI Query Bar in the top navigation (Admin only):</strong> A new <strong>✦ Ask AI</strong> input appears next to the global search bar on every page. Ask a question from anywhere — a compact result drops down instantly. Hit <strong>"Open full Analytics Hub →"</strong> to see the full result with charts. Keyboard shortcut: <code>⌘/</code> (or <code>Ctrl+/</code>) focuses the bar.</li>
                    <li><strong>🔗 Smart Analytics retired as a separate page:</strong> The sidebar "Smart Analytics" link now takes you directly to the unified Analytics Hub. All saved reports, history, and AI workspace remain accessible via <strong>✦ Full AI Workspace</strong> from inside the hub.</li>
                    <li><strong>🔀 Legacy URLs auto-redirect:</strong> Bookmarks or links to <code>#smart-analytics</code>, <code>#metrics</code>, or <code>#activity-feed</code> all redirect seamlessly to <code>#analytics</code>.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #34d399;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#ecfdf5,#d1fae5);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.5.0</strong>
                        <span style="background:#059669;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">✨ FEATURE</span>
                        <span style="background:#16a34a;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🐛 BUG FIX</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">02 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>🧠 Smart Analytics — Ask your pipeline anything (Admin only):</strong> A new <strong>Smart Analytics</strong> panel lets Super Admins and Pod Admins query live pipeline data using plain English — no filters, no reports to configure. Just type <em>"how many calls did we make this month by SDR?"</em> and get an instant bar chart. Supports calls, meetings, emails, leads, conversion rate, connect rate, research, and more.</li>
                    <li><strong>📊 Smart charts, auto-selected:</strong> Results display as the most useful chart type — bar charts for SDR/pod comparisons, line charts for day/week/month trends, and tables for raw counts. No manual configuration needed.</li>
                    <li><strong>💾 Save & rerun reports:</strong> Save any query as a named report and rerun it any time with one click. Pod Admins can only see their own saved reports.</li>
                    <li><strong>🔒 Scoped by role:</strong> Pod Admins see only their pod's data. Super Admins see everything. Attempting cross-pod queries as a Pod Admin is automatically blocked.</li>
                    <li><strong>⚡ Auto model discovery:</strong> The AI backend automatically finds the best available Groq model and retries if one is unavailable or rate-limited — no manual configuration needed.</li>
                    <li><strong>🐛 SF sync: duplicate leads no longer cause errors:</strong> When Salesforce blocked a Lead creation because the email already existed (duplicate rule), the sync was showing as a failed error. It now correctly links to the existing Salesforce record instead — no more noise in SF Logs for this case.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #818cf8;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.4.0</strong>
                        <span style="background:#4f46e5;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">✨ FEATURE</span>
                        <span style="background:#0f766e;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🛡️ HARDENING</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🖥️ FRONTEND</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">01 Jun 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>🎮 Dialer Playground (Admin only):</strong> A new 3-step onboarding wizard lets Super Admins and Admins verify RCM credentials, place a live test call, and confirm the widget is working — all without changing any SDR settings. Find it under 🎮 Playground in the Admin sidebar.</li>
                    <li><strong>⚡ Real-time call status (no more polling):</strong> The RCM call widget now receives live call events (<em>Ringing → Connected → Ended</em>) instantly via Server-Sent Events instead of checking every 2 seconds. Calls feel faster and more responsive. Falls back to polling automatically if the connection drops.</li>
                    <li><strong>🛡️ Double-call prevention:</strong> If an SDR accidentally clicks Call twice (or refreshes mid-call), the second call is now blocked immediately with a clear message: <em>"You already have an active call in progress."</em> No more zombie LiveKit sessions.</li>
                    <li><strong>🔒 Call duration now always accurate:</strong> RCM sometimes re-sends the same call event multiple times. The system now ignores duplicate endings — so call duration in the Calls tab always reflects the real duration, never overwritten by a retry.</li>
                    <li><strong>🎨 Lighter call widget:</strong> The RCM floating call widget now uses a clean light theme — easier to read against both light and dark page backgrounds.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #6ee7b7;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f0fdfa,#ccfbf1);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.3.2</strong>
                        <span style="background:#16a34a;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🐛 BUG FIX</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">29 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>🔄 RCM nightly call sync now actually runs:</strong> A background job runs every night to recover any RCM calls that the real-time system may have missed (e.g. during a server restart). This job was silently failing every night due to an incorrect internal import — it never ran. Fixed: missed calls are now correctly recovered and appear in Call Logs the next morning.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #fb923c;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff7ed,#ffedd5);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.3.1</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🚨 RCA PATCH</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🖥️ FRONTEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">29 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>🛡️ Task reminders no longer show a 500 error under load:</strong> If the database is briefly busy (a common occurrence during peak morning usage when multiple SDRs load the app simultaneously), task reminders now return a clean retry response instead of a server error. You may see the bell refresh a few seconds later — this is expected.</li>
                    <li><strong>🔔 Task bell now refreshes every 60 seconds (was 30s):</strong> Reduced the check-in frequency to ease pressure on the database during high-traffic periods. Tasks still appear promptly when they come due.</li>
                    <li><strong>📊 Aircall "Desktop offline" errors decluttered from Error Logs:</strong> When an SDR's Aircall Desktop app is closed (common outside business hours), call failures were showing as critical errors in System Logs. They're now correctly categorised as warnings — so critical errors in the dashboard are actually critical.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #c4b5fd;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fdf4ff,#ede9fe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.2.0</strong>
                        <span style="background:#16a34a;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🐛 BUG FIX</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">✨ FEATURE</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🖥️ FRONTEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">28 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>🎙️ SDR: Listen to your call recordings in Today's Calls:</strong> Every call card in Today's Calls now shows a purple <strong>🎙️ Listen</strong> button when a recording is available. Click it to play the recording inline — no need to open the lead. Click again to collapse. If the link has expired, a clear message tells you to open the lead to refresh it.</li>
                    <li><strong>🎚️ Progress bar now visible in Call Monitor:</strong> The audio seek bar was being clipped by a 32px height limit — the recording would play but you couldn't skip to a point in the recording. Fixed: the player now renders at its full native height.</li>
                    <li><strong>🔄 Refresh link button now visible + auto-plays:</strong> The refresh button to get a fresh recording URL was a tiny invisible icon. It's now a clearly labelled <strong>🔄 Refresh link</strong> button. After refreshing, the recording plays automatically — no need to click Play a second time.</li>
                    <li><strong>🧪 22 new automated tests:</strong> First ever coverage for the Today's Calls API — all edge cases now guarded (user isolation, date filtering, null recordings, expired links, sort order).</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #f0abfc;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fdf4ff,#fae8ff);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.1.0</strong>
                        <span style="background:#16a34a;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🐛 BUG FIX</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🖥️ FRONTEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">28 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>🚀 Bulk Research now actually works:</strong> The background job (Admin → Settings → AI Settings → Bulk Research) was silently doing nothing due to 5 stacked bugs — it now correctly upgrades all v1 leads to the new Pre-Call Intelligence format. Expect ~3-4 hours to complete for 10K+ leads.</li>
                    <li><strong>⚡ Speed fix — 7× faster:</strong> A rate-limiter bug was sleeping 7.5 seconds before every Groq API call (asyncio clock mismatch). Fixed: the job now runs at full speed (~1 lead/sec on Groq's free tier).</li>
                    <li><strong>🛡️ Memory fix — no more silent crashes:</strong> Loading 11,000 leads into RAM at once was silently killing the background thread. Fixed: leads are now processed in chunks of 100.</li>
                    <li><strong>🔄 Button resets correctly:</strong> The "Start Bulk Research" button now shows the correct state on every page load — if no job is running, it's clickable (purple); if running, it shows live progress.</li>
                    <li><strong>📊 New: live status endpoint:</strong> <code>GET /api/admin/bulk-research/status</code> — Super Admins can check how many leads have been processed without triggering a new job.</li>
                    <li><strong>🧪 13 new automated tests:</strong> Full test coverage for the bulk research job (auth gate, skip logic, field persistence, failure isolation, resumability).</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #a78bfa;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#faf5ff,#ede9fe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v8.0.0</strong>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">✨ FEATURE</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                        <span style="background:#0f766e;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🛡️ HARDENING</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">27 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>🔥 Pre-Call Intelligence (Research v2):</strong> The AI research card on each lead now shows a <strong>heat score</strong> (🔥 Hot / 🟡 Warm / 🔵 Cool), a personalised <strong>opening line</strong>, persona signal, refined company description, pain points, and pitch angle. Research auto-triggers when you open a lead — no waiting, no manual refresh.</li>
                    <li><strong>🚀 Bulk Research Upgrade (Admin):</strong> Settings → AI Settings → Bulk Research now includes a <strong>pod selector</strong>. Super Admins can upgrade existing v1 leads to the new v2 format in phases — run US Team first, then India Team — to avoid overloading the AI service.</li>
                    <li><strong>⚡ Lead → Calling auto-move:</strong> When you dial a lead, their status automatically transitions to <strong>Calling</strong> — no manual status change needed.</li>
                    <li><strong>🛡️ Aircall error messages improved:</strong> When Aircall is unavailable, you now see a clear, actionable message: <em>"Please ensure Aircall Desktop is open and your status is set to Available"</em> — instead of a raw error code.</li>
                    <li><strong>🔒 Dial button spam prevention:</strong> Clicking Call multiple times quickly no longer fires multiple simultaneous call attempts. A guard prevents double-dialling.</li>
                    <li><strong>🐛 Critical: AI research cache fixed:</strong> Research results are now correctly cached per company — leads from the same company reuse the research instead of re-running a new AI call every time.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #6ee7b7;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f0fdfa,#ccfbf1);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v7.2.0</strong>
                        <span style="background:#0f766e;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🛡️ HARDENING</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">27 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>🔒 Phone validation before every call:</strong> Both Aircall and RCM now validate the phone number <em>before</em> dialling — numbers with extensions are stripped automatically, dots and spaces are cleaned up, and invalid numbers (Indian 1860/1800 service lines, bad area codes, too short/long) are blocked with a clear message instead of a silent failure.</li>
                    <li><strong>📋 Extension stripping:</strong> If a lead's phone number has an extension (e.g. <code>+1 800-887-8965 ext 288</code>), the extension is automatically stripped before dialling. You no longer need to manually clean the number.</li>
                    <li><strong>💬 Actionable RCM error messages:</strong> When RCM rejects a call, you now see a specific reason — e.g. <em>"RCM says: phone number not reachable"</em> — instead of a raw error code. Every error type (invalid number, auth failure, rate limit, server unavailable, timeout) has a tailored message with what to do next.</li>
                    <li><strong>🛡️ Shared validation module:</strong> Aircall and RCM now share the same phone validation logic — consistent behaviour across both dialers.</li>
                    <li><strong>🧪 1,252 tests passing:</strong> 91 new automated tests added covering all phone edge cases, error codes, and guard conditions. Zero regressions.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #6ee7b7;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#ecfdf5,#d1fae5);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v7.1.0</strong>
                        <span style="background:#0891b2;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">✨ FEATURE</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🖥️ FRONTEND</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">26 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>📊 New: Call Monitor (Admins only):</strong> A dedicated <strong>Call Monitor</strong> page gives Super Admins and Pod Admins a real-time view of all dialer activity across the team — Aircall, RCM, and manual calls in one place. Includes stat cards (Total, Completed, Failed, Avg Duration), full filter bar, inline audio playback, and transcript preview.</li>
                    <li><strong>🔍 Filters:</strong> Filter by SDR, Provider (Aircall / RCM / Manual), Direction (↗ Outbound / ↙ Inbound), Outcome, Date Range, and Has Recording — all filters can be combined. Invalid date ranges are blocked before the API call.</li>
                    <li><strong>🔄 Auto-refresh:</strong> The page refreshes every 60 seconds automatically. A manual <strong>🔄 Refresh</strong> button is always available for immediate updates.</li>
                    <li><strong>🛡️ Pod Admin Scoping:</strong> Pod Admins only see calls from SDRs in their own pod. Cross-org Aircall data is automatically excluded.</li>
                    <li><strong>⚡ Backend Optimised:</strong> Stats cards now correctly reflect the active filters — previously the summary could show inflated totals when Direction or Has Recording filters were applied. COUNT query is also index-friendly (no full JOIN).</li>
                    <li><strong>🧪 44 new tests:</strong> All edge cases are now covered by automated tests — null leads, cross-org calls, empty transcripts, race conditions, and Pod Admin scoping.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #fca5a5;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff7ed,#ffedd5);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v7.0.0</strong>
                        <span style="background:#0891b2;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">✨ FEATURE</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🖥️ FRONTEND</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">26 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>🔍 Dialer Errors Now Visible in System Logs:</strong> When a RCM call fails to start, the exact error reason is now automatically logged under <strong>System Logs → Error Logs</strong> (filter by <em>Dialer</em>). Admins no longer need to check Render server logs to diagnose calling issues.</li>
                    <li><strong>📋 Call Logs Tab Upgraded:</strong> The <strong>System Logs → Call Logs</strong> tab now shows a <strong>Provider</strong> filter (RCM / Aircall), a <strong>Direction</strong> column (outbound/inbound), and colour-coded provider badges. Failed calls are highlighted in red with the exact error message displayed inline — no guessing required.</li>
                    <li><strong>🔴 Failed-Call Badge:</strong> A red badge now appears on the 📞 Call Logs tab button showing the count of failed calls — identical to how the Error Logs badge works. Refreshes every 60 seconds automatically.</li>
                    <li><strong>🛠️ Silent Errors Fixed:</strong> Network retries, unknown RCM webhook events, and credential decryption failures were previously swallowed silently. All now surface as warnings or errors in the logs.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #86efac;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v6.9.0</strong>
                        <span style="background:#16a34a;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🐛 BUG FIX</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🖥️ FRONTEND</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">25 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>📞 Call Duration Now Shows Correctly:</strong> Calls from RCM were showing <em>0s</em> instead of the real duration. This was caused by the RCM API using a different field name (<code>duration_seconds</code>) than expected. Duration now displays accurately — and if a recording exists, the duration is automatically read from the audio file.</li>
                    <li><strong>🏆 Leaderboard Dials Now Count Properly:</strong> RCM and Aircall dials were not showing up in the Leaderboard. The leaderboard was only counting manual call logs — now it counts all dialer calls too. Your dials today will appear in real time.</li>
                    <li><strong>📊 Avg Duration Fixed:</strong> The Avg Duration stat card on the Calls tab was showing <em>0s</em> for leads with RCM calls. It now shows <em>—</em> when duration is unknown, and correctly averages only calls with known duration.</li>
                    <li><strong>🔄 Call History Sync Improved:</strong> RCM calls that missed the disconnect event will now automatically recover their duration and ended time the next time you open that lead's page.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #fca5a5;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff1f2,#fee2e2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v6.8.1</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🔥 HOTFIX</span>
                        <span style="background:#b91c1c;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🚨 P1</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">25 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>✅ Calls to ad-hoc numbers now work:</strong> Dialling a phone number not already in the CRM was failing with a server error (HTTP 500) — the call never started. Fixed: the system now correctly creates a temporary lead record for unrecognised numbers.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #a5f3fc;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#ecfeff,#cffafe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v6.8.0</strong>
                        <span style="background:#0891b2;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">✨ FEATURE</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🖥️ FRONTEND</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">25 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>🎙️ RCM Call Recordings Fixed:</strong> Recordings from RCM calls were not appearing in the lead Calls tab. The recording refresh logic now uses the correct provider per call — recordings will appear on the next page load for completed calls.</li>
                    <li><strong>✅ Test Suite Isolation &amp; Reliability:</strong> Refactored backend public API key auth to inject the request's DB session dynamically, fixing database connection bleed and making the full backend unit test suite completely stable.</li>
                    <li><strong>✅ Manual Dial Sync Active Hidden:</strong> The Dial/Call buttons are now dynamically hidden on lead details and lists if a manual dial sync is actively running.</li>
                    <li><strong>✅ Clear Filter Page Reload:</strong> Clicking the "Clear Filters" button now triggers a clean page reload to completely reset all filter inputs and pagination states.</li>
                    <li><strong>✅ SDR Settings Dialer Toggle:</strong> SDRs can now toggle the RCM WebRTC dialer widget on or off directly within their Settings panel.</li>
                    <li><strong>✅ SDR Error Logs Resolve Cleaned:</strong> Removed the redundant "Resolve" buttons from System Error Logs for SDR-role users.</li>
                    <li><strong>✅ Compact Call Log Modal UI:</strong> Streamlined the call log details modal to occupy less screen space and improve visual hierarchy.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #bfdbfe;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#eff6ff,#dbeafe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v6.7.0</strong>
                        <span style="background:#2563eb;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">✨ FEATURE</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🖥️ FRONTEND</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">25 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>✅ Cross-Page Navigation:</strong> Previous/Next buttons on the lead detail page can now traverse through *all* leads matching your current search/filters, even across pages, instead of being limited to the current page's subset.</li>
                    <li><strong>✅ Today's Calls Traversal:</strong> Previous/Next buttons are now fully supported when opening leads directly from the "Today's Calls" view, allowing you to cycle sequentially through all unique leads called today.</li>
                    <li><strong>⚡ Optimized Backend Queries:</strong> Added lightweight <code>ids_only</code> mode to get_leads/get_my_leads endpoints to fetch all matching lead IDs asynchronously without overhead.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #a7f3d0;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#ecfdf5,#d1fae5);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v6.6.0</strong>
                        <span style="background:#059669;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🐛 BUG FIX</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">📊 ANALYTICS</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">22 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>✅ Calls Made now accurate (US Team):</strong> The Analytics dashboard was showing only 19 calls for US Team. Root cause: the system was reading from the manual call log table, which only had 19 entries. All Aircall calls (10,315 total) were invisible. Fixed — analytics now reads from both Aircall data and manual logs, showing the correct total.</li>
                    <li><strong>✅ India Team unaffected:</strong> India Team uses manual call logging — their ~4,969 calls were already counted correctly and remain unchanged.</li>
                    <li><strong>✅ No double-counting:</strong> Where a call exists in both systems (only 1 case found org-wide), it is counted once only.</li>
                    <li><strong>✅ 1,474 historical calls recovered:</strong> Calls from the Aircall historical sync that weren't linked to leads (due to phone number format mismatch) have been matched and linked. These now count toward the correct lead's call history.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #fde68a;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fffbeb,#fef9c3);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v6.5.0</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🔥 HOTFIX</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                        <span style="background:#065f46;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚡ PERF</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">22 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>✅ Call Logs load instantly:</strong> The System Logs → Call Logs tab was loading slowly (3–8 seconds). Root cause: every page load was fetching all 11,000+ call records into memory just to count totals. Fixed — now uses a direct database aggregation query. First page loads in under 300ms.</li>
                    <li><strong>✅ CORS error fixed (Admin panel was blocked):</strong> All API requests from the production app were showing CORS errors in the browser console. Fixed by updating the allowed origins configuration on the server.</li>
                    <li><strong>✅ Login speed improved:</strong> On each login, the system was fetching a user's entire call history just to count today's calls. Fixed — now queries only today's data directly.</li>
                    <li><strong>✅ 3 database indexes added:</strong> New indexes on call tables mean filters, sorting, and date-range queries run significantly faster as the database grows.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #c7d2fe;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v6.4.9</strong>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                        <span style="background:#6d28d9;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🧪 TESTS</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">22 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>✅ API field name consistency fix:</strong> The dialer's phone number field now returns a consistent name across all endpoints — prevents silent mismatches that could cause calls to fail.</li>
                    <li><strong>✅ Test suite fully passing:</strong> All 175 automated tests passing (0 failures). Added a sanity check suite that runs 13 pre-flight infrastructure checks before the full test run — catches server issues before wasting 20 minutes.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #d8b4fe;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#faf5ff,#f3e8ff);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v6.4.8</strong>
                        <span style="background:#6d28d9;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🛡️ HARDENING</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">22 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>✅ Timer safety — no cross-call bleed:</strong> If a new call started within 1.5 seconds of the previous call's widget closing, the old call's 45s safety timer could fire against the new call. Fixed — each timer now locks to its own call ID.</li>
                    <li><strong>✅ Calls tab retry window extended:</strong> On slower networks, the automatic Calls tab switch after logging an outcome could miss the timing window. Extended from 600ms → 1200ms.</li>
                    <li><strong>✅ Outcome modal shows correct lead name:</strong> For ad-hoc (non-lead-page) calls, the outcome modal now always shows the correct lead name instead of blank.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #fda4af;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff1f2,#ffe4e6);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v6.4.7</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🔥 HOTFIX</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🖥️ FRONTEND</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 22, 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>✅ Outcome modal now visible:</strong> The post-call outcome modal was appearing behind the RCM widget (z-index 99,999) and instantly disappearing. Fixed — the modal now always renders on top (z-index 100,000).</li>
                    <li><strong>✅ Calls tab auto-opens after logging:</strong> After submitting a call outcome, the app now navigates to the lead and automatically opens the Calls tab — no manual click required to see the new entry.</li>
                    <li><strong>✅ Declined call no longer stuck on Ringing:</strong> Two-layer guard added — Guard 1 (backend: if <code>ended_at</code> is already set, return CALL_ENDED immediately) and Guard 2 (backend: auto-end any RCM call stuck in CALL_STARTED for &gt;50 seconds). Client-side 45s timeout added as a third safety net.</li>
                    <li><strong>✅ Calls tab refresh after call ends:</strong> <code>_refreshCallsTab()</code> hook added — if the Calls tab is active when a call ends, it immediately re-fetches without requiring a page reload.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #fca5a5;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff1f2,#fee2e2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v6.4.6</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🔥 HOTFIX</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">22 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>✅ Ringing timeout — backend Guard 2:</strong> RCM calls stuck in <code>CALL_STARTED</code> for more than 50 seconds (no <code>ended_at</code>) are now automatically closed server-side. Prevents zombie calls from blocking the UI after a recipient declines and the webhook is delayed.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #fde68a;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fffbeb,#fef9c3);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v6.4.5</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🔥 HOTFIX</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">22 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>✅ Ringing stuck — backend Guard 1:</strong> If a RCM call's <code>ended_at</code> is already written (by the disconnect endpoint or a webhook) but the status poll was still returning <code>CALL_STARTED</code> due to RCM API lag, the status endpoint now immediately returns <code>CALL_ENDED</code>. Verified live: call <code>3f6157e6</code> transitioned correctly 37s after start.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #a5f3fc;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#ecfeff,#cffafe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v6.4.4</strong>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🖥️ FRONTEND</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">22 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>✅ Calls tab refresh hook:</strong> <code>window._refreshCallsTab(leadId)</code> is now exposed globally. After a RCM call ends, the hook is called — if the Calls tab is currently active it immediately re-fetches; otherwise it marks the tab stale so the next click fetches fresh data.</li>
                    <li><strong>✅ Manual dial Promise fix:</strong> The "Phone Bridge / Browser Call" manual dial button was silently dropping the Promise result — <code>POST /api/calls/start</code> was never hit. Fixed by routing all manual dials through <code>showManualDialWidget()</code> which correctly handles the full async chain.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #fed7aa;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fff7ed,#ffedd5);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v6.4.3</strong>
                        <span style="background:#0891b2;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🔍 SEARCH</span>
                        <span style="background:#6d28d9;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🛡️ HARDENING</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">21 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>🔍 Search audit — 9 match paths:</strong> Search now checks first name, last name, full name (both orders), email, company, primary phone, secondary phone, and company phone.</li>
                    <li><strong>⚡ Search performance:</strong> 2-character minimum added — no more single-keystroke DB hits on 11k+ leads.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #ddd6fe;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v6.4.2</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🐛 BUG FIX</span>
                        <span style="background:#0891b2;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🔍 SEARCH</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">21 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>🐛 Full-name search fixed:</strong> Searching "Melanie Pratt" (or any "First Last" combination) now returns correct results. Previously returned 0 results because first and last name were only matched individually.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #fde68a;border-radius:10px;padding:14px 18px;margin-bottom:10px;background:linear-gradient(135deg,#fffbeb,#fef9c3);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:0.95rem;">v6.4.1</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🔥 HOTFIX</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 7px;border-radius:6px;font-size:0.68rem;font-weight:600;">🖥️ FRONTEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">21 May 2026</span>
                </div>
                <ul style="margin:0;padding-left:18px;font-size:0.83rem;">
                    <li><strong>🔥 Ad-hoc dial fixed:</strong> Clicking "Phone Bridge" or "Browser Call" in the Ad-hoc Dial panel was silently cancelling the call. The widget went blank and no call was made. Now shows a "Connecting…" spinner and initiates correctly.</li>
                    <li><strong>✅ Random lead in footer fixed:</strong> A previous lead's name was incorrectly appearing in the widget footer during ad-hoc dial. Resolved as a side-effect of the main fix.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #a5b4fc;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v6.4.0</strong>
                        <span style="background:#16a34a;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🖥️ FRONTEND</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">⚙️ BACKEND</span>
                        <span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔥 HOTFIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 21, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:#3730a3;margin-bottom:6px;">📞 RCM Dialer — Reliability, UX Polish &amp; Performance</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>✅ Call end detection fixed:</strong> Webhook events (declined/no-answer/completed) now immediately close the dialer widget. Previously, RCM's status API returned stale data after the call ended, causing polling to overwrite the webhook update — widget stayed on "Ringing" forever.</li>
                    <li><strong>✅ Button clean-up:</strong> For RCM users, the redundant "Call via RCM" and "Message" buttons are now hidden — the floating widget handles both. Aircall users with RCM messaging still see the Message button.</li>
                    <li><strong>✅ Calls tab pagination:</strong> Call history now loads 10 records at a time with an async "Load more" button. Previously all calls were loaded in one request.</li>
                    <li><strong>🔥 Hotfix — Calls were failing (v6.3.5):</strong> The RCM <code>/calls/initiate</code> API returned 422 "Unknown field" for <code>agent_email</code> and <code>notify_url</code> fields that were incorrectly added in v6.3.3. Both were removed. Calls now initiate correctly.</li>
                    <li><strong>🔧 Status polling — no-downgrade guard:</strong> Added a priority system (CALL_STARTED=0 → CALL_ANSWERED=1 → CALL_ENDED=2). Polling can only advance the status forward — never overwrite a webhook-set terminal state with a stale intermediate value.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1.5px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.16.0</strong>
                        <span style="background:#16a34a;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🖥️ FRONTEND</span>
                        <span style="background:#0369a1;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">⚙️ BACKEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 20, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:#15803d;margin-bottom:6px;">🚀 SDR UX Overhaul — Smarter Calling, Faster Navigation</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>✅ New Call Outcome Modal:</strong> Binary "Did the call connect?" question → inline chip picker → Log Call. 3 clicks max. Keyboard shortcuts: Y/N to pick branch, 1–9 for outcomes, Enter to submit.</li>
                    <li><strong>✅ Meeting Booked card:</strong> Featured green card at the top of the Yes branch — tap it to expand a date + time picker inline. No separate screen.</li>
                    <li><strong>✅ Aircall Auto-Sync:</strong> If you tag a call in Aircall, the outcome is automatically logged in RCM. The modal shows a quiet green dot while syncing, then dismisses itself.</li>
                    <li><strong>✅ Prev / Next Lead navigation:</strong> When browsing leads, use ← → arrow buttons in the header (or Alt+← / Alt+→ on keyboard) to move between leads without going back to the list.</li>
                    <li><strong>✅ Multi-number call button:</strong> If a lead has 2–3 phone numbers, a chevron ⌄ appears next to the Call button — tap it to choose which number to dial.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #fca5a5;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#fff1f2;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.15.5</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔥 HOTFIX</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🖥️ FRONTEND</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 15, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:#991b1b;margin-bottom:6px;">🛠️ Console Error Cleanup — 2 Frontend Warnings Eliminated</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>✅ Fixed: Editing a lead field while navigating away no longer crashes.</strong> If you clicked an editable field and immediately switched to another lead or view, a silent JavaScript error could occur. The editor now safely aborts if the page has already changed.</li>
                    <li><strong>✅ Fixed: Spurious "background operation failed" warnings no longer appear in the error log.</strong> Auth-related session events and navigation redirects were incorrectly surfacing as errors. These are now correctly suppressed.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #fca5a5;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#fff1f2;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.15.4</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🚨 P1 HOTFIX</span>
                        <span style="background:#b45309;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔐 ADMIN</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 15, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:#991b1b;margin-bottom:6px;">🚨 Admin User Deletion — HTTP 500 Crash Fixed</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>✅ Fixed: Deleting a user from the Admin panel no longer returns a 500 error.</strong> Removing a user who had a linked mailbox was crashing with a database integrity error. The backend now correctly delegates cleanup to the database cascade constraint, resolving the crash with no data loss.</li>
                    <li><strong>No action required:</strong> User deletion works fully again. No data was lost during the incident window.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #86efac;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#f0fdf4;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.15.3</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔥 BUG FIX</span>
                        <span style="background:#0284c7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔍 DISCOVERY UI</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 15, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:#166534;margin-bottom:6px;">🛠️ Discovery Stage UI Polish — 2 Bugs Fixed</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>✅ Fixed: Discovery gate now clears immediately after logging outcome.</strong> Previously the yellow "Log outcome first" banner remained visible even after logging, requiring a manual page refresh. The page now auto-refreshes with the latest data the moment you submit the outcome modal.</li>
                    <li><strong>✅ Fixed: Discovery call label now shows "Outcome Logged" instead of "In Progress".</strong> Once an outcome is saved for a discovery call, the call entry correctly reflects this state and the amber highlight is removed. Only genuinely unlogged calls show the "In Progress" label.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #86efac;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#f0fdf4;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.15.2</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔥 BUG FIX</span>
                        <span style="background:#0284c7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">📞 SDR WORKFLOW</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 15, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:#166534;margin-bottom:6px;">🛠️ SDR Staging QA Patch — 4 Workflow Bugs Fixed</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>✅ Fixed: "Meeting Complete" and "Demo Failed" buttons now work.</strong> Both actions were throwing a silent JavaScript error and doing nothing. The fix makes status transitions (→ Discovery, → Pending Review) reliable.</li>
                    <li><strong>✅ Fixed: Discovery stage gate no longer stays stuck on "Log outcome first".</strong> The stuck gate was a knock-on effect of the button crash above — once the call outcome is correctly saved, the gate clears as expected.</li>
                    <li><strong>✅ Fixed: Second duplicate call entry per Aircall call.</strong> Aircall sends phone numbers in different formats on CALL_STARTED vs CALL_ENDED (e.g. <code>+91 8109...</code> vs <code>+91 81097 30301</code>). The backend now normalises both to digits before matching, so each call creates exactly one log entry.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #a5b4fc;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#eef2ff;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.15.1</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔥 BUG FIX</span>
                        <span style="background:#0284c7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">📞 CALL LOGS</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 15, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:#3730a3;margin-bottom:6px;">🔧 Duplicate Dialer Call Entries — Fixed (EC-14)</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>✅ Fixed: Dialer calls no longer appear twice in lead history.</strong> When you log an outcome via the post-call modal, only a single entry now appears — no more duplicate "DialerCall + CallLog" ghost record.</li>
                    <li><strong>Root cause:</strong> The backend was guessing which dialer call to attach your outcome to using a 10-minute time window. Calls longer than 10 minutes (or with slow webhooks) fell outside this window and created a second log entry.</li>
                    <li><strong>Fix:</strong> The frontend now passes the exact call ID to the backend when submitting outcomes via the dialer gate — precise match every time, regardless of call duration.</li>
                    <li><strong>Manual calls unaffected:</strong> Logging a call outcome without the dialer (via "Log Call" button) continues to work exactly as before.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #c4b5fd;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#f5f3ff;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.15.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                        <span style="background:#0284c7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">📞 DIALER</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 15, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:#5b21b6;margin-bottom:6px;">📞 Automated Dialer Outcome Gate + Provider Test Buttons</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>✅ Outcome Gate:</strong> After every dialer-initiated call (Aircall or RCM), a sticky banner and outcome modal automatically appear — you can't accidentally skip logging a call result.</li>
                    <li><strong>✅ Auto-recovery:</strong> If you refresh the page mid-call, the banner reappears on reload and remains until the outcome is logged.</li>
                    <li><strong>✅ Auto-dismiss note:</strong> If you close the modal without logging, a timestamped note is automatically added to the lead so no context is lost.</li>
                    <li><strong>✅ Aircall timing fix:</strong> The outcome modal now opens immediately if Aircall hasn't registered the call yet (no <code>provider_call_id</code>) — you're never left waiting.</li>
                    <li><strong>🔧 Provider Test Buttons:</strong> Admins can now test Aircall and RCM credentials independently in Settings — no more having to test both at once.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #c7d2fe;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#eef2ff;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.14.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                        <span style="background:#0284c7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔭 SDR PIPELINE</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 15, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:#3730a3;margin-bottom:6px;">🛡️ SDR Discovery Pipeline — Status Transitions, Counter Integrity & Demo Failed Routing</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>✅ Pending Review Status:</strong> SDRs can now transition a lead to <em>Pending Review</em> after a failed demo — routes it for admin review instead of marking it terminal immediately.</li>
                    <li><strong>✅ Demo Failed Routing:</strong> Logging a <em>Demo Failed</em> outcome now correctly sets the lead status to <em>Pending Review</em> rather than leaving it in <em>Demo Scheduled</em>.</li>
                    <li><strong>✅ Meeting Complete Guard Expanded:</strong> The <em>Meeting Complete</em> action now works from <em>Meeting Scheduled</em>, <em>1st Discovery Meeting</em>, and <em>Demo Scheduled</em> statuses — no more blocked transitions mid-pipeline.</li>
                    <li><strong>✅ Discovery Counter Fixed:</strong> <code>discovery_meeting_count</code> is now correctly incremented when a meeting is marked complete via the call-log path — counter was previously only updating through the Add Discovery shortcut.</li>
                    <li><strong>🔧 Test Suite Hardened:</strong> Standalone test scripts (<code>test_discovery_gate.py</code>, <code>test_e2e_email_tracking.py</code>) refactored to not crash pytest during collection — wrapped in <code>__main__</code> guard.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#f0fdf4;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.13.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                        <span style="background:#059669;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔭 DISCOVERY</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 13, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:#15803d;margin-bottom:6px;">🔭 SDR Discovery Pipeline — Full Workflow Completion</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>✅ Add Discovery Call:</strong> The "Add Discovery Call" button now persists to the database and advances the lead stage correctly — was previously a no-op.</li>
                    <li><strong>✅ Complete Discovery:</strong> New "Complete Discovery" button on the lead detail page advances the lead from <em>1st Discovery Meeting</em> to <em>Discovery Complete</em>.</li>
                    <li><strong>✅ Schedule Demo:</strong> New "Schedule Demo" button appears at <em>Discovery Complete</em> stage — one click advances to <em>Demo Scheduled</em>.</li>
                    <li><strong>⚠️ Max Attempts Banner:</strong> SDRs at their call attempt limit now see a persistent warning banner directly on the lead detail page — not just in the call modal.</li>
                    <li><strong>📅 Meeting Datetime Required:</strong> When logging a call with outcome "Meeting Confirmed", a date/time picker now appears and is required before submission — meeting time is automatically prepended to call notes.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #fef3c7;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#fffbeb;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.12.3</strong>
                        <span style="background:#d97706;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🛡️ HARDENING</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 13, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:#b45309;margin-bottom:6px;">🔒 P1 Import Route Resilience — Split-Brain & Session Corruption Fixed</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>Fixed: Lead import no longer silently loses upload logs.</strong> The upload log and leads are now committed atomically — no more split-brain where leads land but the history entry is lost.</li>
                    <li><strong>Fixed: One bad row no longer crashes an entire CSV/GSheet import.</strong> Per-row savepoints mean a single constraint violation is isolated — the rest of your upload completes successfully.</li>
                    <li><strong>Protocol:</strong> Rule 11 added to AGENT_PROTOCOL.md — mandates single atomic commit for all lead write operations.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #d1fae5;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#f0fdf4;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.12.2</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔥 HOTFIX</span>
                        <span style="background:#7c3aed;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🛡️ STABILITY</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 12, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:#16a34a;margin-bottom:6px;">🔧 Dialer Edge-Case Hardening — 5 Critical Fixes</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>Fixed: Aircall users no longer see "Call via Aircall" when dialer is inactive.</strong> Call button correctly shows "Log Call" if your dialer is configured but disabled.</li>
                    <li><strong>Fixed: Messaging widget crash (classList error) eliminated.</strong> The Message button is now hidden for Aircall and no-dialer users — only RCM users see it.</li>
                    <li><strong>Fixed: 403 errors on page load resolved.</strong> Widget no longer hits an admin-only settings endpoint — sender configuration now comes directly from your per-user dialer status.</li>
                    <li><strong>Fixed: "Log Call" button tooltip updated</strong> to "Log the outcome of a manual call" when no active dialer is present.</li>
                    <li><strong>Defensive: isDialerActive</strong> now additionally checks the <code>active</code> flag, preventing any call routing to a misconfigured disabled dialer.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #fecdd3;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#fff1f2;">

                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.12.1</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔥 HOTFIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 12, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:#dc2626;margin-bottom:6px;">📞 Aircall Routing Fix — Call Button Now Works Correctly</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>Fixed:</strong> Clicking "Call via Aircall" was incorrectly showing the RCM "Phone Bridge / Browser Call" modal — now skipped entirely for Aircall users.</li>
                    <li><strong>Aircall flow:</strong> Button click → direct call via Aircall Phone app → toast confirmation. No intermediate modal.</li>
                    <li><strong>RCM flow unchanged:</strong> Mode selector still appears for RCM users to choose Phone Bridge or Browser Call.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #fed7aa;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#fff7ed;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.12.0</strong>
                        <span style="background:#ea580c;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔥 HOTFIX</span>
                        <span style="background:#00b388;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">📞 AIRCALL</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 12, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:#ea580c;margin-bottom:6px;">📞 Aircall UX — Provider-Aware Call Button &amp; Widget Gate</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>Smarter call button:</strong> The "Log Call" button now clearly labels itself <em>"📞 Call via Aircall"</em> (green) or <em>"💬 Call via RCM"</em> (purple) — no more guessing which dialer is active.</li>
                    <li><strong>RCM widget suppressed:</strong> The RCM floating messaging button (FAB) no longer appears for Aircall SDRs — it only initialises for RCM users.</li>
                    <li><strong>No config changes needed:</strong> Provider detection is automatic based on your admin dialer settings.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #dbeafe;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#eff6ff;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.11.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                        <span style="background:#0284c7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🩺 DIAGNOSTICS</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 12, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">🩺 Integration Health Diagnostics — Dialer & Chat</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>GET /api/dialer/health:</strong> Instantly check your Contact Center config — provider, API credentials, caller ID, and live API connectivity.</li>
                    <li><strong>GET /api/chat/health:</strong> Check RCM messaging setup — enabled flag, api_key, user_id, account_id, sender_id, and live API ping.</li>
                    <li><strong>Safe & masked:</strong> No secrets exposed — credential values shown as <code>abc***xyz</code>. Auth required.</li>
                    <li><strong>Status field:</strong> Returns <code>"ok"</code> or <code>"degraded"</code> with per-check detail messages — great for debugging staging vs prod.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #d1fae5;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#ecfdf5;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.10.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                        <span style="background:#25D366;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">💬 MESSAGING</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 12, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">💬 RCM Floating Widget — Unified Messaging Surface</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>💬 Message Button:</strong> A green <strong>Message</strong> button on every lead detail page opens the floating RCM widget with the lead's name and phone pre-loaded.</li>
                    <li><strong>🪟 Floating Widget:</strong> The widget is now the <em>only</em> messaging surface — it floats over the page and supports active-call state (timer, disconnect button).</li>
                    <li><strong>🚫 No-phone guard:</strong> Leads without a phone number see a clear notice instead of a blank compose area.</li>
                    <li><strong>📞 Timer sync:</strong> Widget call timer anchors to the actual call start time — no drift between dialer and messaging UI.</li>
                    <li><strong>⚙️ Admin-Controlled:</strong> Super Admins enable this via <strong>Settings → Sync → RCM Messaging</strong>. SDRs without it enabled see no UI change.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #fecaca;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#fff5f5;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.9.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                        <span style="background:#E74C3C;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔍 OBSERVABILITY</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 11, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">🔴 Error Logs — System Health Visibility for Admins</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🔍 Error Logs Tab:</strong> New tab in Audit Logs — every frontend JS error and backend 500 is automatically captured and translated into plain English. No more Render logs.</li>
                    <li><strong>🟡 / 🔴 Severity Cards:</strong> Critical vs Warning, with plain-English title, description, "What to do" hint, user email, timestamp, and ×N dedup badge.</li>
                    <li><strong>✓ Resolve:</strong> One-click resolve per error — card fades out, live badge clears. Resolver name recorded automatically from your login.</li>
                    <li><strong>🎯 Role-Scoped:</strong> Super Admin sees all; Pod Admin sees pod errors; SDRs see their own only.</li>
                    <li><strong>🗑️ Auto-Purge:</strong> Logs older than 15 days deleted nightly — zero manual cleanup needed.</li>
                    <li><strong>⚡ Zero Performance Impact:</strong> All error capturing is fire-and-forget in background threads.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #fde68a;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#fffbeb;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.8.2</strong>
                        <span style="background:#e17055;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔧 FIX</span>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 11, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">🐛 Research → Calling Gate Fix</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🔧 Research Gate Fixed:</strong> Fixed a blocker where the "Complete AI research first" warning appeared even after all four research fields were fully populated. The transition to <strong>Calling</strong> status now correctly unlocks as soon as research is complete.</li>
                    <li><strong>ℹ️ What was happening:</strong> The frontend was checking for HTML input elements that don't exist — research fields render as read-only text, so the check always failed. The fix reads research data directly from the lead record, matching what the backend validates.</li>
                    <li><strong>✅ No action needed:</strong> The fix is automatic — if your research fields are filled, you can now move to Calling immediately.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #d1fae5;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#ecfdf5;">

                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.8.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                        <span style="background:#0984e3;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🤖 AI</span>
                        <span style="background:#e17055;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔧 FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 8, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">🤖 AI Research Prompt Editor + Sandbox Export Fix</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>✍️ Prompt Editor (AI Settings):</strong> Super Admins can now customize the AI research prompt — live character counter, click-to-insert <code>{lead_context}</code> variable, and Save / Reset to Default. Shows Custom vs Default badge.</li>
                    <li><strong>🔄 Dynamic AI Prompts:</strong> The research backend now injects your custom prompt at runtime. Falls back to the system default if none is set — fully backward compatible.</li>
                    <li><strong>⚡ Sandbox Refresh Fixed:</strong> "Refresh from Production" was timing out on large databases. Now exports one table at a time — each request stays within Render's 30s limit.</li>
                    <li><strong>🧹 Sandbox UI Fix:</strong> Fixed the "Loading sandbox configuration..." text persisting below the rendered settings panel.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #fecaca;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#fff5f5;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.7.6</strong>
                        <span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔧 HOTFIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 8, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">🤖 AI Research Fixed — "Unexpected end of JSON input" Error Resolved</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🔗 Root Cause Fixed:</strong> The AI Research button was calling the wrong server (the static frontend instead of the API backend) due to a relative URL. This returned an HTML error page instead of JSON, causing the "Unexpected end of JSON input" error. Now correctly routes to the backend API.</li>
                    <li><strong>💾 Save Error Surfacing:</strong> Research saves that fail (e.g. network issues) now show an error toast instead of falsely displaying ✅ Saved — so you always know if your data was actually stored.</li>
                    <li><strong>📊 Progress Ring Accuracy:</strong> The progress sub-text now correctly says "X required fields left to unlock Calling" based on the 4 core fields, not the optional 11. Once the 4 required fields are filled, it shows "✅ Core research done — you can move to Calling".</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.7.1</strong>

                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                        <span style="background:#e74c3c;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🛡️ HARDENING</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 6, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">🛡️ System Hardening & Upload Center Fixes</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🧠 OOM Prevention:</strong> Large CSV uploads (over 5,000 rows) are now rejected server-side before they can exhaust memory.</li>
                    <li><strong>🏥 Deep Health Check:</strong> The /health endpoint now verifies live database connectivity and reports pool utilization.</li>
                    <li><strong>💥 Upload Wizard Fix:</strong> Fixed a crash in the CSV upload wizard caused by undeclared variables.</li>
                    <li><strong>🔄 Rollback Dialog Fix:</strong> Replaced the native browser confirm dialog with a custom modal to prevent accidental auto-dismissal.</li>
                    <li><strong>🗺️ Column Detection Fix:</strong> CSV uploads now correctly auto-detect <code>first_name</code> and <code>last_name</code> column headers.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.7.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                        <span style="background:#00b894;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">📞 OUTCOMES</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 6, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">🎯 Dynamic Call Outcomes — Config-Driven Outcome Management</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>⚙️ Admin Outcome Config:</strong> Super Admins can now enable/disable call outcomes, create up to 10 custom outcomes, and require notes — all from Settings → Sync, with no redeployment needed.</li>
                    <li><strong>🏷️ Outcome Groups:</strong> Each outcome belongs to a behavioral group (positive, negative, neutral, not_answered, terminal) with an associated action (continue, schedule_callback, disqualify).</li>
                    <li><strong>🚪 Left the Company:</strong> New builtin outcome that auto-disqualifies leads who have left their company.</li>
                    <li><strong>📝 Notes Required:</strong> Outcomes flagged as "notes required" block call logging until the SDR provides notes.</li>
                    <li><strong>📞 RCM Fix:</strong> Fixed HTTP 400 errors from legacy DialerCall records storing phone numbers instead of call IDs.</li>
                    <li><strong>🧪 827 Backend + 86 Playwright Tests Passing.</strong></li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.6.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                        <span style="background:#00b894;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">📞 WEBRTC</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">May 4, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">📞 RCM Dialer — WebRTC Browser Calling & Call Mode Selector</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🌐 LiveKit WebRTC:</strong> Calls now use the LiveKit WebRTC SDK for real-time browser audio — sub-second voice connection with no external app.</li>
                    <li><strong>📞 Call Mode Selector:</strong> Before each call, choose between Browser Call (WebRTC) or Phone Bridge mode. Browser Call is the default.</li>
                    <li><strong>🔒 HMAC Auth:</strong> All RCM API calls now use secure HMAC token authentication via RCMAuthManager.</li>
                    <li><strong>📦 Payload Alignment:</strong> Cleaned up API payloads — removed legacy fields for strict RCM API v2 compliance.</li>
                    <li><strong>🧪 773 Tests Passing:</strong> Updated edge case tests for HMAC auth and payload alignment. 0 failures.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.4.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                        <span style="background:#00b894;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">📞 DIALER</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 29, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">📞 RCM Contact Center Dialer — Dual-Dialer Architecture</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📞 RCM Dialer:</strong> Full integration with RCM Contact Center API for browser-based calling. SDRs assigned to RCM make calls directly in the browser — no external app needed.</li>
                    <li><strong>🌐 In-Browser Call Widget:</strong> A floating, draggable call widget with real-time duration timer, mute/hold/hangup controls, and recording indicator. Works on desktop and mobile.</li>
                    <li><strong>👤 Per-SDR Routing:</strong> Each SDR can be assigned to either Aircall or RCM — the system dynamically picks the right provider at call time. Nothing changes for Aircall users.</li>
                    <li><strong>🔄 Dual Sync:</strong> Call sync jobs now run for both providers independently — call history stays complete regardless of which dialer an SDR uses.</li>
                    <li><strong>🔗 Real-Time Webhooks:</strong> RCM call events (started, answered, ended) are processed in real time — call logs update automatically.</li>
                    <li><strong>📋 Provider Badge:</strong> Call history cards now show "via RCM" or "via Aircall" badges so you can see which dialer was used for each call.</li>
                    <li><strong>🧪 51 New Tests:</strong> Comprehensive test suite covering all RCM provider operations, webhook parsing, retry logic, and edge cases. 701 total tests passing.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.3.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                        <span style="background:#00b894;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔄 ROLLBACK</span>
                        <span style="background:#E74C3C;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔧 FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 28, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">🔄 Batch Rollback, Data Alignment & UX Stability</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🔄 12-Hour Batch Rollback:</strong> Admins can undo an entire import batch (CSV or Google Sheet) within 12 hours of upload. Worked leads (with call history or status changes) are automatically protected. A live countdown timer shows remaining rollback window.</li>
                    <li><strong>📋 Expandable Upload History:</strong> Upload History rows now expand to show per-SDR assignment details — which SDR received which leads — directly inline.</li>
                    <li><strong>📊 Lead Count Alignment:</strong> Dashboard and Leads page now show identical counts. Parked leads are globally excluded from list/kanban views to match dashboard metrics.</li>
                    <li><strong>🤖 AI Research Fix:</strong> Auto-trigger now fires when fewer than 3 research fields are filled (previously required exactly 0), fixing cases where partial research blocked auto-population.</li>
                    <li><strong>📅 Sidebar Reorganization:</strong> "Daily Digest" moved below Dashboard for better admin access. "Today\\'s Calls" now visible only to SDRs.</li>
                    <li><strong>🧪 104/104 Tests Green:</strong> 26 new stability tests + 10 pre-existing test fixes. Full regression suite passing.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.2.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                        <span style="background:#E74C3C;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">📵 DATA QUALITY</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 27, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">📵 No-Phone Lead Quarantine — Data Quality & SDR Protection</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📵 Phone Validation:</strong> CSV and Google Sheet uploads now validate phone fields. Rows without any valid phone number (≥7 digits) are automatically skipped — count reported in upload summary.</li>
                    <li><strong>🚫 Status Quarantine:</strong> Phoneless leads are set to "No Phone - Parked" — a new status that prevents assignment to SDRs. Dashboard shows a red 📵 card with the parked count.</li>
                    <li><strong>🔄 Auto-Revert:</strong> When a phone number is added to a parked lead, it automatically reverts to "Lead Assigned". SDRs get auto-assigned; Admin edits keep it unassigned.</li>
                    <li><strong>📈 Clean Analytics:</strong> Parked leads are excluded from all analytics — funnel, SDR table, daily digest, and dashboard totals — ensuring metrics only reflect actionable pipeline.</li>
                    <li><strong>🔒 Assignment Guards:</strong> Bulk-assign and auto-assign endpoints now filter out parked leads, preventing accidental assignment of phoneless leads.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.1.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                        <span style="background:#00b894;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">⚡ PERF</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 27, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">📊 Daily Digest — Super Admin Leadership Summary + Assignment Performance Optimization</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📊 Daily Digest (Super Admin):</strong> New one-page operational summary with 6 KPI cards showing delta % vs. same weekday last week, pipeline flow transitions, SDR performance snapshot (sorted by activity), and notable events (top performer, stuck leads, batch uploads). Includes date picker and PDF export.</li>
                    <li><strong>⚡ Assignment Endpoint Optimization:</strong> Switched admin assignment views from full lead serialization to lightweight summary format — faster page loads for unassigned/assigned lead tables.</li>
                    <li><strong>🔧 N+1 Query Fix:</strong> Replaced joinedload with subqueryload for call_logs in assignment routes, eliminating redundant database queries on large lead sets.</li>
                    <li><strong>📅 Chronological Sort:</strong> Leads in assignment views now sorted by creation date (newest first) for consistent ordering.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.0.1</strong>
                        <span style="background:#E74C3C;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔒 SECURITY</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 22, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">🔧 Post-Deploy Stabilization — Security, UX & UI Fixes</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🔒 View-As Token Isolation:</strong> Fixed a critical bug where "View As" permanently overwrote the admin's JWT token, changing their actual role. Now uses isolated sessionStorage — an amber banner shows when View-As is active with a one-click Exit button.</li>
                    <li><strong>⌨️ Search Hotkeys:</strong> Press <strong>⌘K</strong> (Mac) or <strong>Ctrl+K</strong> (Windows) to instantly focus the search bar from anywhere. <strong>/</strong> (forward slash) also works when not in a text field. A subtle ⌘K hint badge appears in the search bar.</li>
                    <li><strong>📦 POD Add SDR Dropdown Fix:</strong> Fixed the "Add SDR" dropdown in POD Management being clipped behind the card boundary. Dropdown now renders above adjacent cards correctly.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v5.0.0</strong>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 22, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">🚀 Performance & UX Re-Engineering — Search, Skeleton Loaders, State & Timezone Fixes</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📞 Phone Search:</strong> Global search bar now supports phone number lookup (primary & secondary) — search by full or partial number, including +country code format.</li>
                    <li><strong>💀 Skeleton Loaders:</strong> All blocking spinners replaced with animated skeleton loaders across Admin, Assignments, Audit Logs, SDR Settings, and SF Logs — 60-80% faster perceived load time.</li>
                    <li><strong>🔄 Tab State Persistence:</strong> Switching tabs (Leads → Dashboard → Leads) no longer resets your filters, pagination, or sort settings. State clears naturally on browser tab close or logout.</li>
                    <li><strong>⏰ Task Reminder Timezone Fix:</strong> Fixed reminders firing 5+ hours late (e.g. 11 AM reminder alerting at 4:30 PM). Timezone conversion now correctly handles IST → UTC.</li>
                    <li><strong>📅 Notification Delay Fix:</strong> Morning notifications no longer appear the next day — same timezone root cause resolved.</li>
                    <li><strong>🧪 20 New Tests:</strong> Comprehensive search test suite covering phone matching, SDR scope enforcement, SQL injection safety, and edge cases.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.12.0</strong>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 20, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">📊 Analytics Dashboard Redesign — Hierarchical Filters, SDR Picker, Chart & Layout Fixes</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>① → ④ Filter Hierarchy:</strong> POD → Date Range → Batch → Refine. Each step unlocks the next — numbered step pills guide you through the sequence.</li>
                    <li><strong>🗺️ Breadcrumb Trail:</strong> A persistent bar at the top always shows exactly what context you're viewing (POD / date range / batch selected).</li>
                    <li><strong>💡 Insight Bar:</strong> Rule-based status tags (No Calls Today, Low Connect Rate, On Track) + a live AI Recommendation powered by Groq — loads non-blocking, cached for 2 minutes.</li>
                    <li><strong>📊 Funnel Strip:</strong> Horizontal Leads → Calls → Connects → Meetings with % conversion between each stage.</li>
                    <li><strong>📋 6 KPI Cards:</strong> Leads, Research, Emails, Calls, Connect %, and Disqualified — all in a unified metric grid.</li>
                    <li><strong>🔍 Searchable SDR Picker:</strong> Replaced the scrollable SDR pill row with a search-driven picker — type to filter, select as a removable chip, or click "All SDRs" to reset. No more horizontal scrolling.</li>
                    <li><strong>📈 5-Metric Trend Toggles:</strong> Toggle Calls, Meetings, Research, Disqualified, or Emails on the trend chart without refetching data.</li>
                    <li><strong>🔀 All Batches Mode:</strong> Replace the SDR table with a full-width batch comparison table — per-batch Leads, Calls, Connect %, Meetings, and Emails with a totals row.</li>
                    <li><strong>📐 Layout Fixes:</strong> Chart and SDR table panels now size independently — no chart stretching. SDR table scrolls internally (max 440px), eliminating whitespace below the chart.</li>
                    <li><strong>⏩ Compact Pagination:</strong> SDR table pagination redesigned as compact ← / → buttons with "N / M" page indicator.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #fecaca;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#fff5f5;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.11.2</strong>
                        <span style="background:#E74C3C;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔧 CRITICAL FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 19, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">📊 Analytics Batch Filter — Data Discrepancy Fix</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📊 Batch Filter Fixed:</strong> Selecting a batch in the analytics dashboard now correctly shows all assigned leads, calls, emails, and meetings for that batch. Previously showed 0 leads due to a broken internal column reference.</li>
                    <li><strong>📈 All Endpoints Updated:</strong> Batch filtering now works consistently across KPI cards, trend chart, SDR performance table, and email breakdown — previously only KPI cards attempted (broken) batch filtering.</li>
                    <li><strong>📧 Email Source Filter:</strong> Fixed email breakdown source filter using wrong matching logic, ensuring accurate email counts when filtering by source type.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #d1fae5;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#ecfdf5;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.11.1</strong>
                        <span style="background:#E74C3C;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔧 FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 19, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">📊 Analytics Dashboard Stabilization — Filters, Data Accuracy & UX</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📊 Source Filter:</strong> Cleaned up lead source dropdown — raw import strings replaced with clean labels (Google Sheet, Uploaded, Salesforce, Manual)</li>
                    <li><strong>👥 Pod Filter Fixed:</strong> Pod filter now renders correctly for Super Admins — was silently missing due to a localStorage key mismatch</li>
                    <li><strong>🔗 Pod → SDR Cascade:</strong> Selecting a Pod now filters the SDR dropdown to show only SDRs in that Pod</li>
                    <li><strong>☑️ Inactive SDR Detection:</strong> Overhauled logic — SDRs are flagged inactive only when they have no login AND zero call/email activity</li>
                    <li><strong>📅 Meetings Count Fixed:</strong> Meetings now count from all assigned leads regardless of date filter — no more false zeros</li>
                    <li><strong>📡 Activity Feed Visibility:</strong> Toggle moved between SDR table and trend charts for easier access</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid #fecaca;border-radius:10px;padding:16px 20px;margin-bottom:14px;background:#fff5f5;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.10.3</strong>
                        <span style="background:#E74C3C;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔧 HOTFIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 16, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">🔒 Security Fix — Phone Number Hidden in Dashboard Priority Queue</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🔒 Priority Queue Phone Masking:</strong> Phone numbers in the Dashboard Priority Queue are now hidden until research is complete — consistent with the lead list. Leads with incomplete research show a <strong>🔒 Hidden</strong> badge and the Call button is blocked. Complete research on the lead detail page to unlock calling.</li>
                    <li><strong>🛡️ Data Leakage Fix:</strong> Previously, phone numbers were visible to SDRs in the Priority Queue regardless of research status — this was a data exposure bug.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.10.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 16, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">📂 Batch Tracker moved to Upload Center + Lead Link Fix</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📂 Batch Tracker in Upload Center:</strong> The Upload Batch Tracker has moved from the Activity Feed to a dedicated tab inside the Upload Center — more intuitive to find, right next to your upload tools.</li>
                    <li><strong>📊 Summary Cards:</strong> The Batch Tracker tab shows Total Batches, Leads in DB, Meetings Scheduled, and overall Conversion % at a glance.</li>
                    <li><strong>🔍 Per-Lead Drill-Down:</strong> Click any batch card to see every individual lead — name, company, status, assigned SDR, call count, last call outcome, and research status.</li>
                    <li><strong>🔗 Lead Navigation Fixed:</strong> Lead name links in the drill-down table now correctly open the lead's detail page.</li>
                    <li><strong>🧹 Activity Feed Cleaned Up:</strong> Activity Feed is now exclusively focused on real-time call, email, status, and research events.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.9.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 13, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Research-First Workflow Enhancements</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🔒 Phone Number Masking:</strong> The Phone and Secondary Phone fields are now masked and hidden behind a "Hidden (Complete Research)" badge until all research fields are completed.</li>
                    <li><strong>🎯 Auto-Expanded Call Strategy:</strong> When a lead transitions to the Calling status, the Call Strategy accordion automatically expands so your Hook and Pitch Angle are immediately visible.</li>
                    <li><strong>🤖 Automated AI Research Trigger:</strong> Clicking any of the research accordions will automatically trigger the AI Research generation, provided you haven't already started manual research.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.8.2</strong>
                        <span style="background:#E74C3C;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔧 HOTFIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 13, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Aircall API Integration Fix</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📞 Aircall Empty Response Crash:</strong> Fixed a production issue where the Aircall dialer integration would crash (JSONDecodeError) when the API returned an HTTP success code but an empty response body. Call initiation now handles empty responses gracefully.</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.8.1</strong>
                        <span style="background:#E74C3C;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔧 FIX</span>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 10, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Lead Management Workflow Improvements + SDR Filter Fix</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📵 No-Phone Disqualification:</strong> Leads without phone numbers can now be disqualified directly using the "No Phone Number" reason — no call logging required. A yellow info banner guides users on no-phone leads</li>
                    <li><strong>🗑️ Direct Lead Deletion:</strong> Admin-only "Delete Lead" button on the lead detail page with confirmation modal — no more navigating to Assignments for single-lead removal</li>
                    <li><strong>👤 SDR Filter (All Leads):</strong> Admins can filter leads by assigned SDR on the All Leads page. Date filters auto-clear when an SDR is selected</li>
                    <li><strong>🔧 Assignments SDR Filter Fix:</strong> Fixed the SDR filter on the Assignments tab not filtering results — caused by duplicate element IDs between tabs</li>
                    <li><strong>🔧 Date Range Collision Fix:</strong> SDR filter no longer shows zero results when older leads fall outside the default 6-month date range</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.8.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 10, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">📡 Unified Activity Feed — Track Call Outcomes & Team Interactions</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📡 Activity Feed:</strong> New admin-only dashboard aggregating all SDR calls, emails, status changes, and research into a single filterable, paginated view — understand what happened, how customers connected, and what's pending</li>
                    <li><strong>🎯 Call Strategy View:</strong> Expanded call details now show the personalization angle, research hypothesis, call notes, recording player, and transcript — everything a manager needs without opening the lead</li>
                    <li><strong>📧 Structured Email Section:</strong> Email details display subject, direction, body preview, and open tracking stats in a professional grid layout</li>
                    <li><strong>📝 Notes / Summary Column:</strong> Table column shows intelligent preview of call notes, email subjects, or status transitions at a glance</li>
                    <li><strong>🔍 Smart Search:</strong> Searching by lead or company automatically bypasses date filters to search across all time</li>
                    <li><strong>🧹 Deduplication:</strong> Only the latest activity per lead per type is shown — keeping the feed clean and focused</li>
                    <li><strong>📥 CSV Export:</strong> Download filtered activities as a spreadsheet including Call Strategy</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.7.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 9, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Lead Priority Queue — Post-Call Deprioritization</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>⬇️ Automatic Deprioritization:</strong> Leads are now automatically deprioritized after calls are logged, keeping your My Leads list focused strictly on fresh, unworked contacts</li>
                    <li><strong>🟡 Medium Priority:</strong> A lead called once today is marked as Medium priority (amber row border + "Called Today" badge)</li>
                    <li><strong>⬇️ Deprioritized:</strong> A lead called 2+ times today sinks to the bottom (faded row + "Deprioritized" badge)</li>
                    <li><strong>↑ Re-prioritize:</strong> You can explicitly push a lead back to High priority by clicking the "↑ Re-prioritize" button on the lead's row</li>
                    <li><strong>📈 Sorted by Score:</strong> My Leads table is now properly ordered with High priority floating to the top, regardless of when they were added</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.6.2</strong>
                        <span style="background:#E74C3C;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔧 FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 8, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Outcome Filter Precision Fix + Task Time Picker</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🔍 Call Back Later Filter (Regression Fix):</strong> Leads who had a historical "Call Back Later" call but were subsequently updated to a different outcome (e.g. "Meeting Confirmed") were incorrectly appearing in the filter. Now only the <strong>most recent call per lead</strong> is evaluated using a ranked window function</li>
                    <li><strong>🕐 Task Time Picker:</strong> Task creation form now includes a <strong>due time</strong> field alongside the due date — so notifications fire at the exact time you need them, not just on the day</li>
                    <li><strong>🛡️ Task Error Handling:</strong> "Add Task" button now shows a loading state and restores itself on API failure with a toast notification — no more silent crashes or ghost entries</li>
                    <li><strong>🧪 +20 Tests:</strong> 4 backend regression tests for the outcome filter, plus 16 Playwright E2E tests covering filter precision, task CRUD, time picker, snooze/dismiss state, and filter persistence</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.6.1</strong>
                        <span style="background:#E74C3C;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔧 FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 8, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Dialer Outcome Filter Fix + Task Notification Stability</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🔍 Dialer Outcome Filter:</strong> Fixed a bug where clicking a call outcome filter (e.g. "Call Back Later") on the dashboard would miss leads called via Aircall or RCM dialer. All leads with that outcome now appear correctly regardless of which calling method was used</li>
                    <li><strong>🔔 Task Notifications:</strong> Fixed "ghost task" issue — snoozing or dismissing a task now only removes it from the notification panel when the server confirms the action. If there's a network issue, the button re-enables so you can try again</li>
                    <li><strong>🧪 43 New Tests:</strong> Backend test coverage added for task lifecycle (create, complete, snooze, dismiss) and outcome filtering across both manual and dialer call sources</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.6.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 8, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Pod-Based Upload Assignment + Branding Update</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📦 Pod-Based Uploads:</strong> Upload Center now lets you assign leads to an entire Pod instead of a single SDR — leads are distributed via intelligent round-robin across all SDRs in the pod</li>
                    <li><strong>🏢 Company Grouping:</strong> Leads from the same company are always assigned to the same SDR — no more scattered outreach to the same hospital across multiple reps</li>
                    <li><strong>👤 SDR Dropdown Retained:</strong> Both "Assign to Pod" and "Assign to SDR" dropdowns available — mutually exclusive, selecting one auto-clears the other</li>
                    <li><strong>🔄 Leads Follow User:</strong> When an SDR is transferred between Pods, their active leads automatically move with them to the new Pod</li>
                    <li><strong>🎨 Branding Update:</strong> Updated to "RCM · Powered by RCM" with new RCM favicon and logo across login page, sidebar, and browser tab</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.5.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 7, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Universal Lead Creation for All Roles</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🆕 New Lead for Everyone:</strong> The "+ New Lead" button is now available to SDRs, Pod Admins, and Super Admins — perfect for adding referrals mid-call when a lead gives you a new contact or number</li>
                    <li><strong>📝 Expanded Form:</strong> Create leads with full detail — First/Last Name, Company, Title, Phone, Secondary Phone, Email, LinkedIn URL, and Initial Status in a clean two-column layout</li>
                    <li><strong>🔗 Auto-Assign:</strong> New leads are automatically assigned to you and appear instantly in your "My Leads" list. Pod assignment is inherited from your team</li>
                    <li><strong>🔒 Security:</strong> Backend auth guard added. Initial status restricted to "Lead Assigned" or "Research" only</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.4.1</strong>
                        <span style="background:#3B82F6;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🎨 UI</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 7, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Sidebar Toggle Redesign</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📐 Toggle Relocated:</strong> Sidebar collapse/expand button moved from the bottom bar to a floating circular button at the top edge of the sidebar — sits outside the sidebar on the boundary for a cleaner, modern look</li>
                    <li><strong>🎯 Subtle Chevron:</strong> Replaced double « » chevrons with single ‹ › for a more professional appearance — small 28px white circle with drop shadow</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.4.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 7, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Collapsible Sidebar + Email Formatting Fix + Origin Tagging</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📐 Collapsible Sidebar:</strong> Toggle between expanded (260px with labels) and compact (72px icon-only) mode — state persists across sessions, hover tooltips in collapsed mode, works for all roles</li>
                    <li><strong>✉️ Email Formatting:</strong> Emails now preserve your line breaks and paragraphs — previously all formatting was lost when the recipient received the email</li>
                    <li><strong>📧 Origin Tagging:</strong> Outbound emails include a subtle "RCM · Powered by RCM" footer and invisible X-Mailer header for tracking emails sent from the CRM</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.3.3</strong>
                        <span style="background:#E74C3C;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔧 FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 6, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">SDR Metrics Accuracy + Email Connect Fix</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📊 SDR Metrics:</strong> Metrics dashboard now only counts SDR users — admin and Pod Admin activity no longer inflates KPIs, trends, or the SDR performance table</li>
                    <li><strong>✉️ Email Connect:</strong> After connecting email, SDRs now correctly return to My Settings instead of seeing a blank page</li>
                    <li><strong>🔔 Success Toast:</strong> "Email connected successfully" confirmation now appears for all user roles after OAuth</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.3.2</strong>
                        <span style="background:#E74C3C;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🔧 FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 6, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Email Fixes — Full Body + Accurate Open Tracking</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📧 Full Email Body:</strong> Emails are no longer truncated — you can now see the complete email including the sender's signature and contact details</li>
                    <li><strong>👁️ Accurate Open Tracking:</strong> Email open counts now only track when the <em>recipient</em> opens the email — the sender's own view in their Sent folder is no longer counted</li>
                    <li><strong>✂️ Signature Preserved:</strong> Email sign-offs like "Best, Name" are no longer stripped from the email body</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.3.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 6, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Email UI Redesign + Attachment Support</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>✉️ Email Redesign:</strong> Professional flat card layout replaces gradient chat bubbles — outbound emails have amber left border, inbound emails have blue left border</li>
                    <li><strong>📎 Attachments:</strong> Email cards show attachment chips with download links — click to download files directly</li>
                    <li><strong>🔄 Auto-Refresh:</strong> Email and Calls tabs auto-refresh when switching between them</li>
                    <li><strong>📏 Smart Sizing:</strong> Email cards fit content width — short emails no longer stretch to full width</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.2.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 2, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Conversations Tab + Email Open Tracking</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>💬 Conversations:</strong> New tab on lead detail — message leads directly from RCM via the RCM messaging integration. Uses phone fallback and per-SDR identity tagging</li>
                    <li><strong>📧 Email Open Tracking:</strong> Outbound emails now track opens — a green "Opened" badge shows view count and first-opened time, gray "Sent" badge for unread emails</li>
                    <li><strong>👁️ Per-SDR Identity:</strong> Each SDR can be assigned a Conversations user ID in Admin panel for proper message attribution</li>
                    <li><strong>📱 Phone Fallback:</strong> Conversations uses secondary phone when primary is missing, so more leads can be reached</li>
                    <li><strong>🔒 Webhook Resilience:</strong> Email tracking webhook handles edge cases — unknown messages, rapid-fire opens, missing fields — without errors</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.1.1</strong>
                        <span style="background:#059669;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🐛 FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 1, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Security Hardening + Delete Fix + Navigation Cleanup</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🔒 Security Hardening:</strong> Internal security improvements — logging cleanup, authentication defaults tightened, credential handling improved</li>
                    <li><strong>🗑️ Delete Fix:</strong> Fixed bulk delete failing for leads with email activity or dialer call records</li>
                    <li><strong>🔧 My Settings:</strong> "My Settings" now only appears for SDR and Pod Admin — Super Admins use the full Settings page</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.1.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">April 1, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Company-Level Call Resolution + Metrics Fix</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🏢 Company Connected:</strong> When a meeting is booked with any contact at a company, all other leads at that company are flagged with a "Company Connected" badge — preventing redundant outreach</li>
                    <li><strong>📋 Lead List Badge:</strong> "✅ Company Connected" badges appear in company group headers and on individual lead rows</li>
                    <li><strong>📄 Detail Banner:</strong> Lead detail shows an amber "Company Already Connected" banner with the resolved contact's name</li>
                    <li><strong>📞 Call Warning:</strong> Call modal shows a warning when calling into a company that already has a meeting booked</li>
                    <li><strong>📊 Metrics Fix:</strong> Fixed SDR Metrics meeting count — was showing 2 instead of 7 due to missing activity log events from the call outcome path</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.0.2</strong>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">March 31, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Aircall Dialer Fixes + Call Outcome Improvements</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📞 Aircall Fix:</strong> Fixed user matching — all Aircall users are now fetched across pages. SDRs who couldn't initiate calls can now use click-to-call</li>
                    <li><strong>📋 No More Duplicates:</strong> Logging a call outcome after an Aircall call now updates the same record instead of creating a duplicate entry</li>
                    <li><strong>📞 Meeting Scheduled:</strong> "Meeting Scheduled" outcome no longer moves the lead — lead stays in Calling for tentative bookings. Only "Meeting Confirmed" transitions the lead and triggers Salesforce sync</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.0.1</strong>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">March 31, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Metrics & Activity Fixes + Email Connect UX</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📊 Metrics Fix:</strong> Fixed dashboard metrics showing zeros — stale login-only data no longer blocks real activity reporting</li>
                    <li><strong>👤 Activity Status:</strong> User status badges (Active/Idle/Inactive) now reflect real heartbeat and interaction data instead of login timestamps</li>
                    <li><strong>🧹 Session Cleanup:</strong> Stale sessions (>30 min without activity) are now auto-closed — no more zombie sessions</li>
                    <li><strong>✉️ Email Connect:</strong> Connecting your email now redirects you back to Settings with a success confirmation instead of dropping you on Leads</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v4.0.0</strong>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">March 30, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Architecture Overhaul — 502/503 Root Cause Fixes</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>⚡ Email Sync Rewrite:</strong> Rewrote from async to sync — emails return instantly from cache, Nylas syncs in background with isolated DB session (fixes 502)</li>
                    <li><strong>🚀 Webhook 10x Faster:</strong> Replaced O(N) in-memory lead scan with O(1) SQL phone lookup — response time dropped from ~5s to <50ms (fixes 503)</li>
                    <li><strong>📱 Phone Matching:</strong> SQL-level matching handles all formats — E.164, digits-only, dashes, spaces — via indexed query</li>
                    <li><strong>✉️ Email Preview:</strong> Quoted text, forwarded messages, and signatures stripped from previews</li>
                    <li><strong>♿ Accessibility:</strong> Fixed Chrome label-for warnings on email compose toggles</li>
                    <li><strong>🧪 237 Tests:</strong> 40 new root-cause-specific tests covering sync behavior, phone matching, and webhook resilience</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v3.10.0</strong>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">March 27, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Aircall Dialer Integration + Call Recording + Unified Calls Tab</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📞 Aircall Dialer:</strong> Click-to-call from lead detail — automatic call tracking, duration, and recording capture via Aircall</li>
                    <li><strong>🎙️ Call Recordings:</strong> Embedded audio player on call cards — listen and download recordings directly</li>
                    <li><strong>📊 Unified Calls Tab:</strong> Manual logs and Aircall calls merged into a single sorted view with stats</li>
                    <li><strong>✉️ Email Tab:</strong> Emails moved to a dedicated tab with threaded view and quoted text stripping</li>
                    <li><strong>⚙️ Dialer Config:</strong> Super Admins configure Aircall credentials and phone numbers in Settings → Dialer</li>
                    <li><strong>🔒 Auto-Tracking:</strong> Manual call logging disabled when Aircall is active — prevents duplicates</li>
                    <li><strong>🐛 Bug Fixes:</strong> Fixed call modal race condition, orphaned records, and FAILED ghost entries</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v3.9.2</strong>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">March 27, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Company Filter + Pagination Persistence + Phone Fixes</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🏢 Company Filter:</strong> Filter leads by hospital/company — view all personas at once without switching pages</li>
                    <li><strong>📌 Pagination Memory:</strong> Leads page remembers your page, search, and filters when navigating to a lead and back</li>
                    <li><strong>📱 Phone Fallback:</strong> Phone column now shows secondary phone when primary is missing — "No Phone" only when both are empty</li>
                    <li><strong>📞 Secondary Phone Fix:</strong> Fixed bug where secondary phone wasn't saved during lead upload</li>
                    <li><strong>🎨 Filter Layout:</strong> Improved All Leads filter bar layout — all controls in one clean inline row</li>
                    <li><strong>🏆 Leaderboard:</strong> Removed stray dashes under SDR names without POD assignment</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v3.9.1</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">March 27, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Auto-Assign SDR on Upload + Email Fix + Time Tracking</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>👤 Auto-Assign SDR:</strong> Upload Center now includes an "Assign to SDR" dropdown — select an SDR to auto-assign all newly imported leads</li>
                    <li><strong>✉️ Email Validation:</strong> Company names in Email column no longer cause false-positive duplicate skips during upload</li>
                    <li><strong>⏱️ Time Tracking Fix:</strong> SDR Metrics "Time Spent" now uses activity heartbeats — no more inflated idle-time numbers</li>
                    <li><strong>🔧 Dropdown Filter:</strong> "Assign to SDR" dropdown shows only SDR and Pod Admin roles</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v3.9.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">March 26, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">AI Research + Smart Leads Table + Keep-Alive</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🤖 AI Research:</strong> One-click AI-powered lead enrichment using Groq LLM — fills 10+ research fields with company-level caching</li>
                    <li><strong>🏢 Company Grouping:</strong> Leads table groups contacts by company with visual headers and lead count</li>
                    <li><strong>📵 No-Phone Highlighting:</strong> Leads without phone numbers are flagged with yellow rows and red badges</li>
                    <li><strong>📝 Notes Preview:</strong> Latest note shown directly in leads table — see notes without clicking into each lead</li>
                    <li><strong>⚙️ AI Settings:</strong> Super Admins can configure LLM provider, API key, and model from Settings</li>
                    <li><strong>🔄 Keep-Alive:</strong> Server self-pings every 10 min to prevent cold starts on Render free tier</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v3.8.1</strong>
                        <span style="background:#059669;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">🐛 FIX</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">March 26, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Email Fix + Data Cleanup + SDR Metrics Improvements</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>✉️ Email Name Fix:</strong> Inbound email replies now display the lead's name instead of their email address</li>
                    <li><strong>👤 Duplicate Name Cleanup:</strong> Fixed leads with duplicate full names caused by CSV import mapping</li>
                    <li><strong>📊 SDR Metrics Data:</strong> KPI cards, charts, and Per-SDR table now show real-time data even before daily aggregation runs</li>
                    <li><strong>📊 Chart Fix:</strong> Fixed "No data yet" messages stacking up when switching date filters</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v3.8.0</strong>
                        <span style="background:#6C5CE7;color:#fff;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;">✨ NEW</span>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">March 25, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Lead Enrichment + Smart Assignment + Email Integration</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📞 Secondary Phone:</strong> New "Secondary Phone" field on lead detail — auto-populated from imports or editable by SDRs</li>
                    <li><strong>🔗 LinkedIn Link:</strong> Clickable "View Profile" link on lead detail Contact Information card</li>
                    <li><strong>🏢 Company-Based Round Robin:</strong> Auto-assign now groups all contacts from the same company to a single SDR</li>
                    <li><strong>📱 Broadened Phone Mapping:</strong> Upload recognizes 20+ phone column variants (e.g., "Enriched Mobile Phone", "Direct Phone")</li>
                    <li><strong>⚡ Assignments Performance:</strong> Assignments tab loads 5-10x faster — fixed per-lead settings query and added eager loading</li>
                    <li><strong>✉️ Nylas Email Integration:</strong> OAuth flow, email sending, activity logging, and webhook listener for inbound email tracking</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v3.7.0</strong>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">March 24, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Bulk Assignment Management</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🔍 SDR Filter:</strong> Filter Assignments page by specific SDR to manage their workload</li>
                    <li><strong>📦 Bulk Unassign:</strong> Select multiple leads and unassign them in one click (Pod Admin + Super Admin)</li>
                    <li><strong>🗑️ Bulk Delete:</strong> Permanently delete selected leads with all associated data — Super Admin only</li>
                    <li><strong>✅ Floating Action Bar:</strong> Context-aware toolbar with Assign, Unassign, and Delete actions</li>
                    <li><strong>🐛 Bug Fix:</strong> "Lead Assigned" status filter now correctly shows matching leads</li>
                    <li><strong>🧪 E2E Tests:</strong> Expanded from 35 to 48 end-to-end tests</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v3.6.0</strong>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">March 23, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">RCM Rebrand + Login Revamp</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🚀 RCM Rebrand:</strong> Renamed from "RCM CRM" to "RCM" across all user-facing surfaces</li>
                    <li><strong>✨ Revamped Login Page:</strong> New dark navy + amber/gold design with floating spark animations</li>
                    <li><strong>Updated Tagline:</strong> "Turn raw leads into qualified prospects"</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v3.5.0 – v3.5.2</strong>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">March 23, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Leaderboard + Metrics UX + Settings + SF Push + Export Fix</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>🏆 Leaderboard Time-Periods:</strong> Filter rankings by 7D / 30D / 90D / All Time</li>
                    <li><strong>📈 SDR Metrics UX:</strong> Date range picker, SDR search, pagination</li>
                    <li><strong>⚙️ Settings Revamp:</strong> 2-tab layout, hidden for SDRs</li>
                    <li><strong>19-Field SF Push:</strong> Enriched Salesforce push with research notes</li>
                    <li><strong>Export Fix:</strong> Fixed metrics CSV/XLSX 401 error</li>
                </ul>
            </div>

            <div class="release-entry" style="border:1px solid var(--border-color);border-radius:10px;padding:16px 20px;margin-bottom:14px;background:var(--bg-primary);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <strong style="font-size:1rem;">v3.0.0 – v3.4.0</strong>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">March 11–18, 2026</span>
                </div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--primary-color);margin-bottom:6px;">Upload Center · Outcomes · Admin Panel · Multi-Role · Core CRM</div>
                <ul style="margin:0;padding-left:18px;font-size:0.85rem;">
                    <li><strong>📤 Upload Center:</strong> CSV/XLSX import with smart mapping and deduplication</li>
                    <li><strong>🏷️ Opportunity Outcome:</strong> Won/Lost tracking for Meeting Scheduled leads</li>
                    <li><strong>🛡️ Admin Panel:</strong> Stats cards, search, filters, activity badges, CSV export</li>
                    <li><strong>🔒 Audit Logs:</strong> 4-tab unified view (Activity, Login, Feedback, SF Logs)</li>
                    <li><strong>👥 Three-Role System:</strong> Super Admin, Pod Admin, SDR with POD management</li>
                    <li><strong>📊 Core CRM:</strong> Dashboard, leads, pipeline, call logging, Salesforce sync, Google SSO</li>
                </ul>
            </div>
        `
    });

    // ── Reorder: Release Notes always first ──────────────────────────────
    // The release notes section was pushed last — move it to position 0.
    sections.unshift(sections.pop());

    // Filter sections visible to this role
    const visibleSections = sections.filter(s => s.roles.includes(role));

    const sectionsHTML = visibleSections.map((s, i) => `
        <div class="guide-section" data-idx="${i}">
            <div class="guide-section-header" data-toggle="${i}">
                <span>${s.title}</span>
                <svg class="guide-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </div>
            <div class="guide-section-body" id="guide-body-${i}" style="display:none;">
                ${s.content}
            </div>
        </div>
    `).join('');

    container.innerHTML = `
    <div class="fade-in">
        <div class="page-header" style="margin-bottom:24px;">
            <div>
                <h1 class="page-title">Help & User Guide</h1>
                <p class="page-subtitle">Everything you need to know about RCM · Showing guide for <strong>${roleName}</strong></p>
            </div>
        </div>

        <div class="guide-search-wrap">
            <input type="text" id="guide-search" placeholder="🔍  Search the guide..." class="guide-search-input">
        </div>

        <div id="guide-sections">
            ${sectionsHTML}
        </div>

        <div style="text-align:center;padding:32px 0;font-size:0.78rem;color:var(--text-muted);">
            RCM · Powered by RCM · v8.2.0 · Last updated May 2026
        </div>
    </div>`;

    // Accordion toggle
    container.querySelectorAll('.guide-section-header').forEach(header => {
        header.addEventListener('click', () => {
            const idx = header.dataset.toggle;
            const body = document.getElementById(`guide-body-${idx}`);
            const chevron = header.querySelector('.guide-chevron');
            if (body.style.display === 'none') {
                body.style.display = 'block';
                chevron.style.transform = 'rotate(180deg)';
            } else {
                body.style.display = 'none';
                chevron.style.transform = 'rotate(0deg)';
            }
        });
    });

    // No section expanded by default — all start collapsed

    // Search filter
    const searchInput = document.getElementById('guide-search');
    const guideSections = document.getElementById('guide-sections');
    if (searchInput && guideSections) {
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.toLowerCase().trim();
            guideSections.querySelectorAll('.guide-section').forEach(sec => {
                const idx = sec.dataset.idx;
                const body = document.getElementById(`guide-body-${idx}`);
                const chevron = sec.querySelector('.guide-chevron');
                if (!query) {
                    sec.style.display = 'block';
                    // Collapse all when search is cleared
                    if (body) body.style.display = 'none';
                    if (chevron) chevron.style.transform = 'rotate(0deg)';
                    return;
                }
                const text = sec.textContent.toLowerCase();
                const matches = text.includes(query);
                sec.style.display = matches ? 'block' : 'none';
                // Auto-expand matching sections, collapse non-matching
                if (matches) {
                    if (body) body.style.display = 'block';
                    if (chevron) chevron.style.transform = 'rotate(180deg)';
                } else {
                    if (body) body.style.display = 'none';
                    if (chevron) chevron.style.transform = 'rotate(0deg)';
                }
            });
        });
    }
}
