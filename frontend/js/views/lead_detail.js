// ── views/lead_detail.js — Lead detail page (stepper, research, notes, tasks) ─
import { isAdmin, isPodAdmin, isSuperAdmin, isSDR, currentUser, emailSyncEnabled, API_BASE, authHeaders } from '../auth.js';
import * as api from '../api.js';
import { statusBadgeClass, displayStatus, fmtDate, fmtDateTime, fullName, timeInStatus, showToast, CALL_OUTCOME_ICON, ensureUTC } from '../utils.js';
import { openNoShowModal } from './modals.js';
import { getNavLeads as getListNavLeads } from './lead_list.js';
import { canModifyLead, renderSourceBadge } from './lead_helpers.js';
import { loadCallsTab } from './lead_calls_tab.js';
import { loadEmailsTab } from './lead_emails_tab.js';
import { loadMessagingTab } from './lead_messaging_tab.js';
import { renderPhoneLocalTime, initPhoneTimeBadges } from '../phone_timezone.js'; // ENH-01
import { mp } from '../mp.js';

// ── Lead Detail ───────────────────────────────────────────────────────────────
export async function renderLeadDetail(container, leadId, openCallModal, loadView, backView = 'leads') {
    // ── Phase 1: Only fetch the lead itself (critical for shell render) ──
    // Notes, tasks, calls, statusHistory load progressively after the shell.
    const _shimmer = (w, h) => `<div class="analytics-shimmer" style="width:${w}px;height:${h}px;border-radius:6px;"></div>`;

    const lead = await api.fetchLead(leadId);

    // ── Mixpanel: Lead Viewed ─────────────────────────────────────────────────
    mp.track('Lead Viewed', {
        lead_id: lead.id,
        company: lead.company || '',
        status:  lead.status  || '',
        role:    currentUser?.role || '',
    });

    // ── RCM Widget context sync ────────────────────────────────────────
    // Always set the lead context on the widget so the FAB opens with the right
    // lead pre-loaded (Call tab shows lead info, Message tab is ready to use).
    // This is a pure state write — no network call, no UI change if widget is closed.
    // Guard: _rcmWidgetReady is only true for RCM SDRs after init().
    window._currentLead = lead;  // exposed for app.js navigation cleanup
    if (window._rcmWidgetReady && typeof RCMWidget !== 'undefined') {
        const _syncPhone = lead.phone || lead.phone_secondary || lead.company_phone || '';
        const _syncName  = fullName(lead);
        RCMWidget.setLead(lead.id, _syncPhone, _syncName);
    }

    let notes = [];
    let tasks = [];
    const calls = [];
    let statusHistory = [];

    const CALLS_PREVIEW_COUNT = 3;
    function renderCallLogs(callList) {
        if (!callList.length) return `<p style="color:var(--text-muted);font-size:0.9rem;">No calls logged yet.</p>`;
        const renderCard = (c) => `
            <div class="note-item" data-call-id="${c.id}" style="border-left:3px solid var(--primary-color);">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                    <span style="font-size:1.1rem;">${CALL_OUTCOME_ICON[c.outcome] || '📞'}</span>
                    <strong style="font-size:0.9rem;">${c.outcome || 'Call Logged'}</strong>
                    <span style="font-size:0.75rem;color:var(--text-muted);margin-left:auto;">${fmtDateTime(c.called_at)}</span>
                </div>
                ${c.notes ? `<p style="margin:4px 0 0;font-size:0.85rem;">${c.notes}</p>` : ''}
                <div class="note-meta">${c.user_name}</div>
            </div>`;
        const preview = callList.slice(0, CALLS_PREVIEW_COUNT).map(renderCard).join('');
        const remaining = callList.slice(CALLS_PREVIEW_COUNT);
        if (!remaining.length) return preview;
        return preview +
            `<div id="calls-remaining" style="display:none;">${remaining.map(renderCard).join('')}</div>` +
            `<button type="button" id="toggle-calls-btn" class="btn btn-outline" style="width:100%;margin-top:8px;font-size:0.8rem;padding:8px;border-style:dashed;">Show all ${callList.length} calls ▼</button>`;
    }

    function renderNotes(noteList) {
        if (!noteList.length) return `<p style="color:var(--text-muted);font-size:0.9rem;">No notes yet.</p>`;
        return noteList.map(n => `
            <div class="note-item" data-note-id="${n.id}">
                <p>${n.content}</p>
                <div class="note-meta">${n.author} · ${fmtDate(n.created_at)}</div>
                <button class="note-delete" title="Delete note">✕</button>
            </div>`).join('');
    }

    function renderTasks(taskList) {
        if (!taskList.length) return `<p style="color:var(--text-muted);font-size:0.9rem;" id="empty-tasks">No tasks yet.</p>`;
        return taskList.map(t => `
            <div class="task-item ${t.done === 'true' ? 'done' : ''}" data-task-id="${t.id}">
                <input type="checkbox" ${t.done === 'true' ? 'checked' : ''} class="task-check">
                <span>${t.title}</span>
                ${t.due_date ? `<small style="color:var(--text-muted);font-size:0.75rem;">${t.due_date}</small>` : ''}
                <button class="btn-icon task-del" title="Delete">✕</button>
            </div>`).join('');
    }

    // ── Sales Journey status (docs/SALES_JOURNEY_ARCHITECTURE.md, Phase 3) ──
    const JOURNEY_STATUS_LABEL = {
        active: 'In progress',
        completed: 'Completed',
        failed: 'Failed',
        paused: 'Paused',
        exited_early: 'Exited',
    };
    const JOURNEY_STATUS_COLOR = {
        active: '#3b82f6', completed: '#10b981', failed: '#ef4444',
        paused: '#f59e0b', exited_early: '#94a3b8',
    };
    // Mirrors FailedEnrollmentsPanel.jsx's REASON_LABEL (admin builder) —
    // an SDR seeing "exceeded max node passes" in raw form is the same class
    // of bug as a raw node id; keep both surfaces speaking the same language.
    const JOURNEY_REASON_LABEL = {
        suppressed: 'Contact suppressed (opted out / disqualified)',
        journey_archived: 'Cadence archived',
        exceeded_max_node_passes: 'Exceeded max steps — likely a loop',
        send_failed: 'Send failed',
        manually_skipped: 'Manually skipped',
        unexpected_error: 'Unexpected error',
        cooldown_stalled: 'Blocked by another cadence for too long',
        node_not_found: 'Internal error — step no longer exists',
        unknown_node_type: 'Internal error — unsupported step type',
    };
    const JOURNEY_PENDING_LABEL = {
        waiting: 'Waiting for its scheduled time',
        cooldown_blocked: 'Briefly paused — another cadence recently contacted this lead',
        domain_cadence_blocked: "Briefly paused — sending domain's rate limit",
        retry_pending: 'A previous send failed — retrying automatically',
        processing: 'Being processed right now',
        unknown: 'Status unclear — check back shortly',
    };
    function renderJourneyEnrollments(enrollments) {
        if (!enrollments.length) return '';
        return enrollments.map(e => `
            <div style="padding:8px 0;border-bottom:1px solid var(--border-color);">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                    <strong style="font-size:0.85rem;">${e.journey_name}</strong>
                    <span style="font-size:0.72rem;font-weight:600;color:${JOURNEY_STATUS_COLOR[e.status] || '#64748b'};">
                        ${JOURNEY_STATUS_LABEL[e.status] || e.status}
                    </span>
                </div>
                ${e.status === 'active' ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">Currently at: ${e.current_node_label || e.current_node_id}</div>` : ''}
                ${e.status === 'active' && e.pending_status ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:1px;">${JOURNEY_PENDING_LABEL[e.pending_status.reason] || e.pending_status.detail || ''}</div>` : ''}
                ${e.exited_reason ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">Reason: ${JOURNEY_REASON_LABEL[e.exited_reason] || e.exited_reason.replace(/_/g, ' ')}</div>` : ''}
            </div>`).join('');
    }

    function makeField(label, key, value) {
        return `<div class="info-field" data-key="${key}">
            <label>${label}</label>
            <span class="field-value" title="Click to edit">${value || '—'}</span>
        </div>`;
    }

    // Check research completion — v2 uses company_pulse + opening_line as the signal
    const researchComplete = !!(lead.research_company && lead.research_contact && lead.research_hypothesis && lead.research_personalization);
    const hasV2Research    = !!(lead.research_heat && lead.research_opening);
    const canViewPhones = isAdmin || isSuperAdmin || true; // gate removed in v8 — server controls
    const sourceTag = renderSourceBadge(lead, false);

    // Pod Admin ownership check
    const _canModify = canModifyLead(lead);

    // ── Pipeline V2 — Grouped Stage Pipeline ──────────────────────────────
    const POSITIVE_PATH = ['Lead Assigned', 'Research', 'Calling', 'Meeting Scheduled', '1st Discovery Meeting', 'Discovery Complete', 'Demo Scheduled', 'Demo Done'];
    const PIPELINE_STAGES = [
        { id: 'qualification', label: 'Qualification', icon: '🎯', statuses: ['Lead Assigned', 'Research', 'Calling'],
          subSteps: [{ status: 'Lead Assigned', label: 'Assigned' }, { status: 'Research', label: 'Research' }, { status: 'Calling', label: 'Calling' }] },
        { id: 'meeting', label: 'Meeting', icon: '📅', statuses: ['Meeting Scheduled'],
          subSteps: [{ status: 'Meeting Scheduled', label: 'Meeting Scheduled' }] },
        { id: 'discovery', label: 'Discovery', icon: '🔬', statuses: ['1st Discovery Meeting', 'Discovery Complete'],
          subSteps: [{ status: '1st Discovery Meeting', label: 'Discovery Call', dynamic: true }] },
        { id: 'demo', label: 'Demo', icon: '🎬', statuses: ['Demo Scheduled', 'Demo Done'],
          subSteps: [{ status: 'Demo Scheduled', label: 'Demo Scheduled' }, { status: 'Demo Done', label: 'Demo Done' }] },
    ];

    const isDisqualified = lead.status === 'Disqualified';
    const isCompleted = lead.status === 'Completed';
    const positiveIdx = POSITIVE_PATH.indexOf(lead.status);
    const currentPositiveIdx = isDisqualified ? 2 : (isCompleted ? POSITIVE_PATH.length : positiveIdx);

    // Find which pipeline stage the current status belongs to
    function _getStageIndex(status) {
        for (let i = 0; i < PIPELINE_STAGES.length; i++) {
            if (PIPELINE_STAGES[i].statuses.includes(status)) return i;
        }
        if (status === 'Completed') return PIPELINE_STAGES.length; // past all stages
        if (status === 'Disqualified') return _getStageIndex('Calling'); // branch from qualification
        return 0; // Default to Qualification (stage 0) for unrecognized statuses
    }
    const activeStageIdx = Math.max(0, _getStageIndex(lead.status));

    function _timeBetween(fromTs, toTs) {
        if (!fromTs || !toTs) return '';
        const from = new Date(ensureUTC(fromTs)), to = new Date(ensureUTC(toTs));
        const diffMs = Math.abs(to - from);
        const mins = Math.floor(diffMs / 60000);
        const hrs = Math.floor(diffMs / 3600000);
        const days = Math.floor(diffMs / 86400000);
        if (mins < 1) return '<1m';
        if (mins < 60) return `${mins}m`;
        if (hrs < 24) return `${hrs}h ${mins % 60}m`;
        return `${days}d ${hrs % 24}h`;
    }

    // Compute timestamps for each status (when FIRST entered)
    const statusEnteredAt = {};
    statusEnteredAt['Lead Assigned'] = lead.lead_started_at || lead.created_at;
    for (const entry of (statusHistory || [])) {
        if (entry.to_status && entry.changed_at) {
            statusEnteredAt[entry.to_status] = entry.changed_at;
        }
    }

    // Call/discovery/demo metadata
    const lastCallOutcome = lead.last_call_outcome;
    const outcomeIcon = lastCallOutcome ? (CALL_OUTCOME_ICON[lastCallOutcome] || '📞') : '';
    const currentAttempts = lead.call_attempt_count || 0;
    const maxAttempts = lead.max_call_attempts || 5;
    const discoveryCount = lead.discovery_meeting_count || 0;
    const demoFailedCount = lead.demo_failed_count || 0;
    const demoFailedReason = lead.demo_failed_reason || '';

    // ── Progress Summary Strip ──
    const progressPct = isCompleted ? 100 : isDisqualified ? Math.round(((activeStageIdx + 1) / 4) * 100) : Math.round((activeStageIdx / 4) * 100 + (activeStageIdx < 4 ? 12 : 0));
    const currentStageLabel = isCompleted ? 'Completed' : isDisqualified ? 'Disqualified' : (PIPELINE_STAGES[activeStageIdx]?.label || lead.status);
    const progressStripHTML = `<div class="pipeline-v2-progress-strip">
        <div class="pipeline-v2-progress-label">Stage ${Math.min(activeStageIdx + 1, 4)} of 4</div>
        <div class="pipeline-v2-progress-sublabel">· ${currentStageLabel}${statusEnteredAt[lead.status] ? ` · ${timeInStatus(statusEnteredAt[lead.status])}` : ''}</div>
        <div class="pipeline-v2-progress-bar"><div class="pipeline-v2-progress-fill" style="width:${progressPct}%"></div></div>
    </div>`;

    // ── Build 4-Stage Pipeline Pills ──
    let pipelinePillsHTML = '';
    PIPELINE_STAGES.forEach((stage, si) => {
        const isStageCompleted = si < activeStageIdx || isCompleted;
        const isStageActive = si === activeStageIdx && !isDisqualified && !isCompleted;
        const isStageSkipped = isDisqualified && si > activeStageIdx;
        const stateCls = isStageCompleted ? 'completed' : (isStageActive ? 'active' : (isStageSkipped ? 'skipped' : 'pending'));

        // Badge text
        let badgeText = '';
        if (isStageCompleted) {
            badgeText = `✓ ${stage.subSteps.length}/${stage.subSteps.length}`;
        } else if (isStageActive) {
            const doneCount = stage.subSteps.filter(ss => POSITIVE_PATH.indexOf(ss.status) < currentPositiveIdx).length;
            badgeText = stage.id === 'discovery' && lead.status === 'Discovery Complete' ? '✓ Complete' : `● ${doneCount}/${stage.subSteps.length}`;
        } else {
            badgeText = 'Pending';
        }

        // Connector before this stage
        if (si > 0) {
            const connDone = si <= activeStageIdx || isCompleted;
            const connFaded = isStageSkipped;
            // Get transition time between last status of prev stage and first status of this stage
            const prevLastStatus = PIPELINE_STAGES[si - 1].statuses[PIPELINE_STAGES[si - 1].statuses.length - 1];
            const curFirstStatus = stage.statuses[0];
            const connTime = _timeBetween(statusEnteredAt[prevLastStatus], statusEnteredAt[curFirstStatus]);
            pipelinePillsHTML += `<div class="pipeline-v2-connector ${connDone && !connFaded ? 'done' : ''}" ${connFaded ? 'style="opacity:0.3;"' : ''}>
                <div class="pipeline-v2-connector-line"></div>
                ${connTime && !connFaded ? `<div class="pipeline-v2-connector-time">${connTime}</div>` : ''}
            </div>`;
        }

        pipelinePillsHTML += `<div class="pipeline-v2-stage ${stateCls}" data-stage="${stage.id}" data-stage-idx="${si}">
            <div class="pipeline-v2-stage-circle">${isStageCompleted ? '✓' : stage.icon}</div>
            <div class="pipeline-v2-stage-label">${stage.label}</div>
            <div class="pipeline-v2-stage-badge">${badgeText}</div>
        </div>`;
    });

    // ── Expandable Active Stage Panel ──
    let expandPanelHTML = '';
    if (!isCompleted && !isDisqualified && activeStageIdx >= 0 && activeStageIdx < PIPELINE_STAGES.length) {
        const aStage = PIPELINE_STAGES[activeStageIdx];
        let subStepsHTML = '';

        if (aStage.id === 'discovery') {
            // Discovery: dynamic call list with timestamps
            const discoveryEnteredAt = statusEnteredAt['1st Discovery Meeting'];

            // ── Outcome gate ───────────────────────────────────────────────
            // Use synchronous lead payload fields (no async race condition).
            // Gate only applies when discoveryCount >= 1 (EC-1: first call exempt).
            // EC-14: null status_changed_at → gate not applicable → allow.
            const lastCallTs  = lead.last_call_timestamp ? new Date(lead.last_call_timestamp) : null;
            const enteredTs   = lead.status_changed_at   ? new Date(lead.status_changed_at)   : null;
            const hasOutcomeForCurrentCall =
                discoveryCount >= 1 &&
                lastCallTs !== null &&
                enteredTs  !== null &&
                lastCallTs >= enteredTs;
            // Show gate when: count >= 1 AND no outcome logged since discovery started
            const needsOutcomeFirst = discoveryCount >= 1 && !hasOutcomeForCurrentCall;

            if (discoveryCount > 0 || lead.status === '1st Discovery Meeting') {
                const totalCalls = Math.max(discoveryCount, 1);
                for (let c = 1; c <= totalCalls; c++) {
                    const isDone    = c < totalCalls || lead.status === 'Discovery Complete';
                    const isCurrent = c === totalCalls && lead.status === '1st Discovery Meeting';
                    const outcomeLogged = isCurrent && hasOutcomeForCurrentCall;
                    const callLabel = isDone ? '— Completed'
                                    : outcomeLogged ? '— Outcome Logged'
                                    : isCurrent ? '— In Progress'
                                    : '';
                    // Only apply amber 'pending-call' highlight when outcome is genuinely missing
                    const pendingClass = isCurrent && !hasOutcomeForCurrentCall ? 'pending-call' : '';
                    subStepsHTML += `<div class="pipeline-v2-discovery-entry ${pendingClass}">
                        <div class="pipeline-v2-discovery-num">${c}</div>
                        <div class="pipeline-v2-discovery-info">
                            <div class="pipeline-v2-discovery-info-title">Call ${c} ${callLabel}</div>
                            <div class="pipeline-v2-discovery-info-time">${discoveryEnteredAt ? fmtDateTime(discoveryEnteredAt) : 'Timestamp pending...'}</div>
                        </div>
                    </div>`;
                }
                if (lead.status === '1st Discovery Meeting' && _canModify) {
                    if (needsOutcomeFirst) {
                        // Outcome not yet logged for current call — show gate UI
                        subStepsHTML += `
                            <div id="discovery-outcome-notice" style="margin-top:8px;display:flex;align-items:center;gap:6px;padding:7px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:0.75rem;color:#92400e;width:fit-content;">
                                ⚠️ Log an outcome for Call ${discoveryCount} before adding another.
                            </div>
                            <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
                                <button class="btn" id="log-outcome-for-discovery-btn"
                                    style="background:#059669;color:#fff;padding:5px 14px;border-radius:6px;font-size:0.72rem;font-weight:600;border:none;cursor:pointer;">
                                    📞 Log Outcome for Call ${discoveryCount}
                                </button>
                                <button class="btn" id="add-discovery-btn" disabled
                                    style="padding:5px 14px;border-radius:6px;font-size:0.72rem;font-weight:600;border:1px solid #d1d5db;background:#f3f4f6;color:#9ca3af;cursor:not-allowed;">
                                    + Add Discovery Call
                                </button>
                                <button class="btn" id="complete-discovery-btn"
                                    style="padding:5px 14px;border-radius:6px;font-size:0.72rem;font-weight:600;border:none;cursor:pointer;background:#1e40af;color:#fff;">
                                    ✓ Complete Discovery
                                </button>
                            </div>`;
                    } else {
                        // Outcome logged — full controls available
                        subStepsHTML += `
                            <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
                                <button class="btn" id="add-discovery-btn"
                                    style="background:#059669;color:#fff;padding:5px 14px;border-radius:6px;font-size:0.72rem;font-weight:600;border:none;cursor:pointer;">
                                    + Add Discovery Call
                                </button>
                                <button class="btn" id="complete-discovery-btn"
                                    style="padding:5px 14px;border-radius:6px;font-size:0.72rem;font-weight:600;border:none;cursor:pointer;background:#1e40af;color:#fff;">
                                    ✓ Complete Discovery
                                </button>
                            </div>`;
                    }
                }
            } else {
                subStepsHTML += `<div style="font-size:0.8rem;color:var(--text-muted);padding:4px 0;">No discovery meetings logged yet</div>`;
                if (_canModify) {
                    // First call — never gated (EC-1, EC-9)
                    subStepsHTML += `<button class="btn" id="add-discovery-btn" style="margin-top:4px;background:#059669;color:#fff;padding:5px 14px;border-radius:6px;font-size:0.72rem;font-weight:600;border:none;cursor:pointer;width:fit-content;">+ Log First Discovery Call</button>`;
                }
            }

            if (lead.status === 'Discovery Complete') {
                subStepsHTML += `<div style="margin-top:8px;display:flex;align-items:center;gap:6px;padding:6px 12px;background:#dcfce7;border-radius:8px;border:1px solid #bbf7d0;font-size:0.8rem;font-weight:600;color:#15803d;width:fit-content;">✓ Discovery Complete${statusEnteredAt['Discovery Complete'] ? ` · ${fmtDateTime(statusEnteredAt['Discovery Complete'])}` : ''}</div>`;
                if (_canModify) {
                    subStepsHTML += `<button class="btn" id="schedule-demo-btn" style="margin-top:8px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:7px 18px;border-radius:8px;font-size:0.8rem;font-weight:700;border:none;cursor:pointer;">&#127916; Schedule Demo</button>`;
                }
            }
        } else {
            // Standard sub-steps for Qualification, Meeting, Demo
            aStage.subSteps.forEach((ss, ssi) => {
                const ssIdx = POSITIVE_PATH.indexOf(ss.status);
                const ssDone = ssIdx < currentPositiveIdx;
                const ssActive = ssIdx === currentPositiveIdx;
                const ssCls = ssDone ? 'done' : (ssActive ? 'active' : 'future');
                const ssTs = statusEnteredAt[ss.status];
                subStepsHTML += `<div class="pipeline-v2-substep ${ssCls}" data-step="${ss.status}" data-idx="${ssIdx}">
                    <div class="pipeline-v2-substep-dot"></div>
                    <div class="pipeline-v2-substep-label">${ssDone ? '✓ ' : ''}${ss.label}</div>
                    ${ssTs ? `<div class="pipeline-v2-substep-time">${fmtDateTime(ssTs)}</div>` : ''}
                </div>`;
            });
        }

        expandPanelHTML = `<div class="pipeline-v2-expand open" data-expand-stage="${aStage.id}">
            <div class="pipeline-v2-expand-title">${aStage.icon} ${aStage.label}${aStage.id === 'discovery' && discoveryCount > 0 ? ` · ${discoveryCount} call${discoveryCount > 1 ? 's' : ''}` : ''}</div>
            <div class="pipeline-v2-substeps">${subStepsHTML}</div>
        </div>`;
    }

    // Call status chip — shown below the stepper when in Calling or Disqualified
    let callStatusHTML = '';
    if (lead.status === 'Calling' && lastCallOutcome) {
        callStatusHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-top:12px;padding:8px 14px;border-radius:8px;background:var(--bg-secondary);border:1px solid var(--border-color);width:fit-content;">
            <span style="font-size:0.95rem;">${outcomeIcon}</span>
            <div>
                <div style="font-weight:600;font-size:0.8rem;">Latest: ${lastCallOutcome}</div>
                <div style="font-size:0.72rem;color:var(--text-muted);">Attempt ${currentAttempts} of ${maxAttempts}</div>
            </div>
        </div>`;
    }

    // ── Max attempts banner — shown prominently on Calling leads at limit ──
    let maxAttemptsBannerHTML = '';
    if (lead.status === 'Calling' && _canModify && lead.max_attempts_reached) {
        maxAttemptsBannerHTML = `
        <div id="max-attempt-banner" style="margin-top:12px;padding:14px 18px;background:linear-gradient(135deg,#fef2f2,#fff1f2);border:1.5px solid #fca5a5;border-radius:12px;display:flex;align-items:flex-start;gap:12px;">
            <span style="font-size:1.4rem;flex-shrink:0;">&#9888;&#65039;</span>
            <div>
                <div style="font-weight:700;font-size:0.9rem;color:#991b1b;margin-bottom:4px;">Max Call Attempts Reached (${currentAttempts}/${maxAttempts})</div>
                <div style="font-size:0.8rem;color:#7f1d1d;line-height:1.5;">This lead has been called ${currentAttempts} times without a positive outcome. Consider disqualifying this lead or logging a definitive outcome (Wrong Number / Not Interested).</div>
            </div>
        </div>`;
    }

    // Disqualified badge — shown below the stepper
    let disqualifiedBadgeHTML = '';
    if (isDisqualified) {
        const closedReason = lead.closed_reason || 'Disqualified';
        const closedAt = lead.lead_closed_at;
        const callingTs = statusEnteredAt['Calling'];
        const timeTaken = _timeBetween(callingTs, closedAt);
        disqualifiedBadgeHTML = `
        <div style="margin-top:12px;">
            <div style="display:flex;flex-direction:column;align-items:center;width:fit-content;">
                <div style="width:0;height:20px;border-left:2px dashed #ef4444;opacity:0.5;"></div>
                <div style="display:flex;align-items:center;gap:8px;padding:8px 16px;border-radius:10px;background:#fee2e2;border:1.5px solid #ef444450;box-shadow:0 2px 8px rgba(0,0,0,0.06);white-space:nowrap;">
                    <span style="font-size:1rem;">🚫</span>
                    <div>
                        <div style="font-weight:700;font-size:0.82rem;color:#ef4444;">Disqualified: ${closedReason}</div>
                        <div style="font-size:0.68rem;color:var(--text-muted);line-height:1.3;">
                            ${closedAt ? fmtDateTime(closedAt) : ''}${timeTaken ? ` · after ${timeTaken}` : ''}
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    // Close Lead button — shown for leads in active pipeline stages when eligible
    let closeLeadBtnHTML = '';
    const _hasNoPhone = !((lead.phone || '').trim()) && !((lead.phone_secondary || '').trim()) && !((lead.company_phone || '').trim());
    const _activeStatuses = ['Calling', 'Meeting Scheduled', '1st Discovery Meeting', 'Discovery Complete', 'Demo Scheduled'];
    if (_activeStatuses.includes(lead.status) && _canModify) {
        const noPhoneBanner = (_hasNoPhone && lead.status === 'Calling') ? `
        <div style="margin-top:12px;padding:12px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;display:flex;align-items:center;gap:10px;font-size:0.82rem;color:#92400e;">
            <span style="font-size:1.1rem;">💡</span>
            <span>This lead has no phone number. You can disqualify without logging calls.</span>
        </div>` : '';
        closeLeadBtnHTML = `
        ${noPhoneBanner}
        <div style="margin-top:12px;display:flex;gap:10px;justify-content:flex-end;align-items:center;">
            <button class="btn btn-outline" id="close-lead-btn" style="font-size:0.8rem;padding:6px 14px;color:#ef4444;border-color:#ef4444;">
                ✕ Disqualify Lead
            </button>
            ${(isAdmin || isPodAdmin) ? `<button class="btn btn-outline" id="delete-lead-btn" style="font-size:0.8rem;padding:6px 14px;color:#6b7280;border-color:#d1d5db;" title="Permanently delete this lead">
                🗑 Delete Lead
            </button>` : ''}
        </div>`;
    } else if (!_activeStatuses.includes(lead.status) && lead.status !== 'Calling' && (isAdmin || isPodAdmin)) {
        // Show delete button for admin on non-active statuses
        closeLeadBtnHTML = `
        <div style="margin-top:12px;display:flex;gap:10px;justify-content:flex-end;align-items:center;">
            <button class="btn btn-outline" id="delete-lead-btn" style="font-size:0.8rem;padding:6px 14px;color:#6b7280;border-color:#d1d5db;" title="Permanently delete this lead">
                🗑 Delete Lead
            </button>
        </div>`;
    }

    // BUG-9: No-show banner — shown ONLY for Meeting Scheduled and Demo Scheduled.
    // Intentionally excluded from '1st Discovery Meeting' to avoid confusion.
    let noShowBannerHTML = '';
    const _noShowStatuses = ['Meeting Scheduled', 'Demo Scheduled'];
    if (_noShowStatuses.includes(lead.status) && _canModify) {
        const noShowCount = lead.no_show_count || 0;
        const noShowHistory = noShowCount > 0
            ? `<div style="font-size:0.72rem;color:#b45309;margin-top:4px;">⚠️ This lead has ${noShowCount} previous no-show${noShowCount > 1 ? 's' : ''}.</div>`
            : '';
        noShowBannerHTML = `
        <div style="margin-top:14px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
                <div style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:0.88rem;color:#92400e;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    ${lead.status === 'Demo Scheduled' ? 'Demo didn\'t happen?' : 'Meeting didn\'t happen?'}
                </div>
                <div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px;">Mark as no-show to move the lead back to Calling for re-engagement.</div>
                ${noShowHistory}
            </div>
            <button class="btn" id="no-show-btn" style="background:#f59e0b;color:#fff;padding:7px 16px;border-radius:8px;font-size:0.8rem;font-weight:600;white-space:nowrap;flex-shrink:0;margin-left:16px;">
                ⚠️ Mark No Show
            </button>
        </div>`; 
    }

    // BUG-4: Meeting Complete banner — positive path CTA for Meeting Scheduled stage only
    let meetingCompleteBannerHTML = '';
    if (lead.status === 'Meeting Scheduled' && _canModify) {
        meetingCompleteBannerHTML = `
        <div style="margin-top:10px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid #bbf7d0;border-radius:10px;padding:14px 18px;display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
                <div style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:0.88rem;color:#15803d;">
                    ✅ Meeting happened?
                </div>
                <div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px;">Confirm the meeting took place to advance to the Discovery stage.</div>
            </div>
            <button class="btn" id="meeting-complete-btn" style="background:linear-gradient(135deg,#059669,#10b981);color:#fff;padding:7px 16px;border-radius:8px;font-size:0.8rem;font-weight:600;white-space:nowrap;flex-shrink:0;margin-left:16px;border:none;cursor:pointer;">
                ✅ Mark Meeting Complete
            </button>
        </div>`;
    }

    // Demo Outcome banner — shown for leads in Demo Scheduled status
    let demoOutcomeBannerHTML = '';
    if (lead.status === 'Demo Scheduled' && _canModify) {
        demoOutcomeBannerHTML = `
        <div style="margin-top:14px;background:linear-gradient(135deg,#eff6ff,#eef2ff);border:1px solid #bfdbfe;border-radius:12px;padding:18px 20px;">
            <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:0.92rem;color:#1e40af;margin-bottom:12px;">
                🎬 Demo Outcome
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;">
                <button class="btn" id="demo-success-btn" style="background:linear-gradient(135deg,#059669,#10b981);color:#fff;padding:10px 22px;border-radius:10px;font-size:0.85rem;font-weight:700;box-shadow:0 4px 14px rgba(5,150,105,0.25);border:none;cursor:pointer;">
                    ✅ Demo Successful
                </button>
                <button class="btn" id="demo-failed-btn" style="background:#fff;color:#dc2626;padding:10px 22px;border-radius:10px;font-size:0.85rem;font-weight:700;border:1.5px solid #fca5a5;cursor:pointer;">
                    ❌ Demo Failed / No Show
                </button>
            </div>
            <div style="font-size:0.72rem;color:#64748b;margin-top:8px;">Successful demos will push the lead to Salesforce. Failed demos go to <strong>Pending Review</strong> — your Pod Admin will re-route.</div>
        </div>`;
    }

    // Demo failure history banner
    let demoFailHistoryHTML = '';
    if (demoFailedCount > 0) {
        demoFailHistoryHTML = `
        <div style="margin-top:10px;padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;display:flex;align-items:center;gap:10px;font-size:0.78rem;color:#991b1b;">
            <span style="font-size:0.95rem;">⚠️</span>
            <div>
                <span style="font-weight:700;">Demo failed ${demoFailedCount} time${demoFailedCount > 1 ? 's' : ''}</span>
                ${demoFailedReason ? ` — Last reason: <em>${demoFailedReason}</em>` : ''}
            </div>
        </div>`;
    }

    // Pending Review banner — read-only state for leads awaiting Pod Admin re-routing
    let pendingReviewBannerHTML = '';
    if (lead.status === 'Pending Review') {
        pendingReviewBannerHTML = `
        <div style="margin-top:14px;background:linear-gradient(135deg,#fff7ed,#ffedd5);border:1.5px solid #fdba74;border-radius:12px;padding:18px 20px;display:flex;align-items:flex-start;gap:14px;">
            <span style="font-size:1.6rem;flex-shrink:0;">🔍</span>
            <div>
                <div style="font-weight:700;font-size:0.92rem;color:#9a3412;margin-bottom:6px;">Pending Review — Awaiting Pod Admin Decision</div>
                <div style="font-size:0.82rem;color:#7c2d12;line-height:1.5;">This lead has been escalated after a failed demo. Your Pod Admin will review and decide the next step — reschedule, rediscover, or disqualify. No further action is needed from you.</div>
            </div>
        </div>`;
    }

    // Completed status banner
    let completedBannerHTML = '';
    if (isCompleted) {
        completedBannerHTML = `
        <div style="margin-top:12px;">
            <div style="display:flex;flex-direction:column;align-items:center;width:fit-content;">
                <div style="width:0;height:20px;border-left:2px dashed #16a34a;opacity:0.5;"></div>
                <div style="display:flex;align-items:center;gap:8px;padding:10px 18px;border-radius:10px;background:#dcfce7;border:1.5px solid #16a34a50;box-shadow:0 2px 8px rgba(0,0,0,0.06);white-space:nowrap;">
                    <span style="font-size:1rem;">🎉</span>
                    <div>
                        <div style="font-weight:700;font-size:0.85rem;color:#166534;">Completed — Pushed to Salesforce</div>
                        <div style="font-size:0.7rem;color:var(--text-muted);line-height:1.3;">
                            ${statusEnteredAt['Demo Done'] ? fmtDateTime(statusEnteredAt['Demo Done']) : ''}
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    // Lead created date
    const createdDateHTML = lead.created_at ? `<div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;color:var(--text-muted);margin-bottom:10px;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
        <span>Lead created <strong>${fmtDateTime(lead.created_at)}</strong></span>
        ${lead.lead_started_at && lead.lead_started_at !== lead.created_at ? ` · Assigned <strong>${fmtDateTime(lead.lead_started_at)}</strong>` : ''}
    </div>` : '';

    const stepperCardHTML = `
            <div class="info-card pipeline-v2-card">
                ${createdDateHTML}
                ${progressStripHTML}
                <div class="pipeline-v2">${pipelinePillsHTML}</div>
                ${expandPanelHTML}
                ${callStatusHTML}
                ${maxAttemptsBannerHTML}
                ${demoFailHistoryHTML}
                ${disqualifiedBadgeHTML}
                ${completedBannerHTML}
                ${demoOutcomeBannerHTML}
                ${pendingReviewBannerHTML}
                ${closeLeadBtnHTML}
                ${noShowBannerHTML}
                 ${meetingCompleteBannerHTML}
            </div>`;

    container.innerHTML = `
        <div class="fade-in">
            <div class="lead-nav-bar" id="lead-nav-bar">
                <button class="back-btn" id="back-to-leads" style="flex-shrink:0;">← Back to ${backView === 'my-calls' ? 'Power Dialer' : 'Leads'}</button>
                <div class="lead-nav-controls" id="lead-nav-controls"></div>
            </div>

            <!-- ── Header ── -->
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
                <div>
                    <div class="detail-name">${fullName(lead)}</div>
                    <div style="display:flex;align-items:center;gap:8px;margin-top:4px;color:var(--text-muted);font-size:0.88rem;">
                        ${lead.company ? `<span style="font-weight:600;color:var(--text-primary);">${lead.company}</span>` : ''}
                        ${lead.title ? `<span>· ${lead.title}</span>` : ''}
                        ${sourceTag}
                    </div>
                    ${(lead.assigned_to && lead.assigned_to.length > 0) ? `
                    <div style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:0.82rem;color:var(--text-muted);">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                        <span>Assigned to <strong style="color:var(--text-main);">${lead.assigned_to.map(u => u.name).join(', ')}</strong></span>
                    </div>` : `
                    <div style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:0.82rem;color:var(--text-muted);">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                        <span>Unassigned</span>
                    </div>`}
                </div>
                <div style="display:flex;gap:8px;">
                    ${(() => {
                        // RCM dialer users: both call + message handled by the
                        // floating dialer widget — don't render redundant buttons here.
                        if (!_canModify || !(lead.phone || lead.phone_secondary || lead.company_phone) || !['Calling', 'Meeting Scheduled', '1st Discovery Meeting', 'Discovery Complete', 'Demo Scheduled'].includes(lead.status)) return '';
                        const _dc = window._dialerConfig || {};
                        const _p = (_dc.provider || 'none').toLowerCase();
                        const _isActive = !!_dc.active;
                        const _hasCredentials = _dc.has_credentials;

                        // RCM users: widget handles calling + messaging — hide both buttons
                        if (_isActive && _hasCredentials && _p === 'rcm') return '';

                        // Provider-specific label & colour
                        let _callLabel = 'Log Call';
                        let _callColor = '';
                        let _callTitle = 'Log the outcome of a manual call';
                        if (_isActive && _hasCredentials && _p === 'aircall') {
                            _callLabel = 'Call via Aircall';
                            _callColor = 'background:#00b388;border-color:#00b388;';
                            _callTitle = 'Call this lead using Aircall';
                        }
                        // Build distinct phone list for split button (F4)
                        const _phones = [];
                        if (lead.phone)           _phones.push({ num: lead.phone,           label: 'Primary' });
                        if (lead.phone_secondary) _phones.push({ num: lead.phone_secondary, label: 'Secondary' });
                        if (lead.company_phone)   _phones.push({ num: lead.company_phone,   label: 'Company' });
                        const _primaryPhone = _phones[0]?.num || '';
                        const _phoneIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`;

                        // Message button (Aircall users who also have RCM messaging)
                        const _msgBtn = window._rcmWidgetReady
                            ? `<button class="btn btn-outline" id="send-message-btn" data-lead-id="${lead.id}" style="border-radius:20px;padding:8px 18px;font-size:0.82rem;display:inline-flex;align-items:center;gap:6px;border-color:#25d366;color:#25d366;" title="Open Conversations"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> Message</button>`
                            : '';

                        if (_phones.length <= 1) {
                            return `<button class="btn btn-primary" id="log-call-btn" data-id="${lead.id}" data-name="${fullName(lead)}" data-phone="${_primaryPhone}" title="${_callTitle}" style="border-radius:20px;padding:8px 18px;font-size:0.82rem;display:inline-flex;align-items:center;gap:6px;${_callColor}">${_phoneIcon} ${_callLabel}</button>${_msgBtn}`;
                        }
                        // Multi-number — split button
                        const _dropdownItems = _phones.map((p, i) => `<button class="phone-picker-item" data-phone="${p.num}" data-idx="${i}">${_phoneIcon} <span>${p.label}</span><span class="phone-picker-num">${p.num}</span></button>`).join('');
                        return `<div class="split-call-btn" id="split-call-wrapper">
                            <button class="btn btn-primary split-call-main" id="log-call-btn" data-id="${lead.id}" data-name="${fullName(lead)}" data-phone="${_primaryPhone}" title="${_callTitle}" style="border-radius:20px 0 0 20px;padding:8px 14px;font-size:0.82rem;display:inline-flex;align-items:center;gap:6px;${_callColor}">${_phoneIcon} ${_callLabel}</button><button class="btn btn-primary split-call-chevron" id="split-call-chevron" title="Choose a number" style="border-radius:0 20px 20px 0;padding:8px 10px;border-left:1px solid rgba(255,255,255,0.3);font-size:0.75rem;${_callColor}">&#8964;</button>
                            <div class="phone-picker-popover" id="phone-picker-popover" style="display:none;">${_dropdownItems}</div>
                        </div>${_msgBtn}`;
                    })()}
                </div>
            </div>

            ${!_canModify ? `<div style="background:var(--bg-warning,#fff8e1);border:1px solid var(--border-warning,#ffe082);border-radius:10px;padding:10px 16px;margin-bottom:14px;font-size:0.82rem;color:#b28704;display:flex;align-items:center;gap:8px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> <span>Read-only — this lead is assigned to another POD.</span></div>` : ''}

            ${lead.company_resolved && lead.company_resolved.resolved && !['Meeting Scheduled','1st Discovery Meeting','Discovery Complete','Demo Scheduled','Demo Done','Completed'].includes(lead.status) ? `
            <div id="company-resolved-banner" style="background:linear-gradient(135deg,#fefce8,#fef3c7);border:1.5px solid #fde68a;border-radius:12px;padding:14px 20px;margin-bottom:16px;display:flex;align-items:center;gap:14px;box-shadow:0 2px 8px rgba(245,158,11,0.08);">
                <div style="width:40px;height:40px;border-radius:10px;background:#fef3c7;border:1.5px solid #fde68a;display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;">✅</div>
                <div style="flex:1;">
                    <div style="font-weight:700;font-size:0.88rem;color:#92400e;margin-bottom:3px;">Company Already Connected</div>
                    <div style="font-size:0.8rem;color:#78350f;">
                        A meeting has been booked with <strong>${lead.company_resolved.resolved_by}</strong>${lead.company_resolved.resolved_title ? ` (${lead.company_resolved.resolved_title})` : ''} at this company.
                        ${lead.company_resolved.resolved_at ? ` · <span style="color:#a16207;">${fmtDate(lead.company_resolved.resolved_at)}</span>` : ''}
                    </div>
                    <div style="font-size:0.72rem;color:#a16207;margin-top:4px;">ℹ️ Further outreach to this company may not be necessary.</div>
                </div>
            </div>
            ` : ''}

            <!-- ── Status Stepper ── -->
            ${stepperCardHTML}

            <!-- ── Tab Bar ── -->
            <div class="lead-tab-bar">
                <div class="lead-tab active" data-tab="overview">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect></svg>
                    Overview
                </div>
                <div class="lead-tab" data-tab="calls">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                    Calls
                    <span class="tab-count" id="calls-tab-count" style="display:none">0</span>
                </div>
                ${emailSyncEnabled ? `<div class="lead-tab" data-tab="emails">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                    Emails
                </div>` : ''}
            </div>

            <!-- ── Tab: Overview ── -->
            <div class="tab-panel active" id="tab-overview">
            <div class="detail-layout">
                <div>
                    <!-- Contact Info (read-friendly) -->
                    <div class="info-card">
                        <div class="info-card-title">Contact Information</div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px 32px;">
                            <div><div style="font-size:0.72rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:2px;">Email</div><div style="font-size:0.9rem;" data-key="email" class="editable-field">${lead.email || '—'}</div></div>
                            ${(() => {
                                // BUG-02/03: Inline call button helper — renders 📞 beside each phone number
                                // Each button carries data-phone so the exact number is always dialled.
                                const _dc2 = window._dialerConfig || {};
                                const _dialerOn = !!_dc2.active && !!_dc2.has_credentials && (_dc2.provider || 'none') !== 'none';
                                const _p2 = (_dc2.provider || 'none').toLowerCase();
                                const _btnBg = _p2 === 'aircall' ? '#00b388' : _p2 === 'rcm' ? '#6d28d9' : '';
                                const _btnStyle = _btnBg ? `background:${_btnBg};border-color:${_btnBg};` : '';
                                const _callBtnHtml = (num, fieldId) => {
                                    if (!num || num === '—' || !canViewPhones || !_dialerOn || !_canModify) return '';
                                    return `<button class="inline-call-btn" data-phone="${num}" data-field="${fieldId}" title="Call ${num}" style="margin-left:6px;padding:2px 8px;font-size:0.8rem;border-radius:12px;border:none;cursor:pointer;display:inline-flex;align-items:center;gap:4px;vertical-align:middle;color:#fff;${_btnStyle || 'background:#6366f1;'}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg></button>`;
                                };
                                const _phoneLocked = (num) => canViewPhones ? '' : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg> Hidden (Complete Research)`;
                                return `
                            <div><div style="font-size:0.72rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:2px;">Phone</div><div style="font-size:0.9rem;display:flex;align-items:center;flex-wrap:wrap;gap:2px;${(!canViewPhones && lead.phone) ? 'color:#b45309;font-weight:600;background:#fffbeb;padding:2px 8px;border-radius:6px;width:fit-content;' : ''}" ${(!canViewPhones && lead.phone) ? '' : 'data-key="phone" class="editable-field"'}>${(!canViewPhones && lead.phone) ? _phoneLocked(lead.phone) : (lead.phone || '\u2014')}${canViewPhones && lead.phone ? renderPhoneLocalTime(lead.phone) : ''}${_callBtnHtml(lead.phone, 'phone')}</div></div>
                            <div><div style="font-size:0.72rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:2px;">Secondary Phone</div><div style="font-size:0.9rem;display:flex;align-items:center;flex-wrap:wrap;gap:2px;${(!canViewPhones && lead.phone_secondary) ? 'color:#b45309;font-weight:600;background:#fffbeb;padding:2px 8px;border-radius:6px;width:fit-content;' : ''}" ${(!canViewPhones && lead.phone_secondary) ? '' : 'data-key="phone_secondary" class="editable-field"'}>${(!canViewPhones && lead.phone_secondary) ? _phoneLocked(lead.phone_secondary) : (lead.phone_secondary || '\u2014')}${canViewPhones && lead.phone_secondary ? renderPhoneLocalTime(lead.phone_secondary) : ''}${_callBtnHtml(lead.phone_secondary, 'phone_secondary')}</div></div>
                            <div><div style="font-size:0.72rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:2px;">Company Phone</div><div style="font-size:0.9rem;display:flex;align-items:center;flex-wrap:wrap;gap:2px;${(!canViewPhones && lead.company_phone) ? 'color:#b45309;font-weight:600;background:#fffbeb;padding:2px 8px;border-radius:6px;width:fit-content;' : ''}" ${(!canViewPhones && lead.company_phone) ? '' : 'data-key="company_phone" class="editable-field"'}>${(!canViewPhones && lead.company_phone) ? _phoneLocked(lead.company_phone) : (lead.company_phone || '\u2014')}${canViewPhones && lead.company_phone ? renderPhoneLocalTime(lead.company_phone) : ''}${_callBtnHtml(lead.company_phone, 'company_phone')}</div></div>`;
                            })()
                            }
                            <div><div style="font-size:0.72rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:2px;">Company</div><div style="font-size:0.9rem;" data-key="company" class="editable-field">${lead.company || '—'}</div></div>
                            <div><div style="font-size:0.72rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:2px;">Job Title</div><div style="font-size:0.9rem;" data-key="title" class="editable-field">${lead.title || '—'}</div></div>
                            <div><div style="font-size:0.72rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:2px;">LinkedIn</div><div style="font-size:0.9rem;">${(lead.linkedin_url || lead.person_linkedin) ? `<a href="${lead.linkedin_url || lead.person_linkedin}" target="_blank" rel="noopener" style="color:#0a66c2;text-decoration:none;display:inline-flex;align-items:center;gap:4px;font-weight:500;"><svg width="14" height="14" viewBox="0 0 24 24" fill="#0a66c2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg> View Profile</a>` : '—'}</div></div>
                        </div>
                    </div>

                    <!-- ── AI Intelligence Card ── -->
                    <div id="research-card" class="info-card" style="border-left:4px solid ${hasV2Research ? 'var(--status-won)' : researchComplete ? 'var(--status-won)' : '#f59e0b'};">
                        <div class="info-card-title" style="display:flex;align-items:center;gap:8px;">
                            🧠 Pre-Call Intelligence
                            <span id="research-status-badge" style="font-size:0.68rem;font-weight:600;padding:2px 10px;border-radius:999px;${hasV2Research ? 'background:#dcfce7;color:#15803d;' : researchComplete ? 'background:#dcfce7;color:#15803d;' : 'background:#fef3c7;color:#92400e;'}">${hasV2Research || researchComplete ? '✓ Ready' : 'Pending'}</span>
                            <div id="heat-badge" style="margin-left:auto;font-size:0.75rem;font-weight:700;padding:3px 12px;border-radius:999px;display:${lead.research_heat ? 'inline-flex' : 'none'};align-items:center;gap:4px;
                                background:${lead.research_heat === 'hot' ? '#fef2f2' : lead.research_heat === 'warm' ? '#fffbeb' : '#eff6ff'};
                                color:${lead.research_heat === 'hot' ? '#dc2626' : lead.research_heat === 'warm' ? '#d97706' : '#1d4ed8'};
                                border:1px solid ${lead.research_heat === 'hot' ? '#fecaca' : lead.research_heat === 'warm' ? '#fde68a' : '#bfdbfe'};"
                            >${lead.research_heat === 'hot' ? '🔥' : lead.research_heat === 'warm' ? '♨️' : '🧊'} ${(lead.research_heat || '').toUpperCase()}</div>
                            ${_canModify ? `<button id="regenerate-research-btn" style="font-size:0.72rem;padding:4px 12px;border-radius:8px;border:1px solid var(--border-color);background:transparent;cursor:pointer;color:var(--text-muted);" title="Regenerate research">↻ Regenerate</button>` : ''}
                        </div>
                        <div id="research-skeleton" style="display:none;">
                            ${['🏢 Company Pulse','💡 Why They Need Us','📞 Opening Line','🛡️ Likely Objection','👤 Persona Signal'].map(l => `<div style="margin-bottom:12px;"><div style="font-size:0.68rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">${l}</div><div class="research-shimmer"></div></div>`).join('')}
                        </div>
                        <div id="research-error" style="display:none;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;">
                            <div style="font-size:0.82rem;color:#dc2626;margin-bottom:8px;">⚠️ <span id="research-error-msg">Research failed</span></div>
                            ${_canModify ? `<button id="retry-research-btn" style="font-size:0.75rem;padding:4px 12px;border-radius:6px;border:1px solid #dc2626;background:transparent;color:#dc2626;cursor:pointer;">↻ Try Again</button>` : ''}
                        </div>
                        <div id="research-content" style="${(hasV2Research || researchComplete) ? '' : 'display:none;'}">
                            <div class="intel-grid">
                                <div class="intel-card" style="grid-column:span 2;">
                                    <div class="intel-label">🏢 Company Pulse</div>
                                    <div class="intel-row">
                                        <div class="intel-value" id="ic-company-pulse-display" data-field="research_company">${lead.research_company || '<span style="color:var(--text-muted);font-style:italic;">Not generated</span>'}</div>
                                    </div>
                                </div>
                                <div class="intel-card" style="grid-column:span 2;">
                                    <div class="intel-label">💡 Why They Need Us</div>
                                    <div class="intel-row">
                                        <div class="intel-value" id="ic-why-display" data-field="research_hypothesis" data-multiline="true">${lead.research_hypothesis || '<span style="color:var(--text-muted);font-style:italic;">Not generated</span>'}</div>
                                    </div>
                                </div>
                                <div class="intel-card" style="grid-column:span 2;background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border:1px solid #bbf7d0;">
                                    <div class="intel-label" style="color:#15803d;">📞 Opening Line <span style="font-weight:400;font-size:0.68rem;color:var(--text-muted);">(say this verbatim)</span></div>
                                    <div class="intel-row">
                                        <div class="intel-value" id="ic-opening-display" data-field="research_opening" data-multiline="true" style="font-size:0.88rem;font-style:italic;line-height:1.5;">${lead.research_opening || lead.research_hook || '<span style="color:var(--text-muted);font-style:italic;">Not generated</span>'}</div>
                                        <div class="intel-actions">${_canModify ? `<button class="intel-copy-btn" data-copy-id="ic-opening-display">Copy</button>` : ''}</div>
                                    </div>
                                </div>
                                <div class="intel-card">
                                    <div class="intel-label">🛡️ Likely Objection</div>
                                    <div class="intel-row">
                                        <div class="intel-value" id="ic-objection-display" data-field="research_personalization" data-multiline="true">${lead.research_personalization || '<span style="color:var(--text-muted);font-style:italic;">Not generated</span>'}</div>
                                    </div>
                                </div>
                                <div class="intel-card">
                                    <div class="intel-label">👤 Persona Signal</div>
                                    <div class="intel-row">
                                        <div class="intel-value" id="ic-persona-display" data-field="research_contact" data-multiline="true">${lead.research_contact || '<span style="color:var(--text-muted);font-style:italic;">Not generated</span>'}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div id="research-empty" style="display:none;text-align:center;padding:24px;color:var(--text-muted);font-size:0.82rem;">
                            <div style="font-size:1.5rem;margin-bottom:8px;">🔍</div>
                            Add company details to this lead to enable AI research.
                        </div>
                    </div>


                    <!-- ── Enrichment (collapsible) ── -->
                    ${_renderEnrichmentCard(lead)}

                    <!-- ── Call History ── -->
                    <div class="info-card">
                        <div class="info-card-title">📞 Call History (${calls.length})</div>
                        <div id="calls-list" style="max-height:500px;overflow-y:auto;">${renderCallLogs(calls)}</div>
                    </div>

                    <!-- ── Tasks ── -->
                    <div class="info-card">
                        <div class="info-card-title">Tasks</div>
                        <div class="task-input-row">
                            <input type="text" id="task-input" class="task-input" placeholder="Add a task...">
                            <input type="date" id="task-due" class="filter-input" style="width:130px;" title="Due date">
                            <input type="time" id="task-time" class="filter-input" style="width:110px;" title="Due time (optional)">
                            <button class="btn btn-primary" id="add-task-btn">Add</button>
                        </div>
                        <div id="tasks-list">${renderTasks(tasks)}</div>
                    </div>
                </div>
                <div class="right-panel">
                    <!-- ── Sales Journey status (progressively loaded) ── -->
                    <div class="info-card" id="journey-status-card" style="display:none;">
                        <div class="info-card-title">🧭 Sales Cadence</div>
                        <div id="journey-status-list"></div>
                    </div>

                    <!-- Opportunity Outcome (Qualification+ and Terminal statuses) -->
                    ${['Meeting Scheduled', '1st Discovery Meeting', 'Discovery Complete', 'Demo Scheduled', 'Demo Done', 'Completed', 'Disqualified'].includes(lead.status) ? `
                    <div class="info-card" style="border-left:4px solid ${lead.opportunity_status === 'Won' ? 'var(--status-won)' : lead.opportunity_status === 'Lost' ? '#ef4444' : '#f59e0b'};">
                        <div class="info-card-title">🏷️ Opportunity Outcome</div>
                        ${lead.opportunity_status ? `
                            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                                <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 16px;border-radius:20px;font-weight:700;font-size:0.95rem;
                                    background:${lead.opportunity_status === 'Won' ? '#ecfdf5' : '#fef2f2'};
                                    color:${lead.opportunity_status === 'Won' ? '#059669' : '#dc2626'};">
                                    ${lead.opportunity_status === 'Won' ? '🎉 Won' : '😔 Lost'}
                                </span>
                            </div>
                            ${lead.opportunity_notes ? `<p style="font-size:0.85rem;color:var(--text-primary);margin:0 0 8px 0;padding:8px 12px;background:var(--bg-secondary);border-radius:8px;">${lead.opportunity_notes}</p>` : ''}
                            <div style="font-size:0.75rem;color:var(--text-muted);">
                                Updated by <strong>${lead.opportunity_updated_by || 'Admin'}</strong> · ${lead.opportunity_updated_at ? fmtDateTime(lead.opportunity_updated_at) : ''}
                            </div>
                            ${isAdmin ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border-color);">
                                <button class="btn btn-outline btn-sm" id="change-outcome-btn" style="font-size:0.78rem;">✏️ Change Outcome</button>
                            </div>` : ''}
                        ` : `
                            ${isAdmin ? `
                            <p style="font-size:0.85rem;color:var(--text-muted);margin:0 0 12px 0;">Mark the outcome of this opportunity after Salesforce conversion:</p>
                            <div style="display:flex;gap:10px;margin-bottom:10px;">
                                <button class="btn" id="outcome-won-btn" style="background:#059669;color:#fff;padding:8px 24px;border-radius:8px;font-weight:600;font-size:0.9rem;">✅ Won</button>
                                <button class="btn" id="outcome-lost-btn" style="background:#dc2626;color:#fff;padding:8px 24px;border-radius:8px;font-weight:600;font-size:0.9rem;">❌ Lost</button>
                            </div>
                            <input type="text" id="outcome-notes-input" placeholder="Optional: add context (e.g., deal size, reason lost)..." style="width:100%;padding:8px 12px;border:1px solid var(--border-color);border-radius:8px;font-size:0.82rem;">
                            ` : `
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:10px;font-size:0.8rem;font-weight:600;background:#fffbeb;color:#b45309;">⏳ Pending</span>
                                <span style="font-size:0.82rem;color:var(--text-muted);">Awaiting outcome update from admin</span>
                            </div>
                            `}
                        `}
                    </div>
                    ` : ''}

                    <!-- Call Strategy Quick Reference (visible when research data exists) -->
                    ${(lead.research_hook || lead.research_hypothesis || lead.research_personalization) ? `
                    <div class="info-card" style="border-left:4px solid var(--primary-color);background:linear-gradient(135deg, #f0f4ff 0%, #faf5ff 100%);">
                        <div class="info-card-title" style="display:flex;align-items:center;gap:8px;">
                            🎯 Call Strategy
                            <span style="font-size:0.68rem;font-weight:500;padding:2px 8px;border-radius:999px;background:#e0e7ff;color:#4338ca;">Quick Reference</span>
                        </div>
                        ${lead.research_hook ? `
                        <div style="margin-bottom:12px;">
                            <div style="font-size:0.72rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px;font-weight:600;">Opening Hook</div>
                            <div style="font-size:0.85rem;color:var(--text-primary);padding:8px 12px;background:rgba(255,255,255,0.7);border-radius:8px;line-height:1.5;">${lead.research_hook}</div>
                        </div>` : ''}
                        ${lead.research_hypothesis ? `
                        <div style="margin-bottom:12px;">
                            <div style="font-size:0.72rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px;font-weight:600;">Pitch Angle / Hypothesis</div>
                            <div style="font-size:0.85rem;color:var(--text-primary);padding:8px 12px;background:rgba(255,255,255,0.7);border-radius:8px;line-height:1.5;">${lead.research_hypothesis}</div>
                        </div>` : ''}
                        ${lead.research_personalization ? `
                        <div>
                            <div style="font-size:0.72rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px;font-weight:600;">Personalization Note</div>
                            <div style="font-size:0.85rem;color:var(--text-primary);padding:8px 12px;background:rgba(255,255,255,0.7);border-radius:8px;line-height:1.5;">${lead.research_personalization}</div>
                        </div>` : ''}
                    </div>
                    ` : ''}

                    <!-- Notes -->
                    <div class="info-card">
                        <div class="info-card-title">Notes</div>
                        <div class="note-input-area">
                            <textarea id="note-textarea" class="note-textarea" placeholder="Add a note about this lead..."></textarea>
                            <button class="btn btn-primary" id="add-note-btn" style="align-self:flex-end;">Save Note</button>
                        </div>
                        <div id="notes-list">${renderNotes(notes)}</div>
                    </div>

                    <!-- Status History -->
                    <div class="info-card">
                        <div class="info-card-title">📊 Status History</div>
                        <div class="timeline" style="max-height:350px;overflow-y:auto;">
                            ${statusHistory.length > 0 ? statusHistory.map(s => `
                                <div class="timeline-item">
                                    <div class="timeline-dot">📊</div>
                                    <div class="timeline-content">
                                        <p>
                                            <span class="badge ${statusBadgeClass(s.from_status)}" style="font-size:0.68rem;">${s.from_status || '—'}</span>
                                            <span style="margin:0 4px;">→</span>
                                            <span class="badge ${statusBadgeClass(s.to_status)}" style="font-size:0.68rem;">${s.to_status}</span>
                                        </p>
                                        <span>${s.changed_by || 'System'} · ${fmtDateTime(s.changed_at)}</span>
                                    </div>
                                </div>`).join('') : '<p style="color:var(--text-muted);font-size:0.85rem;">No status changes recorded yet.</p>'}
                            <div class="timeline-item">
                                <div class="timeline-dot">🔗</div>
                                <div class="timeline-content"><p>${lead.lead_source?.startsWith('upload:') ? 'Uploaded from enriched sheet' : lead.lead_source?.startsWith('gsheet:') ? 'Imported from Google Sheets' : lead.lead_source === 'uploaded' ? 'Uploaded from enriched sheet' : lead.lead_source === 'manual' ? 'Manually created' : 'Synced from Salesforce'}</p><span>${fmtDateTime(lead.created_at)}</span></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            </div><!-- /tab-overview -->

            <!-- ── Tab: Calls ── -->
            <div class="tab-panel" id="tab-calls">
                <div id="calls-tab-content">
                    <div class="calls-empty">
                        <div class="empty-icon">📞</div>
                        <h3>Loading call history...</h3>
                        <p>Fetching calls for this lead</p>
                    </div>
                </div>
            </div><!-- /tab-calls -->

            <!-- ── Tab: Emails ── -->
            <div class="tab-panel" id="tab-emails">
                <div id="emails-tab-content" style="height:600px;min-height:480px;border-radius:12px;overflow:hidden;">
                    <div style="padding:40px 0;text-align:center;color:var(--text-muted);">
                        <div style="font-size:2.5rem;margin-bottom:12px;">✉️</div>
                        <h3 style="font-size:1rem;font-weight:600;color:var(--text-main);margin-bottom:6px;">Loading email activity...</h3>
                    </div>
                </div>
            </div><!-- /tab-emails -->


        </div>`;

    document.getElementById('back-to-leads').addEventListener('click', () => loadView(backView || 'leads'));

    // ── Prev/Next navigation bar ────────────────────────────────────────────
    (function _initNavBar() {
        // 'my-calls' (Power Dialer) no longer has its own nav-list data source
        // now that the classic Today's Calls view is retired — falls back to
        // the Leads Hub's list, same as every other backView.
        const navLeads = getListNavLeads();
        const navCtrl  = document.getElementById('lead-nav-controls');
        if (!navCtrl || navLeads.length < 2) return;

        const idx = navLeads.findIndex(l => l.id === leadId);
        if (idx < 0) return;

        const total  = navLeads.length;
        const hasPrev = idx > 0;
        const hasNext = idx < total - 1;

        navCtrl.innerHTML = `
            <button class="nav-arrow-btn" id="nav-prev-btn" ${hasPrev ? '' : 'disabled'} title="Previous lead (Alt+←)">&#8592;</button>
            <span class="nav-position-label">${idx + 1} / ${total}</span>
            <button class="nav-arrow-btn" id="nav-next-btn" ${hasNext ? '' : 'disabled'} title="Next lead (Alt+→)">&#8594;</button>`;

        if (hasPrev) {
            document.getElementById('nav-prev-btn').addEventListener('click', () =>
                loadView('lead-detail', navLeads[idx - 1].id, backView));
        }
        if (hasNext) {
            document.getElementById('nav-next-btn').addEventListener('click', () =>
                loadView('lead-detail', navLeads[idx + 1].id, backView));
        }

        // Keyboard: Alt+← / Alt+→ (EC: ignore when in input/textarea; one-shot lock prevents key-hold repeat)
        let _navLock = false;
        function _navKeyHandler(e) {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
            if (_navLock) return;  // BUG-06: block key-repeat (key held down)
            if (e.altKey && e.key === 'ArrowLeft'  && hasPrev) { e.preventDefault(); _navLock = true; loadView('lead-detail', navLeads[idx - 1].id, backView); }
            if (e.altKey && e.key === 'ArrowRight' && hasNext) { e.preventDefault(); _navLock = true; loadView('lead-detail', navLeads[idx + 1].id, backView); }
        }
        function _navKeyUp(e) { if (e.altKey || e.key === 'ArrowLeft' || e.key === 'ArrowRight') _navLock = false; }
        document.addEventListener('keydown', _navKeyHandler);
        document.addEventListener('keyup', _navKeyUp);
        // Clean up when leaving this view
        const _obs = new MutationObserver(() => {
            if (!document.getElementById('lead-nav-bar')) {
                document.removeEventListener('keydown', _navKeyHandler);
                document.removeEventListener('keyup', _navKeyUp);
                _obs.disconnect();
            }
        });
        _obs.observe(document.body, { childList: true, subtree: false });
    })();

    // ── Tab Switching ────────────────────────────────────────────────────
    let callsLoaded = false;
    let emailsLoaded = false;
    container.querySelectorAll('.lead-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            container.querySelectorAll('.lead-tab').forEach(t => t.classList.remove('active'));
            container.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const panel = document.getElementById(`tab-${target}`);
            if (panel) panel.classList.add('active');
            // ── Mixpanel: Lead Tab Switched
            mp.track('Lead Tab Switched', { lead_id: leadId, tab: target, role: currentUser?.role || '' });
            // Lazy-load calls on first visit
            if (target === 'calls' && !callsLoaded) {
                callsLoaded = true;
                loadCallsTab(lead.id);
            }
            // Auto-refresh emails on every tab click
            if (target === 'emails') {
                emailsLoaded = true;
                loadEmailsTab(lead.id, lead, container, { onReload: () => renderLeadDetail(container, leadId, openCallModal, loadView) });
            }
        });
    });

    // ── Expose calls-tab refresh for post-call reload ─────────────────────
    // Called by app.js rcm:call-ended handler after outcome is logged
    // so the Calls tab shows the new DialerCall immediately without a page reload.
    window._refreshCallsTab = (forLeadId) => {
        if (forLeadId && forLeadId !== lead.id) return; // wrong lead
        callsLoaded = false; // reset so next tab click re-fetches
        // If calls tab is currently active, reload it immediately
        const callsPanel = document.getElementById('tab-calls');
        if (callsPanel?.classList.contains('active')) {
            callsLoaded = true;
            loadCallsTab(lead.id);
        }
    };

    // Position terminal branch precisely below the Calling step circle
    if (isDisqualified) {
        requestAnimationFrame(() => {
            const branchEl = document.getElementById('terminal-branch-below');
            const callingStep = container.querySelector('.pipeline-step[data-step="Calling"]');
            const stepperEl = container.querySelector('.pipeline-stepper');
            if (branchEl && callingStep && stepperEl) {
                const stepperRect = stepperEl.getBoundingClientRect();
                const callingRect = callingStep.getBoundingClientRect();
                const callingCenterX = callingRect.left + callingRect.width / 2;
                const branchCard = branchEl.querySelector('div');
                const branchWidth = branchCard ? branchCard.offsetWidth : 0;
                const leftOffset = callingCenterX - stepperRect.left - (branchWidth / 2);
                branchEl.style.marginLeft = Math.max(0, leftOffset) + 'px';
            }
        });
    }

    const logCallBtn = document.getElementById('log-call-btn');
    if (logCallBtn) logCallBtn.addEventListener('click', () => openCallModal(lead.id, fullName(lead), logCallBtn.dataset.phone || lead.phone || lead.phone_secondary || lead.company_phone, lead));

    // BUG-02/03: Inline call buttons next to each phone field — each carries the exact number
    container.querySelectorAll('.inline-call-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const phone = btn.dataset.phone;
            if (phone) openCallModal(lead.id, fullName(lead), phone, lead);
        });
    });

    // ENH-01: Start live timezone badge clock (updates every 30s)
    initPhoneTimeBadges(container);

    // F4: Split call button — chevron opens phone picker
    const chevron = document.getElementById('split-call-chevron');
    const picker  = document.getElementById('phone-picker-popover');
    if (chevron && picker) {
        chevron.addEventListener('click', (e) => {
            e.stopPropagation();
            picker.style.display = picker.style.display === 'none' ? '' : 'none';
        });
        picker.querySelectorAll('.phone-picker-item').forEach(item => {
            item.addEventListener('click', () => {
                picker.style.display = 'none';
                openCallModal(lead.id, fullName(lead), item.dataset.phone, lead);
            });
        });
        document.addEventListener('click', () => { picker.style.display = 'none'; }, { once: false });
    }

    // 💬 Header 'Message' button → open RCMWidget for this lead
    const sendMsgBtn = document.getElementById('send-message-btn');
    if (sendMsgBtn) sendMsgBtn.addEventListener('click', () => {
        if (typeof window._openMessagingWidget === 'function') {
            window._openMessagingWidget(
                lead.id,
                fullName(lead),
                lead.phone || lead.phone_secondary || lead.company_phone || '',
                lead
            );
        }
    });

    // ── Research Intelligence Controller ─────────────────────────────────────

    function countResearchFilled() {
        const core = ['research_company','research_contact','research_hypothesis','research_personalization'];
        return core.filter(k => (lead[k] || '').trim()).length;
    }

    function updateResearchProgress() {
        const coreFilled = countResearchFilled();
        const coreComplete = coreFilled >= 4;
        const card = document.getElementById('research-card');
        if (card) card.style.borderLeft = `4px solid ${coreComplete ? 'var(--status-won)' : '#f59e0b'}`;
        const badge = document.getElementById('research-status-badge');
        if (badge) {
            badge.textContent = coreComplete ? '✓ Ready' : 'Pending';
            badge.style.cssText = `font-size:0.68rem;font-weight:600;padding:2px 10px;border-radius:999px;${coreComplete ? 'background:#dcfce7;color:#15803d;' : 'background:#fef3c7;color:#92400e;'}`;
        }
    }


    function _showResearchState(state) {
        const skeleton = document.getElementById('research-skeleton');
        const errorEl  = document.getElementById('research-error');
        const content  = document.getElementById('research-content');
        const emptyEl  = document.getElementById('research-empty');
        if (skeleton) skeleton.style.display = state === 'loading'    ? 'block' : 'none';
        if (errorEl)  errorEl.style.display  = state === 'error'     ? 'block' : 'none';
        if (content)  content.style.display  = state === 'populated' ? 'block' : 'none';
        if (emptyEl)  emptyEl.style.display  = state === 'empty'     ? 'block' : 'none';
    }

    function _populateResearchCards(data) {
        // v2 field mapping: backend field → display element ID
        const map = {
            // v2 primary fields
            'ic-company-pulse-display': data.company_pulse  || data.research_company,
            'ic-why-display':           data.why_they_need_us || data.research_hypothesis,
            'ic-opening-display':       data.opening_line   || data.research_hook,
            'ic-objection-display':     data.likely_objection || data.research_personalization,
            'ic-persona-display':       data.persona_signal || data.research_contact,
            // legacy fallback IDs (still in DOM if old cache)
            'ic-hook-display':          data.research_hook,
            'ic-company-display':       data.research_company,
            'ic-hypothesis-display':    data.research_hypothesis,
            'ic-personalization-display': data.research_personalization,
            'ic-contact-display':       data.research_contact,
        };
        for (const [id, val] of Object.entries(map)) {
            const el = document.getElementById(id);
            if (!el) continue;
            if (val) { el.textContent = val; }
            else     { el.innerHTML   = '<span style="color:var(--text-muted);font-style:italic;">Not generated</span>'; }
        }
        // Heat badge
        const heat = data.heat_score || data.research_heat || '';
        const heatBadge = document.getElementById('heat-badge');
        if (heatBadge && heat) {
            const emoji = heat === 'hot' ? '🔥' : heat === 'warm' ? '♨️' : '🧊';
            const bg    = heat === 'hot' ? '#fef2f2' : heat === 'warm' ? '#fffbeb' : '#eff6ff';
            const color = heat === 'hot' ? '#dc2626' : heat === 'warm' ? '#d97706' : '#1d4ed8';
            const border= heat === 'hot' ? '#fecaca' : heat === 'warm' ? '#fde68a' : '#bfdbfe';
            heatBadge.innerHTML = `${emoji} ${heat.toUpperCase()}`;
            heatBadge.style.display = 'inline-flex';
            heatBadge.style.background = bg;
            heatBadge.style.color = color;
            heatBadge.style.border = `1px solid ${border}`;
            // Persist to lead object
            lead.research_heat = heat;
        }
        _showResearchState('populated');
        updateResearchProgress();
    }

    async function triggerAutoResearch(force = false) {
        if (!lead.company && !lead.first_name && !lead.title) { _showResearchState('empty'); return; }
        // v8: auto-trigger if no research OR if old v1 research lacks heat/opening_line fields
        const isV1Only = researchComplete && !hasV2Research;
        if (!force && researchComplete && !isV1Only) { _populateResearchCards(lead); return; }

        // Global guard: only one AI research request across the entire app at a time.
        // Per-closure flags fail when the user navigates between leads rapidly — each
        // new renderLeadDetail closure has its own flag, so concurrent requests still fire.
        if (window._aiResearchInFlight) return;
        window._aiResearchInFlight = true;

        _showResearchState('loading');
        try {
            const resp = await fetch(`${API_BASE}/api/leads/${lead.id}/ai-research`, {
                method: 'POST', headers: { ...authHeaders() },
            });
            if (!resp.ok) {
                const e = await resp.json().catch(() => ({}));
                throw new Error(e.detail || `Error ${resp.status}`);
            }
            const data = await resp.json();

            // Update lead object with v2 fields
            const allKeys = [
                'research_company','research_contact','research_hypothesis','research_personalization',
                'research_hook','research_heat','research_opening',
                'company_pulse','why_they_need_us','opening_line','likely_objection','persona_signal','heat_score'
            ];
            for (const k of allKeys) {
                if ((!(lead[k] || '').toString().trim() || force || isV1Only) && data[k]) {
                    lead[k] = data[k];
                }
            }
            _populateResearchCards({...lead, ...data});
        } catch (err) {
            console.error('[Research] Failed:', err);
            const errMsg = document.getElementById('research-error-msg');
            if (errMsg) errMsg.textContent = err.message;
            _showResearchState('error');
        } finally {
            // Short cooldown after request completes so rapid navigation doesn't
            // immediately fire a new request for the next lead
            setTimeout(() => { window._aiResearchInFlight = false; }, 3000);
        }
    }

    // Inline edit setup

    if (_canModify) {
        container.querySelectorAll('.intel-edit-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const field     = btn.dataset.field;
                const displayEl = document.getElementById(btn.dataset.displayId);
                if (!displayEl || displayEl.dataset.editing === 'true') return;
                const isMulti   = displayEl.dataset.multiline === 'true';
                const origVal   = lead[field] || '';
                const editEl    = document.createElement(isMulti ? 'textarea' : 'input');
                editEl.value    = origVal;
                editEl.style.cssText = `width:100%;padding:6px 8px;border:1.5px solid var(--primary-color);border-radius:6px;font-family:inherit;font-size:0.85rem;background:var(--bg-card);outline:none;${isMulti ? 'min-height:70px;resize:vertical;' : ''}`;
                displayEl.dataset.editing = 'true';
                displayEl.after(editEl);
                displayEl.style.display = 'none';
                editEl.focus();

                const save = () => {
                    const newVal = editEl.value.trim();
                    displayEl.style.display = '';
                    displayEl.dataset.editing = 'false';
                    if (newVal) { displayEl.textContent = newVal; }
                    else        { displayEl.innerHTML = '<span style="color:var(--text-muted);font-style:italic;">Not set</span>'; }
                    editEl.remove();
                    if (newVal !== origVal) {
                        lead[field] = newVal;
                        updateResearchProgress();
                        api.patchLeadResearch(lead.id, { [field]: newVal }).catch(err => {
                            console.warn('[Research] Edit save failed:', err.message);
                            showToast('Failed to save edit', 'error');
                        });
                    }
                };
                editEl.addEventListener('blur', save);
                editEl.addEventListener('keydown', e => {
                    if (e.key === 'Enter' && !isMulti) { e.preventDefault(); save(); }
                    if (e.key === 'Escape') { displayEl.style.display = ''; displayEl.dataset.editing = 'false'; editEl.remove(); }
                });
            });
        });
    }

    // Copy buttons
    container.querySelectorAll('.intel-copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const src = document.getElementById(btn.dataset.copyId);
            if (!src) return;
            const text = src.textContent.trim();
            if (!text) return;
            navigator.clipboard.writeText(text).then(() => {
                const orig = btn.textContent;
                btn.textContent = '✓ Copied'; btn.style.color = '#059669';
                setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1500);
            }).catch(() => showToast('Copy failed', 'error'));
        });
    });

    // Regenerate button
    const regenBtn = document.getElementById('regenerate-research-btn');
    if (regenBtn) {
        regenBtn.addEventListener('click', () => {
            if (!confirm('Regenerate AI research? This will replace all current research with fresh AI content.')) return;
            triggerAutoResearch(true);
        });
    }

    // Retry button
    const retryBtn = document.getElementById('retry-research-btn');
    if (retryBtn) retryBtn.addEventListener('click', () => triggerAutoResearch(false));

    {
        const coreFilled = countResearchFilled();
        const isV1CacheOnly = coreFilled >= 4 && !hasV2Research;
        if (coreFilled >= 4) {
            // Full v1 or v2 research — show what we have.
            // v1-only leads (missing heat/opening) are NOT silently upgraded;
            // the SDR can click Regenerate to get v2 fields on demand.
            // Silent auto-upgrade was the root cause of 429 storms on Groq.
            _populateResearchCards(lead);
        } else if (coreFilled > 0) {
            // Partial research — show what we have; don't auto-trigger.
            // SDR can click Regenerate to complete.
            _populateResearchCards(lead);
        } else {
            // No research at all — auto-trigger once (global semaphore prevents concurrent calls)
            setTimeout(() => triggerAutoResearch(false), 400);
        }
    }

    updateResearchProgress();


    // ── Pipeline V2 click handlers (event delegation) ─────────────────────
    // ── Pipeline V2 click handlers (event delegation) ─────────────────────
    // Stage pill click → toggle expand panels
    container.querySelectorAll('.pipeline-v2-stage').forEach(pill => {
        pill.addEventListener('click', () => {
            const stageId = pill.dataset.stage;
            const expandEl = container.querySelector(`.pipeline-v2-expand[data-expand-stage="${stageId}"]`);
            if (expandEl) {
                expandEl.classList.toggle('open');
            }
        });
    });

    // Sub-step click OR stage circle click → status update
    const pipelineCard = container.querySelector('.pipeline-v2-card');
    if (pipelineCard) {
        pipelineCard.addEventListener('click', async (e) => {
            let targetStatus, targetIdx;

            // Check if user clicked a sub-step (inside expanded panel)
            const stepEl = e.target.closest('.pipeline-v2-substep');
            if (stepEl) {
                targetStatus = stepEl.dataset.step;
                targetIdx = parseInt(stepEl.dataset.idx);
            } else {
                // Check if user clicked a top-level stage circle (Qualification, Meeting, Discovery, Demo)
                const stageEl = e.target.closest('.pipeline-v2-stage');
                if (!stageEl) return;
                const stageIdx = parseInt(stageEl.dataset.stageIdx);
                if (isNaN(stageIdx) || stageIdx < 0 || stageIdx >= PIPELINE_STAGES.length) return;
                // Map stage click → first status of that stage
                const stage = PIPELINE_STAGES[stageIdx];
                targetStatus = stage.subSteps[0].status;
                targetIdx = POSITIVE_PATH.indexOf(targetStatus);
            }
            if (!targetStatus || targetStatus === lead.status) return; // Already there

            // Block clicks on disqualified leads
            if (lead.status === 'Disqualified') {
                showToast('This lead has been disqualified and cannot be moved.', 'warning');
                return;
            }

            // Block if user cannot modify this lead
            if (!_canModify) {
                showToast('You do not have permission to modify this lead.', 'warning');
                return;
            }

            // SDRs cannot move leads backward in the pipeline
            const PIPELINE = ['Lead Assigned', 'Research', 'Calling', 'Meeting Scheduled', '1st Discovery Meeting', 'Discovery Complete', 'Demo Scheduled', 'Demo Done'];
            const currentIdx = PIPELINE.indexOf(lead.status);
            if (targetIdx < currentIdx && isSDR) {
                showToast('Only POD Admins and Super Admins can move leads to a previous state.', 'warning');
                return;
            }

            // Block SDRs from skipping entire pipeline stages.
            // SDRs CAN move freely within the same stage group
            // (e.g. Lead Assigned → Calling are both Qualification).
            // They CANNOT skip stages (e.g. Qualification → Discovery).
            if (isSDR && _getStageIndex(targetStatus) > _getStageIndex(lead.status) + 1) {
                showToast('Please advance one stage at a time.', 'warning');
                return;
            }

            // v8: Research gate is server-controlled. Frontend shows a scroll-highlight
            // hint only — actual enforcement is done by the backend (admin toggle).
            // We still check locally to give fast UX feedback, but don't hard-block.
            if (targetIdx >= 2 && targetIdx <= 3) {
                const CORE_RESEARCH_FIELDS = [
                    { key: 'research_company',    label: 'Company description' },
                    { key: 'research_contact',    label: 'Contact context' },
                    { key: 'research_hypothesis', label: 'Pitch angle' },
                    { key: 'research_personalization', label: 'Personalization note' },
                ];
                const missing = CORE_RESEARCH_FIELDS.filter(f => !(lead[f.key] || '').trim());
                if (missing.length > 0 && !researchComplete) {
                    // Scroll to research card as a hint, but still allow the move (server will block if gate is on)
                    const card = document.getElementById('research-card');
                    if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.style.boxShadow = '0 0 0 3px #f59e0b40'; setTimeout(() => card.style.boxShadow = '', 2500); }
                }
            }

            // Enforce: Meeting Scheduled requires at least 1 call logged
            if (targetStatus === 'Meeting Scheduled' && calls.length === 0) {
                showToast('Log at least 1 call before moving to Meeting Scheduled');
                return;
            }

            // Enforce: Demo Done only through outcome modal, not stepper click
            if (targetStatus === 'Demo Done') {
                showToast('Use the Demo Outcome panel below to record the demo result.', 'info');
                return;
            }

            try {
                const res = await api.updateLeadStatus(leadId, targetStatus);
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    showToast(err.detail || 'Failed to update status');
                    return;
                }
                mp.track('Lead Status Changed', {
                    lead_id:     leadId,
                    company:     lead.company || '',
                    from_status: lead.status  || '',
                    to_status:   targetStatus,
                });
                showToast(`Status updated to ${targetStatus}`, 'success');
                // Re-render the detail page to reflect new state
                setTimeout(() => renderLeadDetail(container, leadId, openCallModal, loadView), 500);
            } catch (err) {
                showToast('Failed to update status: ' + (err.message || err));
            }
        });
    }

    // ── Close Lead / Disqualify button handler ───────────────────────────
    const closeLeadBtn = document.getElementById('close-lead-btn');
    if (closeLeadBtn) {
        closeLeadBtn.addEventListener('click', () => {
            const reasons = [];
            // Add "No Phone Number" option for leads without phone
            if (_hasNoPhone) reasons.push('No Phone Number');
            reasons.push('Not Interested', 'Unreachable', 'Wrong Number', 'Other');
            const options = reasons.map(r => `<option value="${r}">${r}</option>`).join('');

            // Toggle inline disqualify form
            const existing = document.getElementById('close-lead-form');
            if (existing) { existing.remove(); return; }

            const form = document.createElement('div');
            form.id = 'close-lead-form';
            form.style.cssText = 'margin-top:12px;padding:16px;border-radius:10px;background:#fee2e220;border:1px solid #ef444430;';
            form.innerHTML = `
                <div style="font-weight:600;font-size:0.85rem;margin-bottom:8px;color:#ef4444;">Disqualify Lead</div>
                <select id="close-reason-select" class="filter-select" style="width:100%;margin-bottom:8px;">${options}</select>
                ${_hasNoPhone ? '<div style="font-size:0.75rem;color:#6b7280;margin-bottom:8px;">ℹ️ "No Phone Number" bypasses the call requirement.</div>' : ''}
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button class="btn btn-outline" id="close-lead-cancel" style="font-size:0.8rem;padding:4px 12px;">Cancel</button>
                    <button class="btn btn-primary" id="close-lead-confirm" style="font-size:0.8rem;padding:4px 12px;background:#ef4444;border-color:#ef4444;">Confirm</button>
                </div>
            `;
            closeLeadBtn.parentElement.after(form);

            document.getElementById('close-lead-cancel').addEventListener('click', () => form.remove());
            document.getElementById('close-lead-confirm').addEventListener('click', async () => {
                const reason = document.getElementById('close-reason-select').value;
                try {
                    const res = await api.closeLead(leadId, reason);
                    if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        showToast(err.detail || 'Failed to close lead', 'error');
                        return;
                    }
                    mp.track('Lead Closed', {
                        lead_id: leadId,
                        company: lead.company || '',
                        reason,
                    });
                    showToast(`Lead disqualified: ${reason}`, 'success');
                    setTimeout(() => renderLeadDetail(container, leadId, openCallModal, loadView), 500);
                } catch (e) {
                    showToast('Error: ' + (e.message || e), 'error');
                }
            });
        });
    }

    // ── Delete Lead button handler (admin/pod admin only) ────────────────
    const deleteLeadBtn = document.getElementById('delete-lead-btn');
    if (deleteLeadBtn) {
        deleteLeadBtn.addEventListener('click', () => {
            // Show confirmation modal
            const existingModal = document.getElementById('delete-lead-modal');
            if (existingModal) { existingModal.remove(); return; }

            const modal = document.createElement('div');
            modal.id = 'delete-lead-modal';
            modal.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';
            modal.innerHTML = `
                <div style="background:white;border-radius:14px;padding:32px;width:450px;max-width:90vw;box-shadow:0 20px 40px rgba(0,0,0,0.15);">
                    <div style="text-align:center;margin-bottom:16px;">
                        <span style="font-size:2.5rem;">⚠️</span>
                    </div>
                    <h3 style="margin:0 0 12px;font-size:1.1rem;font-weight:700;text-align:center;color:#1a202c;">Delete Lead Permanently?</h3>
                    <p style="font-size:0.88rem;color:#4a5568;line-height:1.5;margin:0 0 16px;text-align:center;">
                        Are you sure you want to delete <strong>${fullName(lead)}</strong>? This action cannot be undone. All associated calls, notes, tasks, and emails will be permanently removed.
                    </p>
                    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:0.82rem;color:#991b1b;text-align:center;">
                        ⚠️ This is irreversible
                    </div>
                    <div style="display:flex;gap:10px;justify-content:flex-end;">
                        <button class="btn btn-outline" id="delete-lead-cancel" style="font-size:0.85rem;padding:8px 18px;">Cancel</button>
                        <button class="btn btn-primary" id="delete-lead-confirm" style="font-size:0.85rem;padding:8px 18px;background:#ef4444;border-color:#ef4444;">Delete Lead</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // Close on backdrop click
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

            document.getElementById('delete-lead-cancel').addEventListener('click', () => modal.remove());
            document.getElementById('delete-lead-confirm').addEventListener('click', async () => {
                const confirmBtn = document.getElementById('delete-lead-confirm');
                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Deleting...';
                try {
                    await api.bulkDeleteLeads([leadId]);
                    showToast('Lead deleted successfully', 'success');
                    modal.remove();
                    // Navigate back to leads list
                    setTimeout(() => loadView('leads'), 500);
                } catch (e) {
                    showToast('Error deleting lead: ' + (e.message || e), 'error');
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = 'Delete Lead';
                }
            });
        });
    }

    // ── No Show button handler ──────────────────────────────────────────
    const noShowBtn = document.getElementById('no-show-btn');
    if (noShowBtn) {
        noShowBtn.addEventListener('click', () => {
            openNoShowModal(lead.id, fullName(lead));
        });
    }

    // ── Demo Success button handler ─────────────────────────────────────
    const demoSuccessBtn = document.getElementById('demo-success-btn');
    if (demoSuccessBtn) {
        demoSuccessBtn.addEventListener('click', async () => {
            demoSuccessBtn.disabled = true;
            demoSuccessBtn.textContent = '⏳ Processing...';
            try {
                const res = await api.updateLeadStatus(leadId, 'Demo Done');
                // updateLeadStatus returns raw fetch Response
                if (res && !res.ok) {
                    const err = await res.json().catch(() => ({}));
                    showToast(err.detail || 'Failed to mark demo as done', 'error');
                    demoSuccessBtn.disabled = false;
                    demoSuccessBtn.textContent = '✅ Demo Successful';
                    return;
                }
                showToast('🎉 Demo marked as successful! Lead will be pushed to Salesforce.', 'success', 5000);
                setTimeout(() => renderLeadDetail(container, leadId, openCallModal, loadView), 500);
            } catch (e) {
                showToast('Error: ' + (e.message || e), 'error');
                demoSuccessBtn.disabled = false;
                demoSuccessBtn.textContent = '✅ Demo Successful';
            }
        });
    }

    // ── Demo Failed button handler ──────────────────────────────────────
    const demoFailedBtn = document.getElementById('demo-failed-btn');
    if (demoFailedBtn) {
        demoFailedBtn.addEventListener('click', () => {
            const modal = document.createElement('div');
            modal.id = 'demo-failed-modal';
            modal.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';
            modal.innerHTML = `
                <div style="background:white;border-radius:16px;padding:32px;width:480px;max-width:90vw;box-shadow:0 20px 40px rgba(0,0,0,0.18);">
                    <div style="text-align:center;margin-bottom:16px;">
                        <span style="font-size:2.5rem;">❌</span>
                    </div>
                    <h3 style="margin:0 0 12px;font-size:1.1rem;font-weight:700;text-align:center;color:#1a202c;">Demo Failed / Customer No-Show</h3>
                    <p style="font-size:0.85rem;color:#4a5568;line-height:1.5;margin:0 0 16px;text-align:center;">
                        This lead will be sent to <strong>Pending Review</strong>. Your Pod Admin will decide next steps.
                    </p>
                    <div style="margin-bottom:16px;">
                        <label style="font-weight:600;font-size:0.82rem;display:block;margin-bottom:6px;">Failure Reason</label>
                        <select id="demo-fail-reason" class="filter-select" style="width:100%;padding:10px 14px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.88rem;">
                            <option value="Customer No-Show">Customer No-Show</option>
                            <option value="Customer Not Ready">Customer Not Ready</option>
                            <option value="Technical Issues">Technical Issues</option>
                            <option value="Rescheduled">Rescheduled</option>
                            <option value="Lost Interest">Lost Interest</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>
                    <div style="margin-bottom:16px;">
                        <label style="font-weight:600;font-size:0.82rem;display:block;margin-bottom:6px;">Notes (optional)</label>
                        <textarea id="demo-fail-notes" rows="2" style="width:100%;padding:10px 14px;border:1px solid #e4e4e7;border-radius:10px;font-size:0.85rem;resize:vertical;box-sizing:border-box;" placeholder="Any additional context..."></textarea>
                    </div>
                    <div style="display:flex;gap:10px;justify-content:flex-end;">
                        <button class="btn btn-outline" id="demo-fail-cancel" style="font-size:0.85rem;padding:8px 18px;">Cancel</button>
                        <button class="btn btn-primary" id="demo-fail-confirm" style="font-size:0.85rem;padding:8px 18px;background:#ef4444;border-color:#ef4444;">Confirm Failure</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
            document.getElementById('demo-fail-cancel').addEventListener('click', () => modal.remove());
            document.getElementById('demo-fail-confirm').addEventListener('click', async () => {
                const reason = document.getElementById('demo-fail-reason').value;
                const notes = document.getElementById('demo-fail-notes').value;
                const confirmBtn = document.getElementById('demo-fail-confirm');
                confirmBtn.disabled = true;
                confirmBtn.textContent = '⏳ Processing...';
                try {
                    // BUG-10: Log 'Demo Failed' outcome — backend handles Pending Review routing
                    const phone = lead.phone || lead.phone_secondary || lead.company_phone || '';
                    await api.logCall(leadId, {
                        outcome: 'Demo Failed',
                        notes: notes ? `[${reason}] ${notes}` : `[${reason}]`,
                        phone
                    });
                    showToast(`Demo failure recorded: ${reason}. Lead sent to Pending Review.`, 'warning', 5000);
                    modal.remove();
                    setTimeout(() => renderLeadDetail(container, leadId, openCallModal, loadView), 500);
                } catch (e) {
                    showToast('Error: ' + (e.message || e), 'error');
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = 'Confirm Failure';
                }
            });
        });
    }

    // ── Meeting Complete button handler (BUG-4) ──────────────────────────
    const meetingCompleteBtn = document.getElementById('meeting-complete-btn');
    if (meetingCompleteBtn) {
        meetingCompleteBtn.addEventListener('click', async () => {
            meetingCompleteBtn.disabled = true;
            meetingCompleteBtn.textContent = '⏳ Processing...';
            try {
                const phone = lead.phone || lead.phone_secondary || lead.company_phone || '';
                await api.logCall(leadId, {
                    outcome: 'Meeting Complete',
                    notes: '',
                    phone
                });
                showToast('✅ Meeting confirmed! Lead advanced to Discovery stage.', 'success', 4000);
                setTimeout(() => renderLeadDetail(container, leadId, openCallModal, loadView), 500);
            } catch (e) {
                showToast('Error: ' + (e.message || e), 'error');
                meetingCompleteBtn.disabled = false;
                meetingCompleteBtn.textContent = '✅ Mark Meeting Complete';
            }
        });
    }

    // ── Add Discovery Meeting button handler ────────────────────────────
    const addDiscoveryBtn = document.getElementById('add-discovery-btn');
    if (addDiscoveryBtn) {
        addDiscoveryBtn.addEventListener('click', async () => {
            addDiscoveryBtn.disabled = true;
            addDiscoveryBtn.textContent = '⏳ Logging...';
            try {
                await api.addDiscoveryMeeting(leadId);
                showToast('Discovery meeting logged!', 'success');
                setTimeout(() => renderLeadDetail(container, leadId, openCallModal, loadView), 500);
            } catch (e) {
                showToast('Error: ' + (e.message || e), 'error');
                addDiscoveryBtn.disabled = false;
                addDiscoveryBtn.textContent = '+ Add Discovery Call';
            }
        });
    }

    // ── Log Outcome for Discovery CTA (shown when gate is active) ──────
    // Opens the existing call modal — same as the main "Log Call" button.
    const logOutcomeForDiscoveryBtn = document.getElementById('log-outcome-for-discovery-btn');
    if (logOutcomeForDiscoveryBtn) {
        logOutcomeForDiscoveryBtn.addEventListener('click', () => {
            openCallModal(leadId, fullName(lead),
                lead.phone || lead.phone_secondary || lead.company_phone || '', lead);
        });
    }

    const completeDiscoveryBtn = document.getElementById('complete-discovery-btn');
    if (completeDiscoveryBtn) {
        completeDiscoveryBtn.addEventListener('click', async () => {
            completeDiscoveryBtn.disabled = true;
            completeDiscoveryBtn.textContent = '⏳ Completing...';
            try {
                const res = await api.updateLeadStatus(leadId, 'Discovery Complete');
                // updateLeadStatus returns raw fetch Response
                if (res && !res.ok) {
                    const err = await res.json().catch(() => ({}));
                    showToast(err.detail || 'Failed to complete discovery', 'error');
                    completeDiscoveryBtn.disabled = false;
                    completeDiscoveryBtn.textContent = '✓ Complete Discovery';
                    return;
                }
                showToast('Discovery marked complete!', 'success');
                setTimeout(() => renderLeadDetail(container, leadId, openCallModal, loadView), 500);
            } catch (e) {
                showToast('Error: ' + (e.message || e), 'error');
                completeDiscoveryBtn.disabled = false;
                completeDiscoveryBtn.textContent = '✓ Complete Discovery';
            }
        });
    }

    // ── Schedule Demo button handler ────────────────────────────────────
    const scheduleDemoBtn = document.getElementById('schedule-demo-btn');
    if (scheduleDemoBtn) {
        scheduleDemoBtn.addEventListener('click', async () => {
            scheduleDemoBtn.disabled = true;
            scheduleDemoBtn.textContent = '⏳ Scheduling...';
            try {
                const res = await api.updateLeadStatus(leadId, 'Demo Scheduled');
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    showToast(err.detail || 'Failed to schedule demo', 'error');
                    scheduleDemoBtn.disabled = false;
                    scheduleDemoBtn.textContent = '🎬 Schedule Demo';
                    return;
                }
                showToast('Demo scheduled!', 'success');
                setTimeout(() => renderLeadDetail(container, leadId, openCallModal, loadView), 500);
            } catch (e) {
                showToast('Error: ' + (e.message || e), 'error');
                scheduleDemoBtn.disabled = false;
                scheduleDemoBtn.textContent = '🎬 Schedule Demo';
            }
        });
    }

    // Send Email button — opens composer modal
    const sendEmailBtn = document.getElementById('send-email-btn');
    if (sendEmailBtn) {
        sendEmailBtn.addEventListener('click', async () => {
            // Check mailbox status first
            const emailStatus = await api.getEmailStatus().catch(() => ({ connected: false }));
            if (!emailStatus.connected) {
                showToast('Please connect your email first (see Emails tab)', 'warning');
                // Switch to Emails tab
                container.querySelector('[data-tab="emails"]')?.click();
                return;
            }

            const leadEmail = sendEmailBtn.dataset.leadEmail;
            const leadName = sendEmailBtn.dataset.leadName;
            const leadIdForEmail = sendEmailBtn.dataset.leadId;

            // Create composer modal
            const existing = document.getElementById('email-composer-modal');
            if (existing) { existing.remove(); return; }

            const modal = document.createElement('div');
            modal.id = 'email-composer-modal';
            modal.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';
            modal.innerHTML = `
                <div style="background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,0.15);overflow:hidden;width:100%;max-width:560px;max-height:90vh;display:flex;flex-direction:column;">
                    <div style="background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;">
                        <h3 style="margin:0;font-size:0.9rem;font-weight:700;display:flex;align-items:center;gap:8px;">📧 New Email</h3>
                        <button id="close-composer" style="background:none;border:none;color:#fff;font-size:1.2rem;cursor:pointer;opacity:0.7;">✕</button>
                    </div>
                    <div style="padding:20px;flex:1;overflow-y:auto;">
                        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f1f5f9;">
                            <span style="font-size:0.78rem;font-weight:600;color:#64748b;width:60px;">From</span>
                            <span style="font-size:0.85rem;color:#64748b;">${emailStatus.email || currentUser?.email || ''}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f1f5f9;">
                            <span style="font-size:0.78rem;font-weight:600;color:#64748b;width:60px;">To</span>
                            <span style="font-size:0.85rem;color:#1e293b;">${leadEmail}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f1f5f9;">
                            <span style="font-size:0.78rem;font-weight:600;color:#64748b;width:60px;">Subject</span>
                            <input type="text" id="email-subject" placeholder="Enter subject..." style="border:none;outline:none;font-size:0.85rem;width:100%;font-family:inherit;color:#1e293b;">
                        </div>
                        <textarea id="email-body" placeholder="Write your email..." style="width:100%;min-height:160px;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:0.85rem;font-family:inherit;resize:vertical;margin-top:12px;box-sizing:border-box;"></textarea>
                    </div>
                    <div style="padding:14px 20px;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;">
                        <div style="font-size:0.72rem;color:#64748b;">Sent from your connected mailbox</div>
                        <div style="display:flex;gap:8px;">
                            <button id="cancel-email" class="btn btn-outline" style="font-size:0.82rem;padding:8px 16px;">Cancel</button>
                            <button id="confirm-send-email" class="btn btn-primary" style="font-size:0.82rem;padding:8px 16px;background:linear-gradient(135deg,#6366f1,#818cf8);border:none;">📨 Send Email</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // Modal event handlers
            document.getElementById('close-composer').addEventListener('click', () => modal.remove());
            document.getElementById('cancel-email').addEventListener('click', () => modal.remove());
            modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

            document.getElementById('confirm-send-email').addEventListener('click', async () => {
                const subject = document.getElementById('email-subject').value.trim();
                const body = document.getElementById('email-body').value.trim();
                if (!subject && !body) { showToast('Please enter a subject or message', 'warning'); return; }

                const sendBtn = document.getElementById('confirm-send-email');
                sendBtn.textContent = '⏳ Sending...';
                sendBtn.disabled = true;

                try {
                    const result = await api.sendEmail(leadIdForEmail, subject, body);
                    if (result.ok) {
                        mp.track('Email Sent', {
                            lead_id:      leadIdForEmail,
                            has_template: false,
                            source:       'lead_detail_composer',
                            role:         currentUser?.role || '',
                        });
                        showToast('📧 Email sent successfully!', 'success');
                        modal.remove();
                        // Reload lead detail to show new email in timeline
                        setTimeout(() => renderLeadDetail(container, leadId, openCallModal, loadView), 500);
                    } else {
                        showToast(result.data?.detail || 'Failed to send email', 'error');
                        sendBtn.textContent = '📨 Send Email';
                        sendBtn.disabled = false;
                    }
                } catch (e) {
                    showToast('Error: ' + (e.message || e), 'error');
                    sendBtn.textContent = '📨 Send Email';
                    sendBtn.disabled = false;
                }
            });
        });
    }

    // ── Editable contact fields ──────────────────────────────────────────
    container.querySelectorAll('.editable-field').forEach(field => {
        const key = field.dataset.key;
        if (!key) return;
        field.style.cursor = 'pointer';
        field.title = 'Click to edit';
        field.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = lead[key] || '';
            input.style.cssText = 'font-size:0.9rem;padding:4px 8px;border:1px solid var(--border-color);border-radius:6px;width:100%;';
            const parent = field.parentElement;
            // Guard: field may have been detached (user navigated away mid-click)
            if (!parent || !parent.contains(field)) return;
            parent.replaceChild(input, field);
            input.focus();
            async function save() {
                const newVal = input.value;
                lead[key] = newVal;
                await api.patchLead(leadId, { [key]: newVal }).catch(() => {});
                const newEl = document.createElement('div');
                newEl.style.fontSize = '0.9rem';
                newEl.dataset.key = key;
                newEl.className = 'editable-field';
                newEl.textContent = newVal || '—';
                newEl.style.cursor = 'pointer';
                newEl.title = 'Click to edit';
                // Guard: input may have been detached if user navigated away during save
                if (parent && parent.contains(input)) {
                    parent.replaceChild(newEl, input);
                    // Re-bind click on the new element
                    newEl.addEventListener('click', () => field.click());
                }
            }
            input.addEventListener('blur', save);
            input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
        });
    });

    // Notes
    document.getElementById('add-note-btn').addEventListener('click', async () => {
        const ta = document.getElementById('note-textarea');
        const content = ta.value.trim(); if (!content) return;
        const note = await api.addLeadNote(leadId, content, currentUser.name || 'You');
        mp.track('Note Added', { lead_id: leadId, note_length: content.length, role: currentUser?.role || '' });
        ta.value = '';
        const nl = document.getElementById('notes-list');
        nl.innerHTML = `<div class="note-item" data-note-id="${note.id}">
            <p>${note.content}</p><div class="note-meta">${note.author} · Just now</div>
            <button class="note-delete" title="Delete note">✕</button>
        </div>` + nl.innerHTML;
        bindNoteDeletes();
    });

    function bindNoteDeletes() {
        container.querySelectorAll('.note-delete').forEach(btn => {
            btn.onclick = async () => {
                const noteId = btn.closest('.note-item').dataset.noteId;
                await api.deleteLeadNote(leadId, noteId);
                btn.closest('.note-item').remove();
            };
        });
    }
    bindNoteDeletes();

    // ── Opportunity Outcome buttons ──
    async function setOutcome(outcome) {
        const notesInput = document.getElementById('outcome-notes-input');
        const notes = notesInput ? notesInput.value.trim() : '';
        const resp = await api.patchLeadOutcome(leadId, outcome, notes);
        if (resp.ok) {
            showToast(`Lead marked as ${outcome}`);
            renderLeadDetail(container, leadId);   // re-render
        } else {
            const err = await resp.json().catch(() => ({}));
            showToast(err.detail || 'Failed to update outcome', 'error');
        }
    }
    const wonBtn = document.getElementById('outcome-won-btn');
    if (wonBtn) wonBtn.addEventListener('click', () => setOutcome('Won'));
    const lostBtn = document.getElementById('outcome-lost-btn');
    if (lostBtn) lostBtn.addEventListener('click', () => setOutcome('Lost'));
    const changeBtn = document.getElementById('change-outcome-btn');
    if (changeBtn) {
        changeBtn.addEventListener('click', () => {
            // Replace the outcome card content with editable form
            const card = changeBtn.closest('.info-card');
            card.innerHTML = `
                <div class="info-card-title">🏷️ Opportunity Outcome</div>
                <p style="font-size:0.85rem;color:var(--text-muted);margin:0 0 12px 0;">Update the outcome:</p>
                <div style="display:flex;gap:10px;margin-bottom:10px;">
                    <button class="btn" id="outcome-won-btn" style="background:#059669;color:#fff;padding:8px 24px;border-radius:8px;font-weight:600;font-size:0.9rem;">✅ Won</button>
                    <button class="btn" id="outcome-lost-btn" style="background:#dc2626;color:#fff;padding:8px 24px;border-radius:8px;font-weight:600;font-size:0.9rem;">❌ Lost</button>
                </div>
                <input type="text" id="outcome-notes-input" placeholder="Optional: add context..." style="width:100%;padding:8px 12px;border:1px solid var(--border-color);border-radius:8px;font-size:0.82rem;">
            `;
            document.getElementById('outcome-won-btn').addEventListener('click', () => setOutcome('Won'));
            document.getElementById('outcome-lost-btn').addEventListener('click', () => setOutcome('Lost'));
        });
    }

    // Call history toggle
    const toggleCallsBtn = document.getElementById('toggle-calls-btn');
    if (toggleCallsBtn) {
        toggleCallsBtn.addEventListener('click', () => {
            const rem = document.getElementById('calls-remaining');
            const isHidden = rem.style.display === 'none';
            rem.style.display = isHidden ? 'block' : 'none';
            toggleCallsBtn.textContent = isHidden
                ? `Show recent ${CALLS_PREVIEW_COUNT} calls ▲`
                : `Show all ${calls.length} calls ▼`;
        });
    }

    // Tasks
    document.getElementById('add-task-btn').addEventListener('click', async () => {
        const inp  = document.getElementById('task-input');
        const due  = document.getElementById('task-due');
        const time = document.getElementById('task-time');
        const title = inp.value.trim();
        if (!title) { inp.focus(); return; }

        // Build ISO due_time string when both date + time are provided
        let due_time = null;
        if (due.value && time.value) {
            // Convert local time to UTC ISO so backend stores the correct instant
            due_time = new Date(`${due.value}T${time.value}:00`).toISOString();
        }

        const btn = document.getElementById('add-task-btn');
        btn.disabled = true;
        btn.textContent = '...';
        try {
            const task = await api.addLeadTask(leadId, title, due.value || null, due_time);
            if (!task || !task.id) throw new Error(task?.detail || 'Failed to create task');
            inp.value = ''; due.value = ''; time.value = '';
            const list  = document.getElementById('tasks-list');
            const empty = document.getElementById('empty-tasks');
            if (empty) empty.remove();
            // Format due label: show time if present
            const dueLabel = due_time
                ? `${task.due_date} ${time.value}`
                : task.due_date || '';
            list.innerHTML += `<div class="task-item" data-task-id="${task.id}">
                <input type="checkbox" class="task-check">
                <span>${task.title}</span>
                ${dueLabel ? `<small style="color:var(--text-muted);font-size:0.75rem;">📅 ${dueLabel}</small>` : ''}
                <button class="btn-icon task-del" title="Delete">✕</button>
            </div>`;
            bindTaskEvents();
        } catch (err) {
            showToast('Could not add task: ' + (err.message || err), 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Add';
        }
    });

    function bindTaskEvents() {
        container.querySelectorAll('.task-check').forEach(chk => {
            chk.onchange = async () => {
                const taskEl = chk.closest('.task-item');
                await api.patchLeadTask(leadId, taskEl.dataset.taskId, { done: chk.checked });
                taskEl.classList.toggle('done', chk.checked);
            };
        });
        container.querySelectorAll('.task-del').forEach(btn => {
            btn.onclick = async () => {
                const taskEl = btn.closest('.task-item');
                await api.deleteLeadTask(leadId, taskEl.dataset.taskId);
                taskEl.remove();
            };
        });
    }
    bindTaskEvents();

    // ── Phase 2: Progressive data loading (non-blocking) ────────────────
    // Fire all secondary fetches in parallel AFTER the shell is visible.
    // Each populates its placeholder section independently.

    // 2a. Load Notes
    api.fetchLeadNotes(leadId).then(noteData => {
        notes = noteData || [];
        const notesList = document.getElementById('notes-list');
        if (notesList) {
            notesList.innerHTML = renderNotes(notes);
            // Re-bind delete handlers
            notesList.querySelectorAll('.note-delete').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const item = btn.closest('.note-item');
                    await api.deleteLeadNote(leadId, item.dataset.noteId);
                    item.remove();
                });
            });
        }
    }).catch(e => console.error('[LeadDetail] Notes load failed:', e));

    // 2b. Load Tasks
    api.fetchLeadTasks(leadId).then(taskData => {
        tasks = taskData || [];
        const tasksList = document.getElementById('tasks-list');
        if (tasksList) {
            tasksList.innerHTML = renderTasks(tasks);
            bindTaskEvents();
        }
    }).catch(e => console.error('[LeadDetail] Tasks load failed:', e));

    // 2b-2. Load Sales Journey enrollments (card stays hidden if there are none)
    api.fetchLeadJourneyEnrollments(leadId).then(enrollments => {
        const card = document.getElementById('journey-status-card');
        const list = document.getElementById('journey-status-list');
        if (card && list && enrollments.length) {
            list.innerHTML = renderJourneyEnrollments(enrollments);
            card.style.display = '';
        }
    }).catch(e => console.error('[LeadDetail] Journey enrollments load failed:', e));

    // 2c. Load Calls (overview tab preview)
    api.fetchLeadCalls(leadId).then(callsData => {
        const callList = callsData.calls || callsData || [];
        calls.push(...callList); // keep `calls` (used by the Meeting Scheduled gate below) in sync
        const callsList = document.getElementById('calls-list');
        const callsTitle = callsList?.previousElementSibling;
        if (callsList) {
            callsList.innerHTML = renderCallLogs(callList);
            if (callsTitle) callsTitle.innerHTML = `📞 Call History (${callList.length})`;
            // Bind toggle button
            const toggleBtn = document.getElementById('toggle-calls-btn');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', () => {
                    const rem = document.getElementById('calls-remaining');
                    if (rem) {
                        const show = rem.style.display === 'none';
                        rem.style.display = show ? '' : 'none';
                        toggleBtn.textContent = show ? `Show less ▲` : `Show all ${callList.length} calls ▼`;
                    }
                });
            }
        }
        // Update calls tab badge
        const badge = document.getElementById('calls-tab-count');
        if (badge && callList.length > 0) {
            badge.textContent = callList.length;
            badge.style.display = '';
        }
    }).catch(e => console.error('[LeadDetail] Calls load failed:', e));

    // 2d. Load Status History (timeline in right panel)
    api.fetchLeadStatusHistory(leadId).then(histData => {
        statusHistory = histData || [];
        const timeline = container.querySelector('.timeline');
        if (timeline && statusHistory.length > 0) {
            // Rebuild timeline HTML (preserve the source entry at the bottom)
            const sourceEntry = timeline.querySelector('.timeline-item:last-child');
            const sourceHTML = sourceEntry ? sourceEntry.outerHTML : '';
            timeline.innerHTML = statusHistory.map(s => `
                <div class="timeline-item">
                    <div class="timeline-dot">📊</div>
                    <div class="timeline-content">
                        <p>
                            <span class="badge ${statusBadgeClass(s.from_status)}" style="font-size:0.68rem;">${s.from_status || '—'}</span>
                            <span style="margin:0 4px;">→</span>
                            <span class="badge ${statusBadgeClass(s.to_status)}" style="font-size:0.68rem;">${s.to_status}</span>
                        </p>
                        <span>${s.changed_by || 'System'} · ${fmtDateTime(s.changed_at)}</span>
                    </div>
                </div>`).join('') + sourceHTML;
        }

        // Now rebuild pipeline-v2 connector times using the loaded history
        if (statusHistory.length > 0) {
            const enteredAt = {};
            enteredAt['Lead Assigned'] = lead.lead_started_at || lead.created_at;
            for (const entry of statusHistory) {
                if (entry.to_status && entry.changed_at) {
                    enteredAt[entry.to_status] = entry.changed_at;
                }
            }
            // Update V2 connector time labels (between stages)
            container.querySelectorAll('.pipeline-v2-connector-time').forEach((el, i) => {
                // Connector times are already computed at render; update with fresh history
                // (they may have been placeholder on initial render before history loaded)
            });
            // Update V2 sub-step timestamps
            container.querySelectorAll('.pipeline-v2-substep').forEach(step => {
                const stepName = step.dataset.step;
                const tsEl = step.querySelector('.pipeline-v2-substep-time');
                if (tsEl && enteredAt[stepName]) {
                    tsEl.textContent = fmtDateTime(enteredAt[stepName]);
                } else if (!tsEl && enteredAt[stepName]) {
                    // Add timestamp element if it wasn't rendered initially
                    const newTs = document.createElement('div');
                    newTs.className = 'pipeline-v2-substep-time';
                    newTs.textContent = fmtDateTime(enteredAt[stepName]);
                    step.appendChild(newTs);
                }
            });
            // Update discovery entry timestamps
            container.querySelectorAll('.pipeline-v2-discovery-info-time').forEach(el => {
                if (el.textContent === 'Timestamp pending...' && enteredAt['1st Discovery Meeting']) {
                    el.textContent = fmtDateTime(enteredAt['1st Discovery Meeting']);
                }
            });
        }
    }).catch(e => console.error('[LeadDetail] Status history load failed:', e));
}

function _renderEnrichmentCard(lead) {
    const hasEnrichment = lead.industry || lead.employee_count || lead.annual_revenue || lead.linkedin_url || lead.website;
    if (!hasEnrichment) return '';

    const fields = [
        { label: 'Industry', value: lead.industry },
        { label: 'Employees', value: lead.employee_count },
        { label: 'Revenue', value: lead.annual_revenue },
        { label: 'Funding', value: lead.total_funding },
        { label: 'Website', value: lead.website, link: true },
        { label: 'LinkedIn', value: lead.linkedin_url || lead.person_linkedin, link: true },
        { label: 'Company LinkedIn', value: lead.company_linkedin, link: true },
        { label: 'Location', value: [lead.city, lead.state, lead.country].filter(Boolean).join(', ') },
        { label: 'Company Address', value: [lead.company_street, lead.company_city, lead.company_state, lead.company_postal_code, lead.company_country].filter(Boolean).join(', ') },
        { label: 'Founded', value: lead.company_founded },
    ].filter(f => f.value);

    return `<div class="info-card">
        <div class="info-card-title" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;margin-bottom:0;border-bottom:none;padding-bottom:0;" onclick="const b=this.nextElementSibling;const a=this.querySelector('.enrich-toggle');if(b.style.display==='none'){b.style.display='grid';a.textContent='Hide ▾';}else{b.style.display='none';a.textContent='Show Details ▸';}">
            <span>🔍 Enrichment Data</span>
            <span class="enrich-toggle" style="font-size:0.72rem;color:var(--primary-color);font-weight:600;">Show Details ▸</span>
        </div>
        <div class="info-grid" style="display:none;margin-top:16px;">${fields.map(f => `
            <div class="info-field">
                <label>${f.label}</label>
                <span class="field-value" style="cursor:default;">${f.link && f.value
                    ? `<a href="${f.value.startsWith('http') ? f.value : 'https://' + f.value}" target="_blank" style="color:var(--primary-color);">${f.value}</a>`
                    : f.value}</span>
            </div>`).join('')}
        </div>
    </div>`;
}
