// ── views/lead_emails_tab.js — Email Tab bridge to React EmailHub ─────────────
//
// When the React IIFE bundle (email-hub.js) is loaded, this file delegates
// ALL rendering to window.EmailHub.mount() / navigate(). The vanilla JS code
// below is kept as a fallback only (e.g. for integration tests or if the bundle
// fails to load).
// ──────────────────────────────────────────────────────────────────────────────
import { currentUser } from '../auth.js';
import * as api from '../api.js';
import { showToast, fmtDateTime, fullName, ensureUTC } from '../utils.js';
import { API_BASE } from '../auth.js';

// ── Module state ──────────────────────────────────────────────────────────────
let _threads = [];
let _activeThreadIdx = -1;
let _attachments = [];  // File[] for current compose/reply
let _leadId = '';
let _lead = null;
let _onReload = null;

/** Mount / navigate the React EmailHub bundle if loaded. Returns true if handled. */
function _tryReactEmailHub(leadId, lead, containerEl) {
    const Hub = window.EmailHub;
    if (!Hub) return false;  // bundle not loaded

    const props = {
        leadId,
        lead,
        token: localStorage.getItem('crm_token') || '',
        apiBase: API_BASE || window.__CRM_API_BASE__ || '',
    };

    if (Hub.isMounted) {
        Hub.navigate(containerEl, props);
    } else {
        Hub.mount(containerEl, props);
    }
    return true;
}

/**
 * Load and render the Emails tab for a given lead.
 */
export async function loadEmailsTab(leadId, lead, container, { onReload } = {}) {
    const el = document.getElementById('emails-tab-content');
    if (!el) return;

    // ── Delegate to React bundle when available ───────────────────────────
    if (_tryReactEmailHub(leadId, lead, el)) return;

    // ── Fallback: vanilla JS implementation below ─────────────────────────
    _leadId = leadId;
    _lead = lead;
    _onReload = onReload;
    _attachments = [];
    _threads = [];
    _activeThreadIdx = -1;

    try {
        const emailStatus = await api.getEmailStatus();

        // ── Not configured ────────────────────────────────────────────────
        if (!emailStatus.nylas_configured) {
            el.innerHTML = `<div style="padding:40px 0;text-align:center;color:var(--text-muted);">
                <div style="font-size:2.5rem;margin-bottom:12px;">📧</div>
                <h3 style="font-size:1rem;font-weight:600;color:var(--text-main);margin-bottom:6px;">Email Not Configured</h3>
                <p style="font-size:0.85rem;">Email integration is not configured. Contact your Super Admin.</p>
            </div>`;
            return;
        }

        // ── Not connected ─────────────────────────────────────────────────
        if (!emailStatus.connected) {
            el.innerHTML = `<div style="padding:20px 0;">
                <div style="background:linear-gradient(135deg,#eef2ff,#e0e7ff);border:1px solid #c7d2fe;border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:14px;margin-bottom:16px;">
                    <div style="width:40px;height:40px;background:#fff;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 8px rgba(99,102,241,0.15);">📧</div>
                    <div style="flex:1;">
                        <div style="font-weight:700;font-size:0.85rem;color:#312e81;">Connect Your Email</div>
                        <div style="font-size:0.78rem;color:#4338ca;margin-top:2px;">Connect <b>${currentUser?.email || 'your email'}</b> to send and view emails from RCM</div>
                    </div>
                    <button class="btn btn-primary" id="connect-email-tab-btn" style="padding:8px 18px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#818cf8);border:none;font-size:0.82rem;font-weight:600;cursor:pointer;">🔗 Connect Email</button>
                </div>
                <p style="color:var(--text-muted);font-size:0.85rem;text-align:center;">Connect your email to view and send emails.</p>
            </div>`;
            document.getElementById('connect-email-tab-btn')?.addEventListener('click', async () => {
                const btn = document.getElementById('connect-email-tab-btn');
                btn.textContent = '⏳ Connecting...'; btn.disabled = true;
                try {
                    const authData = await api.getEmailAuthUrl();
                    if (authData?.auth_url) window.open(authData.auth_url, '_blank', 'width=600,height=700');
                    else showToast('Failed to get auth URL', 'error');
                } catch (e) { showToast('Error connecting email: ' + (e.message || e), 'error'); }
                btn.textContent = '🔗 Connect Email'; btn.disabled = false;
            });
            return;
        }

        // ── Connected — render split-pane ──────────────────────────────────
        const emailData = await api.getLeadEmails(leadId);
        const emails = emailData.emails || [];

        // Update tab badge
        const badge = document.querySelector('[data-tab="emails"] .tab-badge');
        if (badge && emails.length > 0) { badge.textContent = emails.length; badge.style.display = 'inline-flex'; }

        // Group into threads
        _threads = _groupIntoThreads(emails);

        // Render split-pane layout
        el.innerHTML = _renderSplitPane(emailStatus, emails);

        // Bind sidebar events
        _bindSidebarEvents(el, emailStatus);

        // Select first thread (or show empty state)
        if (_threads.length > 0) {
            _selectThread(0);
        }

    } catch (e) {
        console.error('Email tab load error:', e);
        el.innerHTML = `<div style="padding:40px 0;text-align:center;color:var(--text-muted);">
            <div style="font-size:2.5rem;margin-bottom:12px;">⚠️</div>
            <h3 style="font-size:1rem;font-weight:600;color:var(--text-main);margin-bottom:6px;">Unable to load emails</h3>
            <p style="font-size:0.85rem;">Please try refreshing the page.</p>
        </div>`;
    }
}

