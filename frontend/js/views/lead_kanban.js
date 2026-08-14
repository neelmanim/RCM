// ── views/lead_kanban.js — Kanban board + drag and drop (v6.0.0 grouped) ─────
import { isAdmin } from '../auth.js';
import * as api from '../api.js';
import { statusBadgeClass, showToast, fullName } from '../utils.js';

// ── Pipeline groups ────────────────────────────────────────────────────────────
const KANBAN_GROUPS = [
    {
        label: '🔍 Prospecting',
        color: '#6366f1',
        statuses: ['Lead Assigned', 'Research', 'Calling']
    },
    {
        label: '🎯 Qualification',
        color: '#059669',
        statuses: ['Meeting Scheduled', '1st Discovery Meeting', 'Discovery Complete', 'Demo Scheduled', 'Demo Done']
    },
    {
        label: '✅ Terminal',
        color: '#64748b',
        statuses: ['Completed', 'Disqualified']
    }
];

const COL_COLORS = {
    'Lead Assigned':          'var(--status-new)',
    'Research':               'var(--status-working)',
    'Calling':                'var(--status-qualified)',
    'Meeting Scheduled':      '#22c55e',
    '1st Discovery Meeting':  '#10b981',
    'Discovery Complete':     '#059669',
    'Demo Scheduled':         '#6366f1',
    'Demo Done':              '#3b82f6',
    'Completed':              '#16a34a',
    'Disqualified':           '#ef4444'
};

// Short labels for compact Kanban columns
const SHORT_LABELS = {
    'Lead Assigned':          'Assigned',
    'Research':               'Research',
    'Calling':                'Calling',
    'Meeting Scheduled':      'Meeting',
    '1st Discovery Meeting':  '1st Discovery',
    'Discovery Complete':     'Disc. Done',
    'Demo Scheduled':         'Demo Sched.',
    'Demo Done':              'Demo Done',
    'Completed':              'Completed',
    'Disqualified':           'Disqualified'
};

