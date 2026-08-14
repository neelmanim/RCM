// ── views/modals.js — All modal wiring (call, new lead, add user, bulk import, no-show) ─
import { currentUser } from '../auth.js';
import { logCall, createUser, createLead, markNoShow, fetchCallOutcomes, fetchCallOutcomeStatus, createDisqualifyRequest, getEmailStatus, getCalendarAvailability, draftMeetingAgenda } from '../api.js';
import { showToast } from '../utils.js';
import { mp } from '../mp.js';

// ponytail: cached for the page's lifetime — a stale "not connected" answer
// just needs a page refresh if the SDR connects mid-session, which isn't a
// real flow. `null` means "not checked yet"; { connected: bool } once checked.
let _emailStatusCache = null;
let _availabilityCheckGen = 0; // discards out-of-order responses from rapid date/time edits
let _agendaDraftGen = 0; // discards stale AI-draft responses from rapid re-clicks
let _meetingReviewConfirmed = false; // reset whenever a meeting field changes or the modal reopens


// ── Cached outcome config ─────────────────────────────────────────────────────
let _outcomeConfigCache = null;

async function _getOutcomeConfig() {
    if (!_outcomeConfigCache) {
        try {
            _outcomeConfigCache = await fetchCallOutcomes();
        } catch (e) {
            console.error('Failed to fetch call outcomes:', e);
            _outcomeConfigCache = { outcomes: [], enabled_outcomes: [] };
        }
    }
    return _outcomeConfigCache;
}

export function initModals(loadView, getCurrentView, getLeads) {
    _initCallModal(loadView, getCurrentView, getLeads);
    _initNewLeadModal(loadView, getCurrentView);
    _initAddUserModal(loadView, getCurrentView);
    _initBulkImportModal(loadView, getCurrentView);
    _initNoShowModal(loadView, getCurrentView);
    _initDisqualifyModal();
}

// ── Call modal — state machine ────────────────────────────────────────────────
let activeCallLeadId   = null;
let activeDialerCallId = null;   // DB UUID of the DialerCall record
let _activeBranch      = null;   // 'no' | 'yes' | null
let _activeOutcomeValue   = null;
let _activeNotesRequired  = false;
let _dialerProvider    = null;   // 'aircall' | 'rcm' | null
let _aircallPollInterval  = null;
let _aircallPollFailures  = 0;
let _kbHandler         = null;
let _outcomeEnabledList   = [];  // outcomes fetched for current session