// ── Thread grouping ───────────────────────────────────────────────────────────
function _groupIntoThreads(emails) {
    const baseSubject = (s) => (s || '(no subject)').replace(/^(?:Re|Fwd|Fw):\s*/gi, '').trim();
    const threads = [];
    const threadMap = {};
    for (const e of emails) {
        const key = baseSubject(e.subject);
        if (!threadMap[key]) {
            threadMap[key] = { subject: key, messages: [], threadId: null, latestMessageId: null };
            threads.push(threadMap[key]);
        }
        threadMap[key].messages.push(e);
        // Track thread_id and latest message_id for replies
        if (e.nylas_thread_id) threadMap[key].threadId = e.nylas_thread_id;
        if (e.nylas_message_id) threadMap[key].latestMessageId = e.nylas_message_id;
    }
    // Sort threads: most recent first
    threads.sort((a, b) => {
        const aTime = a.messages[a.messages.length - 1]?.timestamp || '';
        const bTime = b.messages[b.messages.length - 1]?.timestamp || '';
        return bTime.localeCompare(aTime);
    });
    return threads;
}

// ── Split-pane layout ─────────────────────────────────────────────────────────
function _renderSplitPane(emailStatus, emails) {
    return `
    <div class="email-split-pane">
        <!-- ── Left Sidebar ──────────────────────────────────────── -->
        <div class="email-sidebar">
            <div class="email-sidebar-status">
                <span class="email-status-dot"></span>
                <span class="email-status-email">${emailStatus.email}</span>
            </div>

            <div style="display:flex;gap:8px;">
                <button class="email-compose-btn" id="email-compose-btn" style="flex:1;">
                    ✏️ Compose Email
                </button>
                <button class="email-compose-btn" id="email-refresh-btn" style="flex:0 0 auto;padding:8px 12px;" title="Refresh emails">
                    🔄
                </button>
            </div>

            <div class="email-search-wrap">
                <input type="text" id="email-search" class="email-search-input" placeholder="Search emails...">
            </div>

            <div class="email-thread-list" id="email-thread-list">
                ${_threads.length === 0 ? '<div class="email-empty-sidebar">No emails yet</div>' :
                  _threads.map((t, i) => _renderThreadItem(t, i)).join('')}
            </div>
        </div>

        <!-- ── Main Area ─────────────────────────────────────────── -->
        <div class="email-main" id="email-main">
            ${_threads.length === 0 ? _renderEmptyMain() : ''}
        </div>
    </div>`;
}