export function renderKanban(container, leads, loadView, openCallModal) {
    const groupsHTML = KANBAN_GROUPS.map(group => {
        const colsHTML = group.statuses.map(status => {
            const colLeads = leads.filter(l => l.status === status);
            const cards = colLeads.map(lead => {
                // Discovery counter badge
                const discoveryBadge = (status === '1st Discovery Meeting' || status === 'Discovery Complete')
                    && lead.discovery_meeting_count
                    ? `<span style="font-size:0.65rem;padding:1px 5px;border-radius:4px;background:#d1fae5;color:#065f46;font-weight:700;" title="${lead.discovery_meeting_count} discovery meeting(s)">🔬 ${lead.discovery_meeting_count}</span>`
                    : '';
                // Demo failure indicator
                const demoFailBadge = lead.demo_failed_count
                    ? `<span style="font-size:0.65rem;padding:1px 5px;border-radius:4px;background:#fee2e2;color:#991b1b;font-weight:700;" title="${lead.demo_failed_count} demo failure(s)">⚠️ ${lead.demo_failed_count}</span>`
                    : '';
                return `
                <div class="k-card" draggable="true" data-id="${lead.id}">
                    <h4>${fullName(lead)}</h4>
                    <p>${lead.company || lead.email || '—'}</p>
                    ${lead.phone ? `<p style="font-size:0.78rem;color:var(--text-muted);">${lead.phone}</p>` : ''}
                    <div class="k-card-footer">
                        <span class="badge ${statusBadgeClass(status)}">${SHORT_LABELS[status] || status}</span>
                        ${discoveryBadge}${demoFailBadge}
                        ${!isAdmin ? (status === 'Calling' ? `<button class="btn btn-primary quick-call-btn-kanban" style="padding:4px 10px;font-size:0.72rem;display:inline-flex;align-items:center;" onclick="event.stopPropagation();window._openCallModal('${lead.id}','${fullName(lead)}','${lead.phone || ''}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg></button>` : '') : ''}
                    </div>
                </div>`;
            }).join('');
            return `
                <div class="kanban-col" data-status="${status}">
                    <div class="kanban-col-header" style="border-bottom-color:${COL_COLORS[status] || '#6366f1'};">
                        <span>${SHORT_LABELS[status] || status}</span><span class="kanban-col-count">${colLeads.length}</span>
                    </div>
                    <div class="kanban-cards">${cards}</div>
                </div>`;
        }).join('');

        return `
            <div class="kanban-group">
                <div class="kanban-group-header" style="border-left-color:${group.color};">
                    <span class="kanban-group-label">${group.label}</span>
                    <span class="kanban-group-count">${group.statuses.reduce((n, s) => n + leads.filter(l => l.status === s).length, 0)} leads</span>
                </div>
                <div class="kanban-group-columns">${colsHTML}</div>
            </div>`;
    }).join('');

    container.innerHTML = `
        <div class="fade-in">
            <div class="page-header"><div>
                <h1 class="page-title">Pipeline</h1>
                <p class="page-subtitle">${isAdmin ? 'All leads by pipeline stage.' : 'Your leads — drag to update status.'}</p>
            </div></div>
            <div class="kanban-board-grouped">${groupsHTML}</div>
        </div>`;

    _bindDragAndDrop(container, leads);
}

function _bindDragAndDrop(container, leads) {
    let draggedCard = null;
    let draggedId = null;
    let originCol = null;
    let originNextSib = null;

    function restoreCard(card) {
        if (card && originCol) {
            if (originNextSib && originCol.contains(originNextSib)) {
                originCol.insertBefore(card, originNextSib);
            } else {
                originCol.appendChild(card);
            }
        }
        _updateCounts(container);
    }

    container.querySelectorAll('.k-card').forEach(card => {
        card.addEventListener('dragstart', function() {
            draggedCard = this;
            draggedId = this.getAttribute('data-id');
            originCol = this.parentElement;
            originNextSib = this.nextElementSibling;
            setTimeout(() => this.style.opacity = '0.4', 0);
        });
        card.addEventListener('dragend', function() {
            this.style.opacity = '1';
            setTimeout(() => { draggedCard = null; draggedId = null; }, 50);
        });
    });

    container.querySelectorAll('.kanban-cards').forEach(col => {
        col.addEventListener('dragover', e => {
            e.preventDefault();
            if (!draggedCard) return;
            const after = _getDragAfterElement(col, e.clientY);
            if (after == null) col.appendChild(draggedCard); else col.insertBefore(draggedCard, after);
        });
        col.addEventListener('drop', async (e) => {
            e.preventDefault();
            const card = draggedCard;
            const leadId = draggedId || card?.getAttribute('data-id');
            if (!leadId) return;
            const newStatus = col.closest('.kanban-col')?.getAttribute('data-status');
            if (!newStatus) return;
            try {
                const res = await api.updateLeadStatus(leadId, newStatus);
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    const toastType = res.status === 422 ? 'warning' : 'error';
                    showToast(err.detail || 'Failed to move lead.', toastType);
                    restoreCard(card);
                    return;
                }
                if (card) {
                    const badge = card.querySelector('.badge');
                    if (badge) {
                        badge.textContent = SHORT_LABELS[newStatus] || newStatus;
                        badge.className = `badge ${statusBadgeClass(newStatus)}`;
                    }
                }
                _updateCounts(container);
            } catch (err) {
                showToast('Failed to move lead: ' + (err.message || err));
                restoreCard(card);
            }
        });
    });
}

function _updateCounts(container) {
    container.querySelectorAll('.kanban-col').forEach(kCol => {
        const countEl = kCol.querySelector('.kanban-col-count');
        if (countEl) countEl.textContent = kCol.querySelectorAll('.k-card').length;
    });
    // Update group counts
    container.querySelectorAll('.kanban-group').forEach(group => {
        const total = group.querySelectorAll('.k-card').length;
        const gc = group.querySelector('.kanban-group-count');
        if (gc) gc.textContent = `${total} leads`;
    });
}

function _getDragAfterElement(container, y) {
    return [...container.querySelectorAll('.k-card:not(.dragging)')].reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}