// Helper: 2-letter initials from display name
function _getInitials(name) {
    if (!name) return '?';
    return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

// Chip icon map
function _chipIcon(value) {
    const map = {
        'No Answer':        '📵',
        'Left Voicemail':   '📬',
        'Busy':             '🔔',
        'Wrong Number':     '❌',
        'Call Back Later':  '📞',
        'Share Materials':  '📤',
        'Send Deck':        '📤',
        'Not Interested':   '👎',
        'Disqualify':       '🚫',
        'Left the Company': '🚪',
        'Meeting Scheduled':'📆',
        'Meeting Confirmed':'📅',
    };
    return map[value] || '•';
}

// Render 2-col chip grid from an array of {value, icon, notesRequired}
function _renderChipsGrid(chips) {
    const rows = [];
    for (let i = 0; i < chips.length; i += 2) {
        const a = chips[i];
        const b = chips[i + 1];
        rows.push(`
            <div class="clm-chips-row">
                <div class="clm-chip" data-value="${a.value}" data-notes-required="${a.notesRequired || false}">
                    <span class="clm-chip-icon">${a.icon}</span>
                    <span class="clm-chip-label">${a.value}</span>
                </div>
                ${b ? `<div class="clm-chip" data-value="${b.value}" data-notes-required="${b.notesRequired || false}">
                    <span class="clm-chip-icon">${b.icon}</span>
                    <span class="clm-chip-label">${b.value}</span>
                </div>` : '<div class="clm-chip clm-chip-placeholder"></div>'}
            </div>`);
    }
    return `<div class="clm-chips-grid">${rows.join('')}</div>`;
}

// No/Voicemail branch — all not_answered outcomes
function _renderNoChips(outcomes) {
    const items = outcomes.filter(o => o.group === 'not_answered');
    const chips = (items.length ? items : [
        { value: 'No Answer', notes_required: false },
        { value: 'Left Voicemail', notes_required: false },
    ]).map(o => ({ value: o.value, icon: _chipIcon(o.value), notesRequired: o.notes_required }));
    return `<div class="clm-chips-header">What happened?</div>` + _renderChipsGrid(chips);
}

// Yes/Connected branch — Meeting Confirmed featured card + others grid
function _renderYesChips(outcomes) {
    const meeting  = outcomes.find(o => o.value === 'Meeting Confirmed');
    const others   = outcomes.filter(o => o.value !== 'Meeting Confirmed' && (o.group === 'answered' || o.group === 'terminal'));
    const otherChips = others.map(o => ({ value: o.value, icon: _chipIcon(o.value), notesRequired: o.notes_required }));

    const nr = meeting ? meeting.notes_required : false;
    let html = `<div class="clm-chips-header">What was the outcome?</div>`;
    html += `
        <div class="clm-featured-chip" data-value="Meeting Confirmed" data-notes-required="${nr}">
            <div class="clm-featured-chip-main">
                <span class="clm-featured-icon">📅</span>
                <div>
                    <div class="clm-featured-label">Meeting Booked</div>
                    <div class="clm-featured-sub">Best outcome ✦</div>
                </div>
            </div>
            <div id="meeting-date-expand" class="clm-meeting-date-expand" style="display:none;">
                <div id="meeting-connect-warning" style="display:none;padding:10px 14px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:0.8rem;margin-bottom:8px;">
                    ⚠️ Connect your email in Settings to book meetings from RCM.
                </div>
                <div id="meeting-conflict-warning" style="display:none;padding:10px 14px;border-radius:8px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:0.8rem;margin-bottom:8px;">
                    ⚠️ You have another meeting at this time.
                </div>
                <div class="clm-date-row">
                    <div class="clm-date-field">
                        <label>📅 Date &amp; Time <span style="color:#ef4444;">*</span></label>
                        <input type="datetime-local" id="meeting-datetime-input" class="clm-date-input">
                    </div>
                    <div class="clm-date-field">
                        <label>⏱️ Duration</label>
                        <select id="meeting-duration-input" class="clm-date-input">
                            <option value="15">15 min</option>
                            <option value="30" selected>30 min</option>
                            <option value="45">45 min</option>
                            <option value="60">60 min</option>
                        </select>
                    </div>
                </div>
                <div class="clm-date-field" style="margin-top:8px;">
                    <label>📝 Meeting title (optional)</label>
                    <input type="text" id="meeting-title-input" class="clm-date-input" style="width:100%;" placeholder="Meeting: Jane Doe (Acme)">
                </div>
                <div class="clm-date-field" style="margin-top:8px;">
                    <label>➕ Add guests (optional)</label>
                    <input type="text" id="meeting-guests-input" class="clm-date-input" style="width:100%;" placeholder="guest1@company.com, guest2@company.com">
                </div>
                <div class="clm-date-field" style="margin-top:8px;">
                    <label>🗒️ Agenda (optional)
                        <button type="button" id="meeting-agenda-draft-btn" class="clm-ai-draft-btn" style="margin-left:8px;font-size:0.72rem;padding:2px 8px;border-radius:6px;border:1px solid #c7d2fe;background:#eef2ff;color:#4338ca;cursor:pointer;">✨ Draft with AI</button>
                    </label>
                    <textarea id="meeting-agenda-input" class="clm-date-input" style="width:100%;min-height:50px;" placeholder="What you'll cover in the meeting…"></textarea>
                </div>
                <div id="meeting-date-error" class="clm-date-error" style="display:none;">Please set a date before logging.</div>
                <div style="font-size:0.72rem;color:#047857;margin-top:5px;">A calendar invite will be sent to the lead automatically.</div>
            </div>
            <div id="meeting-review-panel" style="display:none;padding:12px 14px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;font-size:0.82rem;margin-top:8px;">
                <div style="font-weight:600;margin-bottom:8px;color:#334155;">Review before sending the invite</div>
                <div id="meeting-review-summary" style="color:#475569;white-space:pre-line;"></div>
                <div style="display:flex;gap:8px;margin-top:12px;">
                    <button type="button" id="meeting-review-back-btn" style="flex:1;padding:8px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#334155;cursor:pointer;">← Back to edit</button>
                    <button type="button" id="meeting-review-confirm-btn" style="flex:1;padding:8px;border-radius:6px;border:none;background:#16a34a;color:#fff;cursor:pointer;font-weight:600;">Confirm &amp; Send Invite →</button>
                </div>
            </div>
        </div>`;
    if (otherChips.length) html += _renderChipsGrid(otherChips);
    return html;
}

// Meeting Booked requires a connected mailbox (real calendar invite) — check
// once per page load and gate the date/time/duration inputs + submit button.
// A failed check (network error) is NOT the same as a confirmed "not
// connected" — never false-block someone who's actually connected; the
// backend independently re-validates and is the real source of truth.
async function _applyMailboxGate() {
    const warning  = document.getElementById('meeting-connect-warning');
    const dtIn     = document.getElementById('meeting-datetime-input');
    const durIn    = document.getElementById('meeting-duration-input');
    const guestsIn = document.getElementById('meeting-guests-input');
    const titleIn  = document.getElementById('meeting-title-input');
    const agendaIn = document.getElementById('meeting-agenda-input');
    const draftBtn = document.getElementById('meeting-agenda-draft-btn');
    const submit   = document.getElementById('submit-call-btn');
    if (_emailStatusCache === null) {
        try { _emailStatusCache = await getEmailStatus(); } catch { _emailStatusCache = { connected: null }; }
    }
    const confirmedNotConnected = _emailStatusCache.connected === false;
    if (warning) warning.style.display = confirmedNotConnected ? '' : 'none';
    [dtIn, durIn, guestsIn, titleIn, agendaIn, draftBtn].forEach(el => { if (el) el.disabled = confirmedNotConnected; });
    if (submit && confirmedNotConnected) submit.disabled = true;
}

// Advisory-only conflict check — never blocks submission, just warns.
async function _checkMeetingConflict() {
    const dtIn   = document.getElementById('meeting-datetime-input');
    const durIn  = document.getElementById('meeting-duration-input');
    const banner = document.getElementById('meeting-conflict-warning');
    if (!dtIn?.value || !banner) return;
    const gen = ++_availabilityCheckGen;
    const startIso = new Date(dtIn.value).toISOString();
    const durationMinutes = Number(durIn?.value || 30);
    const result = await getCalendarAvailability(startIso, durationMinutes).catch(() => ({ available: null }));
    if (gen !== _availabilityCheckGen) return; // a newer edit already superseded this check
    banner.style.display = (result.available === false) ? '' : 'none';
}

// AI drafts a client-safe agenda (never the internal persona/objection/heat
// fields — see backend's _build_agenda_prompt docstring) — always editable
// afterward, never blocks the modal on failure.
async function _draftAgendaWithAI() {
    const btn = document.getElementById('meeting-agenda-draft-btn');
    const agendaIn = document.getElementById('meeting-agenda-input');
    if (!btn || !agendaIn || !activeCallLeadId) return;
    const gen = ++_agendaDraftGen;
    const originalLabel = btn.textContent;
    btn.disabled = true; btn.textContent = 'Drafting…';
    try {
        const agenda = await draftMeetingAgenda(activeCallLeadId);
        if (gen !== _agendaDraftGen) return; // a newer click already superseded this one
        agendaIn.value = agenda;
    } catch {
        if (gen === _agendaDraftGen) {
            showToast("Couldn't draft an agenda — write your own, or try again.", 'warning', 4000);
        }
    } finally {
        if (gen === _agendaDraftGen) { btn.disabled = false; btn.textContent = originalLabel; }
    }
}

// Real invite going out to the lead — show a read-only summary and require
// an explicit second action before it's actually sent. Only "Confirm & Send
// Invite" re-clicks the (hidden) submit button, this time with
// _meetingReviewConfirmed already set so the handler falls through to logCall.
function _showMeetingReview({ email, formatted, duration, title, agenda, guests }) {
    const expand  = document.getElementById('meeting-date-expand');
    const panel   = document.getElementById('meeting-review-panel');
    const summary = document.getElementById('meeting-review-summary');
    const submit  = document.getElementById('submit-call-btn');
    if (!expand || !panel || !summary) return;

    const resolvedTitle = title || '(default title — Meeting: contact name (company))';
    const lines = [
        `To: ${email || 'no email on file — no invite will be sent, event still added to your own calendar'}`,
        `When: ${formatted} (${duration} min)`,
        `Title: ${resolvedTitle}`,
        `Agenda: ${agenda || '(none — invite will just show who booked it)'}`,
        `Guests: ${guests?.length ? guests.join(', ') : '(none)'}`,
    ];
    summary.textContent = lines.join('\n');

    expand.style.display = 'none';
    panel.style.display = '';
    if (submit) submit.style.display = 'none';
}

// Resets confirmation + review-panel visibility WITHOUT touching
// #meeting-date-expand's own display — callers that also need to
// show/hide the fields (chip toggle, "Back to edit") handle that themselves.
function _resetMeetingReviewState() {
    _meetingReviewConfirmed = false;
    const panel  = document.getElementById('meeting-review-panel');
    const submit = document.getElementById('submit-call-btn');
    if (panel) panel.style.display = 'none';
    if (submit) submit.style.display = '';
}

// "Back to edit" — cancel the review and make the fields editable again.
function _hideMeetingReview() {
    _resetMeetingReviewState();
    const expand = document.getElementById('meeting-date-expand');
    if (expand) expand.style.display = '';
}

// Wire click handlers for all chips in the picker
function _wireChipHandlers() {
    const picker = document.getElementById('call-outcome-picker');
    if (!picker) return;

    const featured     = picker.querySelector('.clm-featured-chip');
    const featuredMain = featured?.querySelector('.clm-featured-chip-main');
    const grids        = picker.querySelectorAll('.clm-chip:not(.clm-chip-placeholder)');

    function _deselectAll() {
        picker.querySelectorAll('.clm-chip').forEach(c => c.classList.remove('selected'));
        if (featured) featured.classList.remove('selected');
        // EC-1.8: collapse meeting date on any chip switch
        const expand = document.getElementById('meeting-date-expand');
        if (expand) expand.style.display = 'none';
    }

    if (featured && featuredMain) {
        // Bound to .clm-featured-chip-main (icon+label), NOT the whole card —
        // the card also contains #meeting-date-expand (datetime/duration/guests
        // inputs), and a listener on the whole card would see every click inside
        // those fields bubble up and toggle the outcome off, collapsing the box.
        featuredMain.addEventListener('click', () => {
            const wasSelected = featured.classList.contains('selected');
            _deselectAll();
            _resetMeetingReviewState(); // clean slate either way — toggling this chip always cancels any pending review
            if (!wasSelected) {
                featured.classList.add('selected');
                const expand = document.getElementById('meeting-date-expand');
                if (expand) expand.style.display = '';
                _selectChip(featured.dataset.value, featured.dataset.notesRequired === 'true');
                _applyMailboxGate();
            } else {
                // Toggled off
                _activeOutcomeValue = null;
                document.getElementById('call-outcome-select').value = '';
                document.getElementById('submit-call-btn').disabled = true;
                document.getElementById('call-notes-section').style.display = 'none';
            }
        });
        ['meeting-datetime-input', 'meeting-duration-input'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', _checkMeetingConflict);
        });
        document.getElementById('meeting-agenda-draft-btn')?.addEventListener('click', _draftAgendaWithAI);
        document.getElementById('meeting-review-back-btn')?.addEventListener('click', _hideMeetingReview);
        document.getElementById('meeting-review-confirm-btn')?.addEventListener('click', () => {
            _meetingReviewConfirmed = true;
            document.getElementById('submit-call-btn')?.click();
        });
    }

    grids.forEach(chip => {
        chip.addEventListener('click', () => {
            _deselectAll();
            chip.classList.add('selected');
            _selectChip(chip.dataset.value, chip.dataset.notesRequired === 'true');
        });
    });
}