function _renderThreadItem(thread, index) {
    const latest = thread.messages[thread.messages.length - 1];
    const contactName = latest.direction === 'inbound'
        ? (latest.from_email || fullName(_lead))
        : (fullName(_lead) || latest.to_email || 'Contact');
    const timeStr = _timeAgo(latest.timestamp);

    return `
    <div class="email-thread-item${index === _activeThreadIdx ? ' active' : ''}" data-thread-idx="${index}">
        <div class="email-thread-contact">${_escHtml(contactName)}</div>
        <div class="email-thread-subject">${_escHtml(thread.subject)}</div>
        <div class="email-thread-preview">${_escHtml(_stripQuotedText(latest.body_preview || '').clean)}</div>
        <div class="email-thread-time">${timeStr}</div>
    </div>`;
}

function _renderEmptyMain() {
    return `<div class="email-empty-main">
        <div style="font-size:3rem;margin-bottom:12px;opacity:0.5;">✉️</div>
        <p style="font-size:0.9rem;font-weight:500;">No emails yet</p>
        <p style="font-size:0.82rem;color:var(--text-muted);">Click "Compose Email" to start a conversation with this lead.</p>
    </div>`;
}

// ── Thread view (main area) ───────────────────────────────────────────────────
function _renderThreadView(thread) {
    const contactEmail = _lead?.email || '';
    const contactName = fullName(_lead) || contactEmail;

    return `
    <div class="email-thread-header">
        <div>
            <div class="email-thread-title">${_escHtml('Re: ' + thread.subject)}</div>
            <div class="email-thread-meta">Thread with ${_escHtml(contactName)} · ${_escHtml(contactEmail)}</div>
        </div>
        <button class="btn btn-outline email-reply-toggle-btn" id="email-reply-toggle">↩ Reply</button>
    </div>

    <div class="email-messages" id="email-messages">
        ${thread.messages.map(m => _renderMessageBubble(m)).join('')}
    </div>

    <div class="email-reply-composer" id="email-reply-composer">
        <div style="display:flex;gap:8px;margin-bottom:6px;">
            <input type="text" class="email-compose-subject" id="email-reply-cc" placeholder="Cc (optional)" style="flex:1;font-size:0.82rem;">
            <input type="text" class="email-compose-subject" id="email-reply-bcc" placeholder="Bcc (optional)" style="flex:1;font-size:0.82rem;">
        </div>
        <div class="email-rte-toolbar">
            <button type="button" class="email-rte-btn" id="email-reply-bold" title="Bold"><b>B</b></button>
            <button type="button" class="email-rte-btn" id="email-reply-italic" title="Italic"><i>I</i></button>
            <button type="button" class="email-rte-btn" id="email-reply-link" title="Insert link">🔗</button>
            <button type="button" class="email-rte-btn" id="email-reply-image" title="Insert image">🖼️</button>
        </div>
        <div class="email-reply-textarea" id="email-reply-input" contenteditable="true" data-placeholder="Type your reply here..." style="min-height:70px;"></div>
        <div class="email-attachment-list" id="email-attachment-list"></div>
        <div class="email-reply-actions">
            <div class="email-reply-left-actions">
                <div class="email-attach-btn" id="email-attach-label" role="button" tabindex="0">
                    📎 Attach
                    <input type="file" id="email-attach-input" multiple style="display:none;">
                </div>
            </div>
            <button class="btn btn-primary email-send-btn" id="email-send-reply-btn">✈️ Send Reply</button>
        </div>
    </div>`;
}

