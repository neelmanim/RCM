import React, { useState, useMemo, useEffect } from 'react';
import { X, Workflow, ListPlus, Send } from 'lucide-react';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { Select } from '../../../components/ui/Select';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/Popover';
import { MenuSkeletonRows } from '../../../components/ui/Skeleton';
import { CallListsService } from '../../../services/api';
import { JourneyPicker, useEnrollInCadence } from '../../sales-journey/EnrollInCadence';

import { useCampaignComposeForm } from '../../sales-tools/campaignCompose';
import { CampaignComposeFields } from '../../sales-tools/CampaignsSection';

// Capacity fields (active_leads/max_active) already come back on every user
// from GET /admin/users — classic's assign picker shows them and disables
// at-cap SDRs; sorting most-available-first (rather than whatever order the
// endpoint returns) is what actually makes that capacity info useful for
// spreading load, not just informational.
function withCapacity(s) {
  const active = s.active_leads ?? 0;
  const max = s.max_active ?? 5;
  return { ...s, active, max, atCap: active >= max };
}

/** Assign-to picker — the searchable Select (20+ SDR names) with each
 * option's capacity folded into its label and at-cap SDRs disabled rather
 * than hidden, matching classic's assign picker (spreads load visibly
 * instead of silently routing around a full SDR). */
function AssigneePicker({ sdrs, value, onChange }) {
  const ranked = useMemo(
    () => [...sdrs].map(withCapacity).sort((a, b) => (a.active / a.max) - (b.active / b.max)),
    [sdrs]
  );
  const options = ranked.map((s) => ({
    value: s.id,
    label: `${s.name} — ${s.active}/${s.max}${s.atCap ? ' FULL' : ''}`,
    disabled: s.atCap,
  }));
  const selectedName = ranked.find((s) => s.id === value)?.name;

  return (
    <Select value={value} onChange={onChange} options={options} ariaLabel="Assign to" searchable>
      <span className="inline-flex bg-white/10 border border-white/20 rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap max-w-[160px] truncate text-white">
        {selectedName || 'Assign to…'}
      </span>
    </Select>
  );
}

// Add to Call List — no role gate (unlike JourneyPicker's canEnrollJourney):
// SDR/AE/Admin can all create and populate a Call List. Fetches lazily on
// first open, same idiom as JourneyPicker, plus an inline "+ New list" create.
function CallListPicker({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState(null); // null = not yet loaded
  const [newName, setNewName] = useState('');

  const refresh = () => CallListsService.list().then((r) => setLists(r.call_lists || [])).catch(() => setLists([]));
  useEffect(() => { if (open && lists === null) refresh(); }, [open, lists]);

  const handleCreateAndAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    const created = await CallListsService.create(name);
    setNewName('');
    setOpen(false);
    onAdd(created);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="flex items-center gap-1.5 bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap text-white shrink-0">
          <ListPlus size={13} /> Add to Call List
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[240px] max-h-[300px] overflow-y-auto p-1.5">
        {lists === null && <MenuSkeletonRows />}
        {lists?.length === 0 && <div className="px-2.5 py-2 text-xs text-slate-400">No Call Lists yet.</div>}
        {lists?.map((cl) => (
          <button key={cl.id} type="button" onClick={() => { setOpen(false); onAdd(cl); }}
            className="w-full flex items-center justify-between gap-2 text-left px-2.5 py-1.5 rounded-md text-xs hover:bg-slate-50">
            <span className="truncate">{cl.name}</span>
            <span className="shrink-0 text-slate-400">{cl.lead_count}</span>
          </button>
        ))}
        <div className="flex items-center gap-1.5 mt-1 pt-1.5 border-t border-slate-100">
          <input
            type="text" placeholder="New list name…" value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateAndAdd(); }}
            className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-md border border-slate-200 bg-slate-50 focus:outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20"
          />
          <button type="button" onClick={handleCreateAndAdd} disabled={!newName.trim()}
            className="shrink-0 px-2.5 py-1.5 text-xs font-bold rounded-md bg-blue-600 text-white disabled:opacity-40">
            Create
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Send Email Campaign — no role gate, same reasoning as CallListPicker above
// (an SDR emailing their own selected leads isn't privileged the way bulk
// org-wide assignment or cadence enrollment is). Uses ConfirmDialog's own
// message+children+footer shape rather than a bespoke modal, matching every
// other bulk action's confirm step.
function CampaignComposeButton({ selectedCount, selectedLeadIds, onToast }) {
  const [open, setOpen] = useState(false);
  const form = useCampaignComposeForm({
    leadIds: selectedLeadIds, open,
    notify: (msg) => onToast(msg), // this bar's onToast is single-arg — drop the (unused here) type
    onSuccess: () => setOpen(false),
  });
  const close = () => { setOpen(false); form.reset(); };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap text-white shrink-0">
        <Send size={13} /> Send Email Campaign
      </button>
      <ConfirmDialog
        open={open}
        onClose={close}
        title="Send Email Campaign"
        message={`Compose one email to send to ${selectedCount} lead(s). Find results afterward in Sales Tools → Campaigns.`}
        confirmLabel={form.confirmLabel}
        onConfirm={form.handleSend}
        loading={form.busy}
      >
        <CampaignComposeFields
          templates={form.templates}
          templateId={form.templateId}
          onPickTemplate={form.handlePickTemplate}
          campaignName={form.campaignName} setCampaignName={form.setCampaignName}
          subject={form.subject} setSubject={form.setSubject}
          body={form.body} setBody={form.setBody}
          saveAsTemplate={form.saveAsTemplate} setSaveAsTemplate={form.setSaveAsTemplate}
          templateName={form.templateName} setTemplateName={form.setTemplateName}
          schedule={form.schedule} setSchedule={form.setSchedule}
          includeSignature={form.includeSignature} setIncludeSignature={form.setIncludeSignature}
        />
      </ConfirmDialog>
    </>
  );
}