// Activate a chip: update state, show notes, enable Log Call
function _selectChip(value, notesRequired) {
    _activeOutcomeValue  = value;
    _activeNotesRequired = notesRequired;
    document.getElementById('call-outcome-select').value = value;

    const notesLabel = document.getElementById('call-notes-label');
    if (notesLabel) {
        notesLabel.innerHTML = notesRequired
            ? 'Notes <span style="font-size:0.75rem;color:#ef4444;font-weight:600;">(required)</span>'
            : 'Notes <span style="font-size:0.75rem;color:var(--text-muted);">(optional)</span>';
    }

    document.getElementById('call-notes-section').style.display = '';
    document.getElementById('submit-call-btn').disabled = false;
}

// Reset modal to State 1 (binary question)
function _showState1() {
    _activeBranch        = null;
    _activeOutcomeValue  = null;
    _activeNotesRequired = false;
    document.getElementById('outcome-question-section').style.display = '';
    document.getElementById('outcome-chips-section').style.display    = 'none';
    document.getElementById('call-notes-section').style.display       = 'none';
    document.getElementById('submit-call-btn').disabled = true;
    document.getElementById('call-outcome-select').value = '';
    document.getElementById('branch-no-btn')?.classList.remove('selected');
    document.getElementById('branch-yes-btn')?.classList.remove('selected');
}