function _renderMessageBubble(msg) {
    const isOutbound = msg.direction === 'outbound';
    const sender = isOutbound ? (msg.user_name || 'You') : (msg.from_email || fullName(_lead));
    const timeStr = fmtDateTime(msg.timestamp);

    const { clean, quoted } = _stripQuotedText(msg.body_preview || '');
    const quotedHtml = quoted
        ? `<div class="email-quoted-toggle" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.textContent=this.textContent==='···'?'Hide quoted text':'···'">···</div>
           <div class="email-quoted-text" style="display:none;">${_escHtml(quoted)}</div>`
        : '';

    // Tracking badge — only for outbound emails
    let trackingHtml = '';
    if (isOutbound) {
        if (msg.opened_at) {
            const openCount = msg.open_count || 1;
            const openTime = _timeAgo(msg.opened_at);
            trackingHtml = `<div class="email-tracking-badge opened">
                <span class="tracking-icon-eye"></span>
                Opened · ${openCount}x · ${openTime}
            </div>`;
        } else {
            trackingHtml = `<div class="email-tracking-badge sent">✓ Sent</div>`;
        }
    }

    // Attachment chips for received attachments
    let attachmentHtml = '';
    if (msg.attachments && msg.attachments.length > 0) {
        const nylasMessageId = msg.nylas_message_id || '';
        attachmentHtml = `<div class="email-attachment-list email-received-attachments">
            ${msg.attachments.map(att => {
                const icon = _getFileIcon(att.content_type || att.filename || '');
                return `<div class="email-attachment-chip email-attachment-download" 
                             data-att-id="${_escHtml(att.id)}" 
                             data-msg-id="${_escHtml(nylasMessageId)}"
                             data-filename="${_escHtml(att.filename)}" 
                             title="Click to download">
                    <span class="email-attachment-icon">${icon}</span>
                    <span class="email-attachment-name">${_escHtml(att.filename)}</span>
                    <span class="email-attachment-size">${_formatSize(att.size || 0)}</span>
                    <span class="email-attachment-dl-icon">⬇</span>
                </div>`;
            }).join('')}
        </div>`;
    }

    return `
    <div class="email-bubble-wrap ${isOutbound ? 'outbound' : 'inbound'}">
        <div class="email-bubble-meta">${_escHtml(sender)} · ${timeStr}</div>
        <div class="email-bubble ${isOutbound ? 'outbound' : 'inbound'}">
            <div>${_escHtml(clean)}</div>
            ${quotedHtml}
        </div>
        ${attachmentHtml}
        ${trackingHtml}
    </div>`;
}

// ── Compose new email (modal-like overlay in main area) ───────────────────────
function _renderComposeView() {
    const contactEmail = _lead?.email || '';
    return `
    <div class="email-thread-header">
        <div>
            <div class="email-thread-title">New Email</div>
            <div class="email-thread-meta">To: ${_escHtml(fullName(_lead))} · ${_escHtml(contactEmail)}</div>
        </div>
    </div>

    <div class="email-compose-form" id="email-compose-form">
        <div class="email-compose-field">
            <label class="email-compose-label">Subject</label>
            <input type="text" class="email-compose-subject" id="email-compose-subject" placeholder="Enter subject...">
        </div>
        <div class="email-compose-field" style="display:flex;gap:12px;">
            <div style="flex:1;">
                <label class="email-compose-label">Cc <span style="font-weight:400;color:var(--text-muted);">(optional)</span></label>
                <input type="text" class="email-compose-subject" id="email-compose-cc" placeholder="name@company.com, another@company.com">
            </div>
            <div style="flex:1;">
                <label class="email-compose-label">Bcc <span style="font-weight:400;color:var(--text-muted);">(optional)</span></label>
                <input type="text" class="email-compose-subject" id="email-compose-bcc" placeholder="name@company.com">
            </div>
        </div>
        <div class="email-compose-field">
            <label class="email-compose-label">Message</label>
            <div class="email-rte-toolbar">
                <button type="button" class="email-rte-btn" id="email-compose-bold" title="Bold"><b>B</b></button>
                <button type="button" class="email-rte-btn" id="email-compose-italic" title="Italic"><i>I</i></button>
                <button type="button" class="email-rte-btn" id="email-compose-link" title="Insert link">🔗</button>
                <button type="button" class="email-rte-btn" id="email-compose-image" title="Insert image">🖼️</button>
            </div>
            <div class="email-reply-textarea" id="email-compose-body" contenteditable="true" data-placeholder="Write your email..."></div>
        </div>
        <div class="email-attachment-list" id="email-compose-attachments"></div>
        <div class="email-reply-actions">
            <div class="email-reply-left-actions">
                <div class="email-attach-btn" id="email-compose-attach-label" role="button" tabindex="0">
                    📎 Attach
                    <input type="file" id="email-compose-attach-input" multiple style="display:none;">
                </div>
            </div>
            <div style="display:flex;gap:8px;">
                <button class="btn btn-outline" id="email-compose-cancel">Cancel</button>
                <button class="btn btn-primary email-send-btn" id="email-compose-send">✈️ Send Email</button>
            </div>
        </div>
    </div>`;
}