export function BulkActionBar({ list, onToast, canDelete, canEnrollJourney, canBulkAssign = true }) {
  const { selected, total, clearSelection, sdrs, bulkAssign, bulkUnassign, bulkDelete, selectAllMatching, selectingAllMatching } = list;
  const [assignee, setAssignee] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  const [unassignBusy, setUnassignBusy] = useState(false);

  // Hooks before the early return below (React's rule of hooks).
  const enroll = useEnrollInCadence({ leadIds: Array.from(selected), onToast: (message) => onToast(message) });

  if (selected.size === 0) return null;

  const handleAssign = async () => {
    if (!assignee) { onToast('Pick an SDR first.'); return; }
    setAssignBusy(true);
    try {
      const result = await bulkAssign(assignee);
      onToast(result.message);
      setAssignee('');
    } catch (err) {
      onToast('Failed to assign leads — please try again.');
    } finally {
      setAssignBusy(false);
    }
  };
  const handleUnassign = async () => {
    setUnassignBusy(true);
    try {
      const result = await bulkUnassign();
      onToast(result.message);
    } catch (err) {
      onToast('Failed to unassign leads — please try again.');
    } finally {
      setUnassignBusy(false);
    }
  };
  const handleAddToCallList = async (callList) => {
    try {
      const result = await CallListsService.addLeads(callList.id, Array.from(selected));
      onToast(`Added ${result.added} lead(s) to "${callList.name}"` +
        (result.already_present ? ` — ${result.already_present} already in the list` : ''));
    } catch (err) {
      onToast('Failed to add leads to the Call List — please try again.');
    }
  };
  const confirmDelete = async () => {
    setDeleteBusy(true);
    try {
      const result = await bulkDelete();
      onToast(result.message);
      setDeleteConfirmOpen(false);
    } catch (err) {
      onToast('Failed to delete leads — please try again.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
    <div className="fixed left-1/2 bottom-6 -translate-x-1/2 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 bg-slate-900 text-white rounded-2xl px-4 py-3 shadow-2xl text-xs max-w-[92vw]">
      <span className="font-bold whitespace-nowrap">{selected.size} selected</span>
      {selected.size < total && (
        <button type="button" onClick={selectAllMatching} disabled={selectingAllMatching}
          className="text-blue-300 underline underline-offset-2 font-semibold whitespace-nowrap disabled:opacity-60">
          {selectingAllMatching ? 'Fetching matching lead IDs…' : `Select all ${total} matching leads`}
        </button>
      )}
      {canBulkAssign && <div className="w-px h-5 bg-white/20" />}
      {canBulkAssign && <AssigneePicker sdrs={sdrs} value={assignee} onChange={setAssignee} />}
      {canBulkAssign && (
        <button type="button" onClick={handleAssign} disabled={assignBusy}
          className="bg-blue-600 rounded-lg px-3.5 py-1.5 font-bold whitespace-nowrap text-white disabled:opacity-60">
          {assignBusy ? 'Assigning…' : 'Assign'}
        </button>
      )}
      {canBulkAssign && <div className="w-px h-5 bg-white/20" />}
      {canBulkAssign && (
        <button type="button" onClick={handleUnassign} disabled={unassignBusy}
          className="bg-white/10 border border-white/20 rounded-lg px-3.5 py-1.5 font-bold whitespace-nowrap text-white disabled:opacity-60">
          {unassignBusy ? 'Unassigning…' : 'Unassign'}
        </button>
      )}
      {canEnrollJourney && <div className="w-px h-5 bg-white/20" />}
      {canEnrollJourney && (
        <JourneyPicker onEnroll={enroll.start} side="top">
          <button type="button" className="flex items-center gap-1.5 bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap text-white shrink-0">
            <Workflow size={13} /> Enroll in Cadence
          </button>
        </JourneyPicker>
      )}
      <div className="w-px h-5 bg-white/20" />
      <CallListPicker onAdd={handleAddToCallList} />
      <div className="w-px h-5 bg-white/20" />
      <CampaignComposeButton selectedCount={selected.size} selectedLeadIds={Array.from(selected)} onToast={onToast} />
      {canDelete && (
        <button type="button" onClick={() => setDeleteConfirmOpen(true)} className="text-red-300 border border-red-400/40 rounded-lg px-3.5 py-1.5 font-bold whitespace-nowrap">Delete</button>
      )}
      <button type="button" onClick={clearSelection} aria-label="Clear selection" title="Clear selection"
        className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white ml-1">
        <X size={16} strokeWidth={2.5} />
      </button>
    </div>

    {canDelete && (
    <ConfirmDialog
      open={deleteConfirmOpen}
      onClose={() => setDeleteConfirmOpen(false)}
      title="Delete leads"
      message={`Delete ${selected.size} lead(s)? This cannot be undone.`}
      confirmLabel="Delete"
      confirmVariant="danger"
      onConfirm={confirmDelete}
      loading={deleteBusy}
    />
    )}

    {enroll.dialog}
    </>
  );
}