// Handle branch selection → reveal chips
function _pickBranch(branch) {
    // EC-1.2: clear any previous chip selection when branch changes
    _activeBranch        = branch;
    _activeOutcomeValue  = null;
    _activeNotesRequired = false;
    document.getElementById('call-outcome-select').value = '';
    document.getElementById('submit-call-btn').disabled  = true;

    // Hide question section
    document.getElementById('outcome-question-section').style.display = 'none';

    // Compact branch indicator with "change" link
    const compactBar = document.getElementById('branch-compact-bar');
    if (compactBar) {
        const isNo    = branch === 'no';
        const label   = isNo ? '✗ No / Voicemail' : '✓ Yes, Connected';
        const color   = isNo ? 'var(--text-muted)' : '#16a34a';
        compactBar.innerHTML = `
            <div class="branch-compact-bar">
                <span class="branch-compact-label" style="color:${color};">${label}</span>
                <button class="branch-change-link" id="branch-change-btn">change</button>
            </div>`;
        document.getElementById('branch-change-btn')?.addEventListener('click', () => {
            document.getElementById('meeting-date-expand') && (document.getElementById('meeting-date-expand').style.display = 'none');
            _showState1();
        });
    }

    // Render chips from prefetched outcome list
    const picker = document.getElementById('call-outcome-picker');
    if (picker) {
        picker.innerHTML = _outcomeEnabledList.length
            ? (branch === 'no' ? _renderNoChips(_outcomeEnabledList) : _renderYesChips(_outcomeEnabledList))
            : '<div style="padding:16px;color:var(--text-muted);font-size:0.85rem;">Loading outcomes…</div>';
    }

    document.getElementById('outcome-chips-section').style.display = '';
    document.getElementById('call-notes-section').style.display    = 'none';
    _wireChipHandlers();
}

// Keyboard shortcuts (EC-1.4: registered after render, EC-1.5: ignored before branch)
function _registerKeyboardShortcuts() {
    if (_kbHandler) document.removeEventListener('keydown', _kbHandler);
    _kbHandler = (e) => {
        const modal = document.getElementById('call-log-modal');
        if (!modal || modal.style.display !== 'flex') return;
        if (['TEXTAREA', 'INPUT', 'SELECT'].includes(e.target.tagName)) return;

        if (!_activeBranch) {
            if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); _pickBranch('yes'); }
            if (e.key === 'n' || e.key === 'N') { e.preventDefault(); _pickBranch('no'); }
        } else {
            // EC-1.5: number shortcuts only after branch picked
            const num = parseInt(e.key);
            if (num >= 1 && num <= 9) {
                e.preventDefault();
                const picker = document.getElementById('call-outcome-picker');
                if (!picker) return;
                const chips = [...picker.querySelectorAll('.clm-featured-chip, .clm-chip:not(.clm-chip-placeholder)')];
                chips[num - 1]?.click();
            }
        }
        if (e.key === 'Enter' && !document.getElementById('submit-call-btn').disabled) {
            e.preventDefault();
            document.getElementById('submit-call-btn').click();
        }
    };
    document.addEventListener('keydown', _kbHandler);
}

// Aircall polling (EC-1.12: Page Visibility API, EC-3.11: 3-failure stop)
function _startAircallPoll(callId) {
    _stopAircallPoll();
    _aircallPollFailures = 0;

    // Resume polling when tab becomes visible again
    const _onVisible = () => {
        if (!document.hidden) {
            document.removeEventListener('visibilitychange', _onVisible);
            _startAircallPoll(callId);
        }
    };

    _aircallPollInterval = setInterval(async () => {
        if (document.hidden) {
            // EC-1.12: pause when tab is hidden
            _stopAircallPoll();
            document.addEventListener('visibilitychange', _onVisible);
            return;
        }
        try {
            const data = await fetchCallOutcomeStatus(callId);
            _aircallPollFailures = 0;
            if (data.outcome_logged) {
                _stopAircallPoll();
                const modal = document.getElementById('call-log-modal');
                if (modal?.style.display === 'flex') {
                    const resolvedLeadId = activeCallLeadId;
                    modal.style.display = 'none';
                    activeCallLeadId   = null;
                    activeDialerCallId = null;
                    window._clearPendingOutcome?.();
                    showToast(`✓ Outcome synced from Aircall: ${data.outcome}`, 'success', 5000);
                    window.dispatchEvent(new CustomEvent('rcm:call-outcome-resolved',
                        { detail: { leadId: resolvedLeadId, outcome: data.outcome, resolved: 'synced' } }));
                }
            }
        } catch (e) {
            _aircallPollFailures++;
            // EC-3.11: stop after 3 consecutive failures
            if (_aircallPollFailures >= 3) {
                _stopAircallPoll();
                console.warn('[AircallPoll] Stopped after 3 consecutive network failures');
            }
        }
    }, 5000);
}

function _stopAircallPoll() {
    if (_aircallPollInterval) {
        clearInterval(_aircallPollInterval);
        _aircallPollInterval = null;
    }
}

/**
 * Open the call outcome modal.
 * @param {string}      leadId        - Lead UUID
 * @param {string}      leadName      - Display name shown in the header
 * @param {string}      phone         - Phone number shown in the header
 * @param {object}      lead          - Lead object (for attempt warnings)
 * @param {string|null} dialerCallId  - DialerCall DB UUID (prevents duplicate log)
 * @param {string|null} dialerProvider - 'aircall' | 'rcm' | null (controls sync UI)
 */