// ── Attachment rendering ──────────────────────────────────────────────────────
function _renderAttachments(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (_attachments.length === 0) { el.innerHTML = ''; return; }
    el.innerHTML = _attachments.map((f, i) => `
        <div class="email-attachment-chip">
            <span class="email-attachment-icon">📄</span>
            <span class="email-attachment-name">${_escHtml(f.name)}</span>
            <span class="email-attachment-size">${_formatSize(f.size)}</span>
            <button class="email-attachment-remove" data-idx="${i}">×</button>
        </div>
    `).join('');
    el.querySelectorAll('.email-attachment-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            _attachments.splice(parseInt(btn.dataset.idx), 1);
            _renderAttachments(containerId);
        });
    });
}

// ── Event binding ─────────────────────────────────────────────────────────────
function _bindSidebarEvents(root, emailStatus) {
    // Thread item clicks
    root.querySelectorAll('.email-thread-item').forEach(item => {
        item.addEventListener('click', () => _selectThread(parseInt(item.dataset.threadIdx)));
    });

    // Compose button
    document.getElementById('email-compose-btn')?.addEventListener('click', _showCompose);

    // Refresh button
    document.getElementById('email-refresh-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('email-refresh-btn');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.innerHTML = '⏳'; }
        try {
            await loadEmailsTab(_leadId, _lead, root, { onReload: _onReload });
            showToast('Emails refreshed', 'success');
        } catch (e) {
            showToast('Failed to refresh emails', 'error');
        }
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = '🔄'; }
    });

    // Search
    document.getElementById('email-search')?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('.email-thread-item').forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = text.includes(q) ? '' : 'none';
        });
    });
}

