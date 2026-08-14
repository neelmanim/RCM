import React, { useEffect, useRef, useState } from 'react';
import { Phone, SkipForward, ChevronDown, ExternalLink, NotebookPen } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { DialerService, LeadsService } from '../../../services/api';
import { resolveLeadPhone } from '../../leads-hub/columns';
import { displayName } from '../../leads-hub/components/LeadRow';
import { LocalTimeBadge } from './LocalTimeBadge';

// Optional — a plain click on Skip stays a single, reason-less action (must
// never gain friction, see usePowerDialerQueue's skip() docblock). This is
// an adjacent, purely additive way to annotate why, for reps who bother.
const SKIP_REASONS = ['Wrong number', 'Bad timing', 'Call back later', 'Not interested', 'Other'];

// Mirrors app.js's own isDialerActive check (handleCallAction) — if that's
// false, clicking Call skips straight to the outcome modal with no dial
// attempt at all (see app.js's fallback `openCallModal(...)` at the bottom
// of handleCallAction). Telling the rep which of the two they're about to
// get avoids the "why didn't my phone ring" confusion.
function callButtonLabel(dialerStatus) {
  if (!dialerStatus?.active || dialerStatus.provider === 'none') return 'Call — log manually';
  if (dialerStatus.provider === 'aircall') return 'Call via Aircall';
  if (dialerStatus.provider === 'rcm') return 'Call via RCM';
  return 'Call';
}

function initials(name) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || '?';
}