export async function openCallModal(leadId, leadName, phone, lead = {}, dialerCallId = null, dialerProvider = null) {
    activeCallLeadId   = leadId;
    activeDialerCallId = dialerCallId || null;
    _dialerProvider    = (dialerProvider || '').toLowerCase() || null;

    // Stop any previous poll
    _stopAircallPoll();

    // Lead context bar
    const avatarEl = document.getElementById('call-modal-avatar');
    if (avatarEl) avatarEl.textContent = _getInitials(leadName);
    document.getElementById('call-modal-lead-name').textContent = leadName || 'Unknown';
    document.getElementById('call-modal-phone').textContent     = phone || 'No phone number';

    // Reset form
    document.getElementById('call-notes').value = '';
    document.getElementById('call-outcome-select').value = '';
    _meetingReviewConfirmed = false;

    // Reset state machine to State 1
    _showState1();

    // Show modal immediately (don't block on async)
    document.getElementById('call-log-modal').style.display = 'flex';

    // Hidden input housekeeping (preserved for backend)
    const attemptCount = lead.call_attempt_count || 0;
    const maxAttempts  = lead.max_call_attempts  || 5;
    document.getElementById('call-modal-lead-id').value        = leadId;
    document.getElementById('call-modal-attempt-count').value  = attemptCount;
    document.getElementById('call-modal-max-attempts').value   = maxAttempts;

    // Attempt warning banner
    const warningEl = document.getElementById('call-attempt-warning');
    if (warningEl) {
        if (attemptCount >= maxAttempts) {
            warningEl.style.cssText = 'display:block;padding:10px 16px;border-radius:8px;margin:0 0 12px;font-size:0.85rem;font-weight:600;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;';
            warningEl.innerHTML = `⚠️ Max call attempts reached (${attemptCount}/${maxAttempts}). Consider disqualifying.`;
        } else if (attemptCount >= Math.floor(maxAttempts * 0.6)) {
            warningEl.style.cssText = 'display:block;padding:10px 16px;border-radius:8px;margin:0 0 12px;font-size:0.85rem;font-weight:600;background:#fffbeb;color:#92400e;border:1px solid #fcd34d;';
            warningEl.innerHTML = `📞 ${attemptCount} of ${maxAttempts} call attempts made.`;
        } else {
            warningEl.style.display = 'none';
        }
    }

    // Company resolved warning
    const companyWarnEl = document.getElementById('call-company-resolved-warning');
    if (companyWarnEl) {
        if (lead.company_resolved?.resolved) {
            companyWarnEl.style.display = 'block';
            companyWarnEl.innerHTML = `
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:1.2rem;flex-shrink:0;">✅</span>
                    <div>
                        <div style="font-weight:700;color:#92400e;margin-bottom:2px;">Company Already Connected</div>
                        <div style="font-size:0.78rem;">A meeting was booked with <strong>${lead.company_resolved.resolved_by}</strong>${lead.company_resolved.resolved_title ? ` (${lead.company_resolved.resolved_title})` : ''} at this company.</div>
                    </div>
                </div>`;
        } else {
            companyWarnEl.style.display = 'none';
        }
    }

    // Aircall sync indicator (hidden for RCM / null — EC-1.9)
    const syncEl = document.getElementById('aircall-sync-indicator');
    if (syncEl) syncEl.style.display = _dialerProvider === 'aircall' ? 'flex' : 'none';

    // Prefetch outcomes in background (non-blocking)
    try {
        const config = await _getOutcomeConfig();
        _outcomeEnabledList = config.enabled_outcomes || config.outcomes || [];
    } catch (e) {
        _outcomeEnabledList = [];
    }

    // EC-1.4: register keyboard shortcuts after modal is rendered
    _registerKeyboardShortcuts();

    // ── Mixpanel: Call Modal Opened ───────────────────────────────────────
    mp.track('Call Modal Opened', {
        lead_id:  leadId,
        source:   dialerCallId ? 'dialer' : 'manual',
        provider: (dialerProvider || '').toLowerCase() || null,
        role:     currentUser?.role || '',
    });

    // Start Aircall polling only for aircall provider + valid callId
    if (_dialerProvider === 'aircall' && dialerCallId) {
        _startAircallPoll(dialerCallId);
    }
}