function _selectThread(idx) {
    _activeThreadIdx = idx;
    _attachments = [];

    // Update sidebar active state
    document.querySelectorAll('.email-thread-item').forEach((item, i) => {
        item.classList.toggle('active', i === idx);
    });

    // Render thread view in main area
    const main = document.getElementById('email-main');
    if (!main || !_threads[idx]) return;
    main.innerHTML = _renderThreadView(_threads[idx]);

    // Scroll to bottom of messages
    const msgs = document.getElementById('email-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;

    // Bind reply events
    _bindReplyEvents(_threads[idx]);

    // Bind attachment download events
    main.querySelectorAll('.email-attachment-download').forEach(chip => {
        chip.addEventListener('click', async () => {
            const attId = chip.dataset.attId;
            const msgId = chip.dataset.msgId;
            const filename = chip.dataset.filename;
            if (!attId || !msgId) { showToast('Missing attachment info', 'error'); return; }
            chip.style.opacity = '0.5';
            try {
                await api.downloadEmailAttachment(attId, msgId, filename);
            } catch (e) {
                showToast('Download failed: ' + e.message, 'error');
            }
            chip.style.opacity = '1';
        });
    });
}

function _bindReplyEvents(thread) {
    // Reply toggle scrolls to composer
    document.getElementById('email-reply-toggle')?.addEventListener('click', () => {
        document.getElementById('email-reply-input')?.focus();
    });

    // Attach file — click div to trigger hidden file input
    document.getElementById('email-attach-label')?.addEventListener('click', () => {
        document.getElementById('email-attach-input')?.click();
    });
    document.getElementById('email-attach-input')?.addEventListener('change', (e) => {
        for (const f of e.target.files) _attachments.push(f);
        _renderAttachments('email-attachment-list');
        e.target.value = '';
    });

    // Send reply
    document.getElementById('email-send-reply-btn')?.addEventListener('click', async () => {
        const bodyEl = document.getElementById('email-reply-input');
        const body = bodyEl ? bodyEl.innerHTML.trim() : '';
        const bodyPlain = bodyEl ? bodyEl.textContent.trim() : '';
        const cc = document.getElementById('email-reply-cc')?.value?.trim();
        const bcc = document.getElementById('email-reply-bcc')?.value?.trim();
        if (!body) { showToast('Please type a reply', 'error'); return; }

        const btn = document.getElementById('email-send-reply-btn');
        btn.disabled = true; btn.textContent = '⏳ Sending...';

        try {
            const result = await api.sendEmail(_leadId, 'Re: ' + thread.subject, body, {
                replyToMessageId: thread.latestMessageId || '',
                threadId: thread.threadId || '',
                attachments: _attachments.length > 0 ? _attachments : undefined,
                cc, bcc,
            });
            if (result.ok) {
                showToast('Reply sent!', 'success');
                _attachments = [];
                await loadEmailsTab(_leadId, _lead, null, { onReload: _onReload });
            } else {
                showToast(result.data?.detail || 'Failed to send reply', 'error');
            }
        } catch (e) {
            showToast('Error: ' + (e.message || e), 'error');
        }
        btn.disabled = false; btn.textContent = '✈️ Send Reply';
    });
}

function _showCompose() {
    _attachments = [];
    _activeThreadIdx = -1;
    document.querySelectorAll('.email-thread-item').forEach(i => i.classList.remove('active'));

    const main = document.getElementById('email-main');
    if (!main) return;
    main.innerHTML = _renderComposeView();

    // Attach file — click div to trigger hidden file input
    document.getElementById('email-compose-attach-label')?.addEventListener('click', () => {
        document.getElementById('email-compose-attach-input')?.click();
    });
    document.getElementById('email-compose-attach-input')?.addEventListener('change', (e) => {
        for (const f of e.target.files) _attachments.push(f);
        _renderAttachments('email-compose-attachments');
        e.target.value = '';
    });

    // Cancel
    document.getElementById('email-compose-cancel')?.addEventListener('click', () => {
        if (_threads.length > 0) _selectThread(0);
        else { main.innerHTML = _renderEmptyMain(); }
    });

    // Send
    document.getElementById('email-compose-send')?.addEventListener('click', async () => {
        const subject = document.getElementById('email-compose-subject')?.value?.trim();
        const bodyEl = document.getElementById('email-compose-body');
        const body = bodyEl ? bodyEl.innerHTML.trim() : '';
        const bodyPlain = bodyEl ? bodyEl.textContent.trim() : '';
        const cc = document.getElementById('email-compose-cc')?.value?.trim();
        const bcc = document.getElementById('email-compose-bcc')?.value?.trim();
        if (!subject) { showToast('Subject is required', 'error'); return; }
        if (!body) { showToast('Message body is required', 'error'); return; }

        const btn = document.getElementById('email-compose-send');
        btn.disabled = true; btn.textContent = '⏳ Sending...';

        try {
            const result = await api.sendEmail(_leadId, subject, body, {
                attachments: _attachments.length > 0 ? _attachments : undefined,
                cc, bcc,
            });
            if (result.ok) {
                showToast('Email sent!', 'success');
                _attachments = [];
                await loadEmailsTab(_leadId, _lead, null, { onReload: _onReload });
            } else {
                showToast(result.data?.detail || 'Failed to send email', 'error');
            }
        } catch (e) {
            showToast('Error: ' + (e.message || e), 'error');
        }
        btn.disabled = false; btn.textContent = '✈️ Send Email';
    });

    document.getElementById('email-compose-subject')?.focus();
}

// ── Quoted text stripping ─────────────────────────────────────────────────────
function _stripQuotedText(text) {
    if (!text) return { clean: '', quoted: '' };

    // Common patterns that start the quoted section:
    // 1. "On <Day>, <Month> <Date>, <Year> at <Time> <Name> wrote:"
    // 2. "On <Date> <Name> <email> wrote:"
    // 3. "---------- Forwarded message ----------"
    // 4. Lines starting with ">"
    const patterns = [
        /\s*On\s+(?:\w{3},\s+)?\w{3}\s+\d+,?\s+\d{4}\s+at\s+\d{1,2}:\d{2}[^]*?wrote:[^]*$/i,  // "On Wed, Mar 25, 2026 at 3:03 PM Name wrote:"
        /\s*On\s+\w{3},\s+\w{3}\s+\d+[^]*$/i,                               // "On Wed, Mar 25 ..."
        /\s*On\s+\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}[^]*$/i,                     // "On 03/25/2026 ..."
        /\s*On\s+\w+\s+\d{1,2},?\s+\d{4}\s+at\s+\d{1,2}:\d{2}[^]*$/i,       // "On March 25, 2026 at 3:03 ..."
        /\s*-{3,}\s*Forwarded message\s*-{3,}[^]*$/i,                         // Forwarded message
        /\s*-{3,}\s*Original Message\s*-{3,}[^]*$/i,                          // Original message
        /\s*From:\s*.+\s*Sent:\s*[^]*$/i,                                      // Outlook-style: "From: ... Sent: ..."
    ];

    let clean = text;
    let quoted = '';

    for (const pattern of patterns) {
        const match = clean.match(pattern);
        if (match) {
            quoted = match[0].trim();
            clean = clean.slice(0, match.index).trim();
            break;
        }
    }

    // Also strip ">" prefixed lines if they appear at the end
    if (!quoted) {
        const lines = clean.split('\n');
        const cleanLines = [];
        const quotedLines = [];
        let inQuoted = false;
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].trim().startsWith('>') || inQuoted) {
                quotedLines.unshift(lines[i]);
                inQuoted = true;
            } else {
                cleanLines.unshift(lines[i]);
                inQuoted = false;
            }
        }
        if (quotedLines.length > 0) {
            clean = cleanLines.join('\n').trim();
            quoted = quotedLines.join('\n').trim();
        }
    }

    // If clean is empty after stripping, put everything back
    if (!clean && quoted) {
        clean = quoted;
        quoted = '';
    }

    return { clean, quoted };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

