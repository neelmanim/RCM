import React, { useMemo, useState } from 'react';
import { Settings2, ArrowUp, ArrowDown, X, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { IconButton } from '../../components/ui/IconButton';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Switch } from '../../components/ui/Switch';
import { Badge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';

export const MAX_TILES = 10;        // more than this and the strip stops being a glance

// The "Customize numbers" dialog: pick which of the Digest's numbers to show and in what order. Apply uses them now;
// "Save as view" also keeps them under a name for next time.
function CustomizeDialog({ open, onClose, catalog, keys, onApply, onSave, saving, error, canShare }) {
  const [draft, setDraft] = useState(keys);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const byKey = useMemo(() => Object.fromEntries(catalog.map((c) => [c.key, c])), [catalog]);
  const groups = useMemo(() => {
    const out = {};
    catalog.forEach((c) => { (out[c.group] = out[c.group] || []).push(c); });
    return Object.entries(out);
  }, [catalog]);

  const toggle = (key) => setDraft((d) => (d.includes(key) ? d.filter((k) => k !== key) : (d.length >= MAX_TILES ? d : [...d, key])));
  const move = (i, by) => setDraft((d) => { const next = [...d]; const j = i + by; if (j < 0 || j >= next.length) return d; [next[i], next[j]] = [next[j], next[i]]; return next; });

  return (
    <Modal open={open} onClose={onClose} title="Customize numbers" maxWidth="max-w-2xl">
      <p className="text-sm text-slate-500 mb-4">Choose up to {MAX_TILES} numbers for the strip at the top, and put them in the order you want.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Shown ({draft.length}/{MAX_TILES})</h3>
          {draft.length ? (
            <ol className="space-y-1.5 list-none p-0 m-0">
              {draft.map((k, i) => (
                <li key={k} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
                  <span className="flex-1 truncate font-medium text-slate-700">{byKey[k]?.label || k}</span>
                  <IconButton aria-label={`Move ${byKey[k]?.label} up`} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={14} /></IconButton>
                  <IconButton aria-label={`Move ${byKey[k]?.label} down`} onClick={() => move(i, 1)} disabled={i === draft.length - 1}><ArrowDown size={14} /></IconButton>
                  <IconButton aria-label={`Remove ${byKey[k]?.label}`} variant="danger" onClick={() => toggle(k)}><X size={14} /></IconButton>
                </li>
              ))}
            </ol>
          ) : <p className="text-xs text-amber-700">Pick at least one number.</p>}
        </div>
        <div className="max-h-80 overflow-y-auto pr-1">
          {groups.map(([group, items]) => (
            <div key={group} className="mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1.5">{group}</h3>
              <div className="space-y-1.5">
                {items.map((c) => (
                  <div key={c.key} title={c.hint}>
                    <Checkbox checked={draft.includes(c.key)} onChange={() => toggle(c.key)} label={c.label}
                      disabled={!draft.includes(c.key) && draft.length >= MAX_TILES} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-slate-100 space-y-3">
        <Input label="Save as a view (optional)" placeholder="e.g. Weekly review" value={name} onChange={(e) => setName(e.target.value)}
          hint={canShare ? 'Appears in your View menu. Switch on sharing to give it to the whole team.' : 'Saved views are yours alone and appear in the View menu.'} containerClassName="!mb-0" />
        {canShare && <Switch label="Share with the whole team" hint="Everyone can use this view; only you (or a Super Admin) can delete it." checked={shared} onChange={(e) => setShared(e.target.checked)} />}
        {error && <p role="alert" className="text-xs text-red-700 bg-red-50 rounded-lg p-2.5">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="outline" disabled={!draft.length || !name.trim() || saving} onClick={() => onSave(name.trim(), draft, canShare && shared)}>{saving ? 'Saving…' : 'Save View'}</Button>
          <Button disabled={!draft.length} onClick={() => onApply(draft)}>Apply</Button>
        </div>
      </div>
    </Modal>
  );
}

/** The View menu + Customize button above the numbers. `views` are the person's saved digest views; the standard view is
 *  always there. */
export function DigestViews({ catalog, keys, views, activeId, onPick, onApply, onSave, onDelete, canShare = false }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(null);

  const options = [{ value: 'standard', label: 'Standard' }, ...views.map((v) => ({ value: v.id, label: v.shared && v.mine === false ? `${v.name} (shared)` : v.name }))];
  if (activeId === 'custom') options.push({ value: 'custom', label: 'Custom (not saved)' });
  const active = views.find((v) => v.id === activeId);

  const save = async (name, draft, shared) => {
    setSaving(true);
    setError('');
    try { await onSave(name, draft, shared); setOpen(false); }
    catch (e) { setError(e?.response?.data?.detail || e?.message || 'Could not save the view.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap" data-tour="digest-views">
      <span className="text-xs font-semibold text-slate-500">View</span>
      <Select value={activeId} onChange={onPick} ariaLabel="View" options={options} />
      <Button size="sm" variant="outline" onClick={() => { setError(''); setOpen(true); }}><Settings2 size={14} /> Customize numbers</Button>
      {active?.shared && <Badge variant="info">Shared with team</Badge>}
      {active && (active.mine !== false || ['Super Admin', 'Admin'].includes(window.__CRM_CURRENT_USER__?.role)) && (
        <IconButton aria-label={`Delete view ${active.name}`} variant="danger" onClick={() => setRemoving(active)}><Trash2 size={14} /></IconButton>
      )}
      {open && (
        <CustomizeDialog open onClose={() => setOpen(false)} catalog={catalog} keys={keys} onApply={(k) => { onApply(k); setOpen(false); }}
          onSave={save} saving={saving} error={error} canShare={canShare} />
      )}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Delete this view?"
        message={removing ? `"${removing.name}" will be removed. The numbers themselves are not affected.` : ''}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={async () => { const v = removing; setRemoving(null); await onDelete(v); }}
      />
    </div>
  );
}