function _initCallModal(loadView, getCurrentView, getLeads) {
    const callModal = document.getElementById('call-log-modal');
    if (!callModal) return;

    // Branch pill click handlers
    document.getElementById('branch-no-btn')?.addEventListener('click',  () => _pickBranch('no'));
    document.getElementById('branch-yes-btn')?.addEventListener('click', () => _pickBranch('yes'));

    // Submit handler
    document.getElementById('submit-call-btn').addEventListener('click', async () => {
        const outcome = document.getElementById('call-outcome-select').value;
        let   notes   = document.getElementById('call-notes').value.trim();
        if (!activeCallLeadId || !outcome) return;

        // EC-1.6: Meeting Confirmed requires a date
        let meetingDatetime  = null;
        let meetingDuration  = null;
        let meetingGuests    = null;
        let meetingTitle     = null;
        let meetingAgenda    = null;
        let meetingFormatted = null;
        if (outcome === 'Meeting Confirmed') {
            // Confirmed-not-connected only — a failed/inconclusive status check
            // is not a block, the backend's own 400 is the real answer for that.
            if (_emailStatusCache?.connected === false) {
                document.getElementById('meeting-connect-warning').style.display = '';
                return;
            }
            const dtInput     = document.getElementById('meeting-datetime-input');
            const durInput    = document.getElementById('meeting-duration-input');
            const guestsInput = document.getElementById('meeting-guests-input');
            const titleInput  = document.getElementById('meeting-title-input');
            const agendaInput = document.getElementById('meeting-agenda-input');
            const dateErr     = document.getElementById('meeting-date-error');
            if (!dtInput?.value) {
                if (dateErr) dateErr.style.display = '';
                dtInput?.focus();
                return;
            }
            // EC-1.7: warn on past date but don't block
            const selectedDt = new Date(dtInput.value);
            if (selectedDt < new Date()) {
                showToast('⚠️ Meeting date is in the past — are you sure?', 'warning', 4000);
            }
            const formatted = selectedDt.toLocaleString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });
            notes = `Meeting scheduled for: ${formatted}${notes ? '\n' + notes : ''}`;
            // Real structured field for the unified calendar — previously this
            // date only ever lived as prose inside `notes`, unreadable by anything else.
            meetingDatetime  = selectedDt.toISOString();
            meetingDuration  = Number(durInput?.value || 30);
            meetingGuests    = (guestsInput?.value || '')
                .split(',').map(e => e.trim()).filter(Boolean);
            meetingTitle     = (titleInput?.value || '').trim();
            meetingAgenda    = (agendaInput?.value || '').trim();
            meetingFormatted = formatted;
        }

        // Notes required validation
        if (_activeNotesRequired && !notes) {
            showToast(`Notes are mandatory for "${outcome}". Please add details.`, 'warning', 5000);
            document.getElementById('call-notes').focus();
            document.getElementById('call-notes').style.border = '2px solid #ef4444';
            setTimeout(() => document.getElementById('call-notes').style.border = '', 3000);
            return;
        }

        // Real external invite going out — review before sending, don't fire on the first click.
        if (outcome === 'Meeting Confirmed' && !_meetingReviewConfirmed) {
            const lead = getLeads().find(l => l.id === activeCallLeadId);
            _showMeetingReview({
                email: lead?.email, formatted: meetingFormatted, duration: meetingDuration,
                title: meetingTitle, agenda: meetingAgenda, guests: meetingGuests,
            });
            return;
        }

        const btn = document.getElementById('submit-call-btn');
        btn.textContent = 'Saving…'; btn.disabled = true;

        const payload = { outcome, notes };
        if (activeDialerCallId) payload.dialer_call_id = activeDialerCallId;
        if (meetingDatetime) payload.meeting_datetime = meetingDatetime;
        if (meetingDuration) payload.meeting_duration_minutes = meetingDuration;
        if (meetingGuests?.length) payload.meeting_guest_emails = meetingGuests;
        if (meetingTitle) payload.meeting_title = meetingTitle;
        if (meetingAgenda) payload.meeting_agenda = meetingAgenda;

        try {
            const data = await logCall(activeCallLeadId, payload);
            mp.track('Call Logged', {
                lead_id: activeCallLeadId,
                outcome,
                branch:  _activeBranch || 'unknown',
                source:  activeDialerCallId ? 'dialer' : 'manual',
            });
            // Meeting Booked is a special high-signal event worth its own track
            if (outcome === 'Meeting Confirmed') {
                mp.track('Meeting Booked', {
                    lead_id:  activeCallLeadId,
                    source:   activeDialerCallId ? 'dialer' : 'manual',
                    has_date: !!(document.getElementById('meeting-datetime-input')?.value),
                    role:     currentUser?.role || '',
                });
                // The CRM update above already succeeded regardless — never let a
                // failed calendar invite look identical to a fully successful booking.
                if (meetingDatetime && data.calendar_event_created === false) {
                    showToast("⚠️ Meeting logged, but the calendar invite couldn't be sent. Please add it manually.", 'warning', 6000);
                }
            }
            const leads = getLeads();
            const lead  = leads.find(l => l.id === activeCallLeadId);
            if (lead && data.lead_status) lead.status = data.lead_status;

            btn.textContent = '✅ Logged!';
            _stopAircallPoll();           // EC-3.10
            window._clearPendingOutcome?.();
            activeDialerCallId = null;

            // Power Dialer hook: the one signal for "the SDR just finished
            // with this call" — fired here (Save), in the Aircall auto-sync
            // branch below, and in app.js's dismiss handler. Nothing else
            // dispatches this; a queue hook listens for it to re-enable
            // "Call Next" instead of gating on the raw call-ended event.
            window.dispatchEvent(new CustomEvent('rcm:call-outcome-resolved',
                { detail: { leadId: activeCallLeadId, outcome, resolved: 'logged' } }));

            setTimeout(() => {
                callModal.style.display = 'none';
                btn.textContent = 'Log Call →'; btn.disabled = false;
                const callLeadId = activeCallLeadId;
                activeCallLeadId = null;
                if (window.PowerDialerHub?.isMounted) return; // stay put — the hub re-renders off its own state
                if (callLeadId) {
                    loadView('lead-detail', callLeadId);
                    // EC-4: 1200ms gives lead-detail time to render even on slow networks
                    // EC-5: capture targetLeadId before the timeout so navigating away
                    //        to a different lead doesn't click the wrong Calls tab
                    const targetLeadId = callLeadId;
                    setTimeout(() => {
                        // Verify we are still looking at the intended lead
                        const currentLeadId = document.querySelector('[data-lead-id]')?.dataset.leadId;
                        if (currentLeadId && currentLeadId !== targetLeadId) return;
                        const callsTab = document.querySelector('.lead-tab[data-tab="calls"]');
                        if (callsTab) {
                            callsTab.click();
                        } else {
                            // Fallback: use the global refresh hook if tab isn't found yet
                            window._refreshCallsTab?.(targetLeadId);
                        }
                    }, 1200);
                } else {
                    loadView(getCurrentView());
                }
            }, 900);
        } catch (err) {
            showToast(err.message || 'Failed to log call. Please try again.', 'error', 5000);
            btn.textContent = 'Log Call →'; btn.disabled = false;
        }
    });

    // Close handlers — always stop poll (EC-3.10) and clear keyboard handler
    function _closeModal() {
        callModal.style.display = 'none';
        activeCallLeadId   = null;
        activeDialerCallId = null;
        _meetingReviewConfirmed = false;
        _stopAircallPoll();
        if (_kbHandler) { document.removeEventListener('keydown', _kbHandler); _kbHandler = null; }
        window._onCallModalDismissed?.();
    }

    document.querySelectorAll('.close-call-modal').forEach(el =>
        el.addEventListener('click', _closeModal));
    window.addEventListener('click', e => {
        if (e.target === callModal) _closeModal();
    });
}