function _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function _timeAgo(dateStr) {
    if (!dateStr) return '';
    const d = new Date(ensureUTC(dateStr));
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function _getFileIcon(contentTypeOrFilename) {
    const ct = (contentTypeOrFilename || '').toLowerCase();
    if (ct.includes('pdf')) return '📕';
    if (ct.includes('image') || ct.match(/\.(png|jpg|jpeg|gif|webp|svg)$/)) return '🖼️';
    if (ct.includes('spreadsheet') || ct.includes('excel') || ct.match(/\.(xlsx?|csv)$/)) return '📊';
    if (ct.includes('document') || ct.includes('word') || ct.match(/\.(docx?|rtf)$/)) return '📝';
    if (ct.includes('presentation') || ct.includes('powerpoint') || ct.match(/\.(pptx?)$/)) return '📑';
    if (ct.includes('zip') || ct.includes('archive') || ct.match(/\.(zip|rar|7z|tar|gz)$/)) return '📦';
    if (ct.includes('video') || ct.match(/\.(mp4|mov|avi|mkv)$/)) return '🎬';
    if (ct.includes('audio') || ct.match(/\.(mp3|wav|ogg|m4a)$/)) return '🎵';
    if (ct.includes('text') || ct.match(/\.(txt|log|md)$/)) return '📄';
    return '📎';
}