// city/state/country are three independently-nullable columns — show
// whichever subset exists instead of requiring all three.
function formatLocation(lead) {
  const parts = [lead.city, lead.state, lead.country].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

// research_company_size is already a bucketed label (e.g. "500-1000") when
// research has filled it in — prefer that over the raw headcount column.
function formatEmployees(lead) {
  if (lead.research_company_size) return lead.research_company_size;
  if (lead.employee_count) return `${lead.employee_count} employees`;
  return null;
}

// lead_source is a raw enum-ish string ("salesforce", "uploaded",
// "upload:file.csv:169...", "gsheet:url...") — never fit for display as-is.
function formatSource(source) {
  if (!source) return null;
  if (source === 'salesforce') return 'Salesforce';
  if (source === 'uploaded' || source.startsWith('upload:')) return 'Uploaded';
  if (source.startsWith('gsheet:')) return 'Google Sheet';
  return source;
}

/**
 * The lead currently up in the queue. Two buttons, never both active at
 * once: "Call" (dial this lead — always a deliberate, explicit click) while
 * waiting, then "Call Next" (advance the queue pointer only, never dials
 * automatically) once the outcome for THIS lead is resolved. "Skip" is
 * always available, independent of call state — the escape hatch for a
 * call that never connected.
 *
 * No call-duration timer here — RCM's floating widget and Aircall's
 * own UI already show one; a second, client-side one here (removed
 * 2026-08-10) just drifted out of sync with the real call.
 */
export function CurrentCallCard({ lead, callNextEnabled, onCallNext, onSkip, onLeadClick }) {
  const name = lead ? displayName(lead) : '';
  const phone = lead ? resolveLeadPhone(lead) : '';
  const dockRef = useRef(null);
  const noteInputRef = useRef(null);
  const [dialerStatus, setDialerStatus] = useState(null);
  const [showNote, setShowNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState(null);

  // Same source app.js reads at call time (/api/dialer/status) — fetched
  // once here purely to label the button; the actual routing decision at
  // call time still lives entirely in handleCallAction, unchanged.
  useEffect(() => {
    DialerService.getStatus().then(setDialerStatus).catch(() => setDialerStatus({ active: false, provider: 'none' }));
  }, []);

  // The note composer is per-lead state — must not carry unsaved text (or
  // stay open) onto the next lead once the queue advances.
  useEffect(() => {
    setShowNote(false);
    setNoteText('');
    setNoteError(null);
  }, [lead?.id]);

  useEffect(() => {
    if (showNote) noteInputRef.current?.focus();
  }, [showNote]);

  const handleCall = () => {
    if (!phone) return;
    window._openCallModal?.(lead.id, name, phone, lead);
  };

  const handleSaveNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    setNoteError(null);
    try {
      await LeadsService.addNote(lead.id, noteText.trim());
      setShowNote(false);
      setNoteText('');
    } catch {
      setNoteError('Failed to save note — try again.');
    } finally {
      setSavingNote(false);
    }
  };

  // Dock the app's one shared #call-log-modal node inline in this card
  // instead of leaving it as a floating overlay — a power dialer shouldn't
  // pop a call away from the queue it's driving. This moves the existing
  // DOM node, not a copy: same vanilla-JS call/outcome logic everywhere
  // (see modals.js), just repositioned while this card is on screen. The
  // node is handed back to its original spot on unmount, so it reverts to
  // a normal overlay anywhere else in the app (Leads Hub, Lead Detail, …).
  useEffect(() => {
    const modal = document.getElementById('call-log-modal');
    const dock = dockRef.current;
    if (!modal || !dock) return;
    const originalParent = modal.parentNode;
    const originalNextSibling = modal.nextSibling;
    dock.appendChild(modal);
    modal.classList.add('power-dialer-docked');
    return () => {
      modal.classList.remove('power-dialer-docked');
      if (originalNextSibling) originalParent.insertBefore(modal, originalNextSibling);
      else originalParent.appendChild(modal);
    };
  }, []);

  // C = Call / Call Next, S = Skip, N = add a note, O = open in CRM — the
  // actions a rep repeats hundreds of times a day; every dedicated power
  // dialer keeps these off the mouse. Ignored while typing into a field
  // (the skip-reason select and the note textarea are both real form
  // elements, so this guard already covers them).
  useEffect(() => {
    if (!lead) return;
    function handleKey(e) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        callNextEnabled ? onCallNext() : handleCall();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        onSkip();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setShowNote(true);
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        onLeadClick?.(lead.id);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lead, callNextEnabled, onCallNext, onSkip, onLeadClick, phone, name]);

  if (!lead) return null;

  // Company is already shown in the title line above — no need to repeat
  // it here; location/employees/source are additive-only (omitted from the
  // strip entirely when absent, not shown as an empty "—").
  const contextItems = [formatLocation(lead), formatEmployees(lead), formatSource(lead.lead_source)].filter(Boolean);

  return (
    <Card className="p-6 flex flex-col gap-5" data-tour="current-call">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-lg font-bold flex-shrink-0">
          {initials(name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold text-slate-800 truncate">{name}</div>
          <div className="text-xs text-slate-500 truncate" title={[lead.title, lead.company].filter(Boolean).join(' at ') || undefined}>
            {[lead.title, lead.company].filter(Boolean).join(' at ') || '—'}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            {onLeadClick && (
              <Button variant="outline" size="sm" onClick={() => onLeadClick(lead.id)}>
                <ExternalLink size={14} /> View in CRM
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setShowNote(v => !v)} data-tour="add-note">
              <NotebookPen size={14} /> Add Note
            </Button>
          </div>
          <Badge variant={lead.status ? undefined : 'default'}>{lead.status}</Badge>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-slate-600">
        <Phone size={15} className="text-slate-400" />
        {phone || <span className="text-slate-400 italic">No phone number on file</span>}
        {phone && <LocalTimeBadge phone={phone} />}
      </div>

      {contextItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          {contextItems.map((item, i) => (
            <React.Fragment key={item}>
              {i > 0 && <span className="text-slate-300">•</span>}
              <span>{item}</span>
            </React.Fragment>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
        <span>Last contact: {lead.last_call_at ? new Date(lead.last_call_at).toLocaleDateString() : '—'}</span>
        <span>Last outcome: {lead.last_call_outcome || '—'}</span>
      </div>

      {showNote && (
        <div className="flex flex-col gap-2" data-tour="note-composer">
          <textarea
            ref={noteInputRef}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note…"
            rows={2}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          {noteError && <div className="text-xs text-red-600">{noteError}</div>}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setShowNote(false); setNoteText(''); setNoteError(null); }}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleSaveNote} disabled={!noteText.trim() || savingNote}>
              {savingNote ? 'Saving…' : 'Save Note'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 pt-1">
        {callNextEnabled ? (
          <Button variant="primary" size="lg" onClick={onCallNext} className="w-full">
            <Phone size={17} /> Call Next
          </Button>
        ) : (
          <Button variant="primary" size="lg" onClick={handleCall} disabled={!phone} className="w-full">
            <Phone size={17} /> {callButtonLabel(dialerStatus)}
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="lg" onClick={() => onSkip()} className="flex-1">
            <SkipForward size={17} /> Skip
          </Button>
          <label className="relative flex items-center justify-center w-9 h-full rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50 cursor-pointer" title="Skip with a reason" data-tour="skip-reason">
            <ChevronDown size={14} />
            <select
              aria-label="Skip with a reason"
              className="absolute inset-0 opacity-0 cursor-pointer"
              value=""
              onChange={(e) => { if (e.target.value) onSkip(e.target.value); e.target.value = ''; }}
            >
              <option value="" disabled>Skip with reason…</option>
              {SKIP_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="text-xs text-slate-400 -mt-2">
        Shortcuts: <kbd className="px-1 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono">C</kbd> call/next · <kbd className="px-1 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono">S</kbd> skip · <kbd className="px-1 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono">N</kbd> note · <kbd className="px-1 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono">O</kbd> open in CRM
      </div>
      <div ref={dockRef} data-tour="call-dock" />
    </Card>
  );
}