// ── New Lead modal ────────────────────────────────────────────────────────────
function _initNewLeadModal(loadView, getCurrentView) {
    const newLeadModal = document.getElementById('new-lead-modal');
    const newLeadBtn   = document.getElementById('new-lead-btn');
    const newLeadForm  = document.getElementById('new-lead-form');
    if (!newLeadModal) return;

    if (newLeadBtn) newLeadBtn.addEventListener('click', () => newLeadModal.style.display = 'flex');

    document.querySelectorAll('.close-modal, .close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => newLeadModal.style.display = 'none');
    });
    window.addEventListener('click', e => { if (e.target === newLeadModal) newLeadModal.style.display = 'none'; });

    if (newLeadForm) {
        newLeadForm.addEventListener('submit', async e => {
            e.preventDefault();
            const payload = {
                first_name:      (document.getElementById('lead-first-name')?.value || '').trim(),
                last_name:       (document.getElementById('lead-last-name')?.value || '').trim() || 'Unknown',
                company:         (document.getElementById('lead-company')?.value || '').trim(),
                title:           (document.getElementById('lead-title')?.value || '').trim() || undefined,
                phone:           (document.getElementById('lead-phone')?.value || '').trim() || undefined,
                phone_secondary: (document.getElementById('lead-phone-secondary')?.value || '').trim() || undefined,
                email:           (document.getElementById('lead-email')?.value || '').trim() || undefined,
                linkedin_url:    (document.getElementById('lead-linkedin')?.value || '').trim() || undefined,
                status:          document.getElementById('lead-status')?.value || 'Lead Assigned'
            };

            // Client-side validation
            if (!payload.last_name || payload.last_name === 'Unknown') {
                showToast('Last Name is required.', 'warning', 4000);
                document.getElementById('lead-last-name')?.focus();
                return;
            }
            if (!payload.company) {
                showToast('Company is required.', 'warning', 4000);
                document.getElementById('lead-company')?.focus();
                return;
            }

            const submitBtn = newLeadForm.querySelector('button[type="submit"]');
            const oldText   = submitBtn.textContent;
            submitBtn.textContent = 'Saving...'; submitBtn.disabled = true;
            try {
                const res = await createLead(payload);
                if (res.ok) {
                    const data = await res.json();
                    mp.track('Lead Created', {
                        company: payload.company,
                        status:  payload.status || 'Lead Assigned',
                    });
                    const leadName = `${payload.first_name} ${payload.last_name}`.trim();
                    showToast(`Lead "${leadName}" created and assigned to you.`, 'success', 5000);
                    newLeadModal.style.display = 'none';
                    newLeadForm.reset();
                    await loadView(getCurrentView());
                } else {
                    const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
                    showToast(err.detail || 'Failed to create lead.', 'error', 5000);
                }
            } catch (err) {
                console.error(err);
                showToast('Error creating lead. Please try again.', 'error', 5000);
            }
            finally { submitBtn.textContent = oldText; submitBtn.disabled = false; }
        });
    }
}

// ── Add User modal ────────────────────────────────────────────────────────────
function _initAddUserModal(loadView, getCurrentView) {
    const modal = document.getElementById('add-user-modal');
    if (!modal) return;

    document.querySelectorAll('.close-add-user-modal').forEach(el => {
        el.addEventListener('click', () => modal.classList.remove('active'));
    });

    document.getElementById('add-user-form').addEventListener('submit', async e => {
        e.preventDefault();
        const email     = document.getElementById('new-user-email').value;
        const name      = document.getElementById('new-user-name').value;
        const role      = document.getElementById('new-user-role').value;
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.textContent = 'Inviting...'; submitBtn.disabled = true;
        try {
            const res = await createUser({ email, name, role });
            if (res.ok) {
                alert('User invited successfully!');
                modal.classList.remove('active');
                if (getCurrentView() === 'admin') loadView('admin');
            } else {
                const error = await res.json();
                alert(`Failed: ${error.detail || error.message || res.statusText}`);
            }
        } catch (err) { alert('An error occurred.'); }
        finally { submitBtn.textContent = 'Add User'; submitBtn.disabled = false; }
    });
}

// ── Bulk Import (CSV leads) modal ─────────────────────────────────────────────
function _initBulkImportModal(loadView, getCurrentView) {
    const modal          = document.getElementById('bulk-import-modal');
    const bulkBtn        = document.getElementById('bulk-btn');
    const csvFileInput   = document.getElementById('csv-file-input');
    const uploadCsvBtn   = document.getElementById('upload-csv-btn');
    const csvPreview     = document.getElementById('csv-preview');
    const csvPreviewTh   = document.getElementById('csv-preview-thead');
    const csvPreviewTb   = document.getElementById('csv-preview-tbody');
    const confirmImpBtn  = document.getElementById('confirm-import-btn');
    if (!modal) return;

    if (bulkBtn) bulkBtn.addEventListener('click', () => modal.classList.add('active'));
    document.querySelectorAll('.close-bulk-modal').forEach(el => el.addEventListener('click', () => modal.classList.remove('active')));

    let parsedLeads = [];
    if (uploadCsvBtn) {
        uploadCsvBtn.addEventListener('click', () => {
            const file = csvFileInput.files[0];
            if (!file) return alert('Select a file first.');
            Papa.parse(file, {
                header: true, skipEmptyLines: true,
                complete: (results) => {
                    parsedLeads = results.data.map(row => ({
                        first_name: row.firstName || row.first_name || row.FirstName || '',
                        last_name:  row.lastName  || row.last_name  || row.LastName  || 'Unknown',
                        company:    row.company   || row.Company    || 'N/A',
                        email:      row.email     || row.Email      || '',
                        phone:      row.phone     || row.Phone      || ''
                    }));
                    csvPreviewTh.innerHTML = `<tr><th>First</th><th>Last</th><th>Company</th><th>Email</th></tr>`;
                    csvPreviewTb.innerHTML = parsedLeads.slice(0, 5).map(r =>
                        `<tr><td>${r.first_name}</td><td>${r.last_name}</td><td>${r.company}</td><td>${r.email}</td></tr>`
                    ).join('');
                    csvPreview.style.display = 'block';
                    confirmImpBtn.style.display = 'block';
                }
            });
        });
    }

    if (confirmImpBtn) {
        confirmImpBtn.addEventListener('click', async () => {
            confirmImpBtn.textContent = 'Importing...'; confirmImpBtn.disabled = true;
            try {
                // Create leads one by one via the createLead API
                let created = 0;
                for (const lead of parsedLeads) {
                    const res = await createLead(lead);
                    if (res.ok) created++;
                }
                alert(`Imported ${created} leads.`);
                modal.classList.remove('active');
                loadView(getCurrentView());
            } finally { confirmImpBtn.textContent = 'Confirm Import'; confirmImpBtn.disabled = false; }
        });
    }
}

// ── No Show modal ─────────────────────────────────────────────────────────────
let activeNoShowLeadId = null;

export function openNoShowModal(leadId, leadName) {
    activeNoShowLeadId = leadId;
    document.getElementById('no-show-lead-id').value = leadId;
    document.getElementById('no-show-lead-name').textContent = leadName;
    document.getElementById('no-show-reason').value = '';
    document.getElementById('no-show-char-count').textContent = '0 / 10 min';
    const btn = document.getElementById('submit-no-show-btn');
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
    btn.textContent = 'Confirm No Show';
    document.getElementById('no-show-modal').style.display = 'flex';
}

function _initNoShowModal(loadView, getCurrentView) {
    const modal = document.getElementById('no-show-modal');
    if (!modal) return;

    const reasonEl = document.getElementById('no-show-reason');
    const charCount = document.getElementById('no-show-char-count');
    const submitBtn = document.getElementById('submit-no-show-btn');

    // Character counter + button enable/disable
    if (reasonEl) {
        reasonEl.addEventListener('input', () => {
            const len = reasonEl.value.trim().length;
            charCount.textContent = `${len} / 10 min`;
            if (len >= 10) {
                charCount.style.color = 'var(--status-won)';
                submitBtn.disabled = false;
                submitBtn.style.opacity = '1';
                submitBtn.style.cursor = 'pointer';
            } else {
                charCount.style.color = len > 0 ? '#f59e0b' : 'var(--text-muted)';
                submitBtn.disabled = true;
                submitBtn.style.opacity = '0.5';
                submitBtn.style.cursor = 'not-allowed';
            }
        });
    }

    // Submit handler
    if (submitBtn) {
        submitBtn.addEventListener('click', async () => {
            const reason = reasonEl.value.trim();
            if (!activeNoShowLeadId || reason.length < 10) return;

            submitBtn.textContent = 'Processing...';
            submitBtn.disabled = true;

            try {
                const result = await markNoShow(activeNoShowLeadId, reason);
                submitBtn.textContent = '✅ Done!';
                mp.track('No Show Marked', {
                    lead_id:       activeNoShowLeadId,
                    reason_length: reason.length,
                    role:          currentUser?.role || '',
                });
                showToast(`No-show recorded. Lead moved back to Calling. (Total: ${result.no_show_count})`, 'success', 5000);
                setTimeout(() => {
                    modal.style.display = 'none';
                    activeNoShowLeadId = null;
                    // Reload lead detail view
                    const leadId = document.getElementById('no-show-lead-id').value;
                    loadView('lead-detail', leadId);
                }, 800);
            } catch (err) {
                showToast(err.message || 'Failed to mark no-show', 'error', 5000);
                submitBtn.textContent = 'Confirm No Show';
                submitBtn.disabled = false;
                submitBtn.style.opacity = '1';
                submitBtn.style.cursor = 'pointer';
            }
        });
    }

    // Close handlers
    modal.querySelectorAll('.close-no-show-modal').forEach(el => {
        el.addEventListener('click', () => { modal.style.display = 'none'; activeNoShowLeadId = null; });
    });
    window.addEventListener('click', e => {
        if (e.target === modal) { modal.style.display = 'none'; activeNoShowLeadId = null; }
    });
}

// ── Disqualify Account modal (maker step) ─────────────────────────────────────
export function openDisqualifyModal(company, leadIds) {
    document.getElementById('disqualify-company').value = company;
    document.getElementById('disqualify-lead-ids').value = leadIds.join(',');
    document.getElementById('disqualify-company-name').textContent = company;
    document.getElementById('disqualify-lead-count').textContent = `${leadIds.length} lead${leadIds.length === 1 ? '' : 's'}`;
    document.getElementById('disqualify-reason').value = '';
    document.getElementById('disqualify-char-count').textContent = '0 / 10 min';
    const btn = document.getElementById('submit-disqualify-btn');
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
    btn.textContent = 'Submit Request';
    document.getElementById('disqualify-modal').style.display = 'flex';
}

function _initDisqualifyModal() {
    const modal = document.getElementById('disqualify-modal');
    if (!modal) return;

    const reasonEl = document.getElementById('disqualify-reason');
    const charCount = document.getElementById('disqualify-char-count');
    const submitBtn = document.getElementById('submit-disqualify-btn');

    if (reasonEl) {
        reasonEl.addEventListener('input', () => {
            const len = reasonEl.value.trim().length;
            charCount.textContent = `${len} / 10 min`;
            if (len >= 10) {
                charCount.style.color = 'var(--status-won)';
                submitBtn.disabled = false;
                submitBtn.style.opacity = '1';
                submitBtn.style.cursor = 'pointer';
            } else {
                charCount.style.color = len > 0 ? '#f59e0b' : 'var(--text-muted)';
                submitBtn.disabled = true;
                submitBtn.style.opacity = '0.5';
                submitBtn.style.cursor = 'not-allowed';
            }
        });
    }

    if (submitBtn) {
        submitBtn.addEventListener('click', async () => {
            const reason = reasonEl.value.trim();
            const company = document.getElementById('disqualify-company').value;
            const leadIds = document.getElementById('disqualify-lead-ids').value.split(',').filter(Boolean);
            if (!company || !leadIds.length || reason.length < 10) return;

            submitBtn.textContent = 'Submitting...';
            submitBtn.disabled = true;

            try {
                await createDisqualifyRequest(company, leadIds, reason);
                submitBtn.textContent = '✅ Submitted!';
                showToast('Disqualify request submitted for Pod Admin approval.', 'success', 5000);
                setTimeout(() => { modal.style.display = 'none'; }, 800);
            } catch (err) {
                showToast(err.message || 'Failed to submit request', 'error', 5000);
                submitBtn.textContent = 'Submit Request';
                submitBtn.disabled = false;
                submitBtn.style.opacity = '1';
                submitBtn.style.cursor = 'pointer';
            }
        });
    }

    modal.querySelectorAll('.close-disqualify-modal').forEach(el => {
        el.addEventListener('click', () => { modal.style.display = 'none'; });
    });
    window.addEventListener('click', e => {
        if (e.target === modal) { modal.style.display = 'none'; }
    });
}
