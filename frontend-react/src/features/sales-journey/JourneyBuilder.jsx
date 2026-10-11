import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, Save, Plus, Rocket, Archive as ArchiveIcon, Pause, Play, Pencil, ChevronDown, Lock, AlignStartVertical, AlignStartHorizontal, Workflow, BarChart3 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { Tabs } from '../../components/ui/Tabs';
import { useJourneyStore } from './store/useJourneyStore';
import { nodeTypes, NODE_ACCENT } from './nodes';
import { NodeConfigPanel } from './NodeConfigPanel';
import { FailedEnrollmentsPanel } from './FailedEnrollmentsPanel';
import { ReportingTab } from './ReportingTab';
import { SendWindowSettings } from './SendWindowSettings';
import { CadenceRulesSettings } from './CadenceRulesSettings';
import { CadenceBuilderTour } from './CadenceBuilderTour';
import { validateGraph, errorsByNode } from './validation';
import { NODE_TYPES, NODE_LABELS, SINGLETON_NODE_TYPES } from './nodeDefaults';
import { SalesJourneyService, PodsService } from '../../services/api';
import { toast } from './toast';

const STATUS_VARIANT = { draft: 'default', active: 'success', paused: 'warning', archived: 'danger' };
// One-line explanation of what each status actually implies — the raw enum
// is plain English (just capitalized via className below), but doesn't say
// what it means for whether the cadence is actually running.
const STATUS_TITLE = {
  draft: 'Not published yet — no leads can enroll.',
  active: 'Live — enrolls leads as they trigger it, and steps are running.',
  paused: 'No steps are running — leads stay exactly where they are until resumed.',
  archived: 'No longer active — cannot be edited or re-published.',
};
// One-line description per node type for the toolbar buttons — a first-time
// admin sees only "Trigger / Email / Wait / Condition / Call" otherwise.
const NODE_TYPE_HINT = {
  trigger: 'Starts the cadence — enrolls a lead automatically when an event happens (e.g. status changes).',
  email: 'Sends an email to the lead.',
  wait: 'Pauses for a set number of days/hours before continuing.',
  condition: 'Branches on an event (e.g. the lead replied) or on a lead field (e.g. job title).',
  call: 'Creates a task reminding the assigned SDR to call — does not place an automated call.',
  task: 'A manual step (research, LinkedIn, anything done by hand) — the cadence waits for the rep and can branch on their outcome.',
  sms: 'Sends a text message to the lead via Alternate Messenger.',
  whatsapp: 'Sends a WhatsApp template message to the lead via Alternate Messenger.',
  instantly_sequence: 'Hands the lead off to a live Instantly.ai campaign to send through the pooled domains — Alternate CRM resumes the cadence on reply/interest/completion.',
};

export function JourneyBuilder({ journeyName, journeyStatus, journeyPodId, journeySendWindow, onBack, onArchived,
                                 readOnly = false, ownerName = null }) {
  const journeyId = useJourneyStore((s) => s.journeyId);
  const versionId = useJourneyStore((s) => s.versionId);
  const liveVersionId = useJourneyStore((s) => s.liveVersionId);
  const setPublishedVersions = useJourneyStore((s) => s.setPublishedVersions);
  const lastSavedAt = useJourneyStore((s) => s.lastSavedAt);
  const nodes = useJourneyStore((s) => s.nodes);
  const edges = useJourneyStore((s) => s.edges);
  const dirty = useJourneyStore((s) => s.dirty);
  const onNodesChange = useJourneyStore((s) => s.onNodesChange);
  const onEdgesChange = useJourneyStore((s) => s.onEdgesChange);
  const onConnect = useJourneyStore((s) => s.onConnect);
  const addNode = useJourneyStore((s) => s.addNode);
  const selectNode = useJourneyStore((s) => s.selectNode);
  const markSaved = useJourneyStore((s) => s.markSaved);
  const graphDefinition = useJourneyStore((s) => s.graphDefinition);
  const layoutDirection = useJourneyStore((s) => s.layoutDirection);
  const applyLayout = useJourneyStore((s) => s.applyLayout);

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(journeyStatus);
  const [name, setName] = useState(journeyName);
  const [editingName, setEditingName] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(null); // { count } | null
  const [archiving, setArchiving] = useState(false);
  const [pauseResumeBusy, setPauseResumeBusy] = useState(false);
  const [pods, setPods] = useState([]);
  const [podId, setPodId] = useState(journeyPodId || '');
  const [podSaving, setPodSaving] = useState(false);
  const [sendWindow, setSendWindow] = useState(journeySendWindow || {});
  const [view, setView] = useState('builder'); // 'builder' | 'reporting'

  useEffect(() => {
    PodsService.getAll().then(setPods).catch(() => {});
  }, []);

  const handlePodChange = useCallback(async (newPodId) => {
    const prev = podId;
    setPodId(newPodId);
    setPodSaving(true);
    try {
      await SalesJourneyService.updateSettings(journeyId, { pod_id: newPodId || null });
      toast(newPodId ? 'Cadence scoped to pod.' : 'Cadence now open to all pods.', 'success');
    } catch (err) {
      setPodId(prev);
      toast(err.response?.data?.detail || 'Failed to update pod scope — please try again.', 'error');
    } finally {
      setPodSaving(false);
    }
  }, [journeyId, podId]);

  const handleRename = useCallback(async (newName) => {
    const trimmed = newName.trim();
    setEditingName(false);
    if (!trimmed || trimmed === name) return;
    const prev = name;
    setName(trimmed);
    setNameSaving(true);
    try {
      await SalesJourneyService.updateSettings(journeyId, { name: trimmed });
      toast('Cadence renamed.', 'success');
    } catch (err) {
      setName(prev);
      toast(err.response?.data?.detail || 'Failed to rename — please try again.', 'error');
    } finally {
      setNameSaving(false);
    }
  }, [journeyId, name]);

  const errors = useMemo(() => validateGraph(nodes, edges), [nodes, edges]);
  const errorMap = useMemo(() => errorsByNode(errors), [errors]);

  const nodesWithErrors = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, __errors: errorMap.get(n.id) } })),
    [nodes, errorMap],
  );

  const existingTypes = useMemo(() => new Set(nodes.map((n) => n.type)), [nodes]);
  // Every mutating control in this header shares this one gate — archived
  // cadences are immutable for everyone, readOnly additionally blocks a
  // non-admin viewer regardless of status.
  const canEdit = status !== 'archived' && !readOnly;

  const handleAddNode = useCallback((type) => {
    // Stack straight down from whatever's currently lowest, instead of a
    // diagonal cascade — that drifted far enough right that a 4th/5th node
    // could land underneath the fixed-position MiniMap in the corner.
    const maxY = nodes.length ? Math.max(...nodes.map((n) => n.position.y)) : 0;
    const position = { x: 80, y: nodes.length ? maxY + 150 : 80 };
    addNode(type, position);
  }, [addNode, nodes]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const result = await SalesJourneyService.saveDraft(journeyId, versionId, graphDefinition(), lastSavedAt);
      markSaved(result.saved_at);
      toast('Saved', 'success');
    } catch (err) {
      if (err.response?.status === 409) {
        toast(err.response.data?.detail || 'This cadence was modified elsewhere — refresh to see the latest changes.', 'error');
      } else {
        toast('Failed to save — please try again.', 'error');
      }
    } finally {
      setSaving(false);
    }
  }, [journeyId, versionId, lastSavedAt, graphDefinition, markSaved]);

  // Says what publishing will and won't do: entry is event-driven (a status
  // CHANGE), never a sweep of leads already sitting in the status.
  const trigger = nodes.find((n) => n.type === 'trigger')?.data;
  const publishEntryNote = trigger?.event === 'status_changed' && trigger.to_status
    ? `Leads whose status changes to ${trigger.to_status} after you publish will enroll. Leads already in ${trigger.to_status} are not enrolled — use Enroll in Cadence for those.`
    : 'Leads that trigger this after you publish will enroll.';

  const handlePublish = useCallback(async () => {
    setPublishing(true);
    try {
      const result = await SalesJourneyService.publish(journeyId);
      setStatus(result.status);
      setPublishedVersions(result.draft_version_id, result.live_version_id);
      setPublishConfirmOpen(false);
      toast('Live — leads enroll when they trigger it, not retroactively.', 'success');
    } catch (err) {
      toast(err.response?.data?.detail || 'Failed to publish — please try again.', 'error');
    } finally {
      setPublishing(false);
    }
  }, [journeyId]);

  const openArchiveConfirm = useCallback(async () => {
    try {
      const stats = await SalesJourneyService.getStats(journeyId);
      setArchiveConfirm({ count: stats.active });
    } catch (err) {
      toast('Failed to check active enrollments — please try again.', 'error');
    }
  }, [journeyId]);

  const handleArchive = useCallback(async () => {
    setArchiving(true);
    try {
      const result = await SalesJourneyService.archive(journeyId, archiveConfirm.count);
      setStatus(result.status);
      setArchiveConfirm(null);
      toast(`Archived — ${result.enrollments_exited} active enrollment(s) exited.`, 'success');
      onArchived?.();
    } catch (err) {
      if (err.response?.status === 409) {
        toast(err.response.data?.detail || 'Enrollment count changed — try again.', 'error');
        setArchiveConfirm(null);
      } else {
        toast('Failed to archive — please try again.', 'error');
      }
    } finally {
      setArchiving(false);
    }
  }, [journeyId, archiveConfirm, onArchived]);

  const handlePauseResume = useCallback(async () => {
    setPauseResumeBusy(true);
    try {
      const result = status === 'paused'
        ? await SalesJourneyService.resume(journeyId)
        : await SalesJourneyService.pause(journeyId);
      setStatus(result.status);
      toast(result.status === 'paused' ? 'Paused — no steps will run until resumed.' : 'Resumed.', 'success');
    } catch (err) {
      toast(err.response?.data?.detail || 'Failed to update — please try again.', 'error');
    } finally {
      setPauseResumeBusy(false);
    }
  }, [journeyId, status]);

  return (
    // Fixed viewport-relative height rather than h-full: the classic shell's
    // .view-container (where this eventually mounts, once nav-wired in Phase 3)
    // has its own padding/overflow-auto rules that don't establish a definite
    // height for a plain block child — a canvas needs one. Exact tuning against
    // the live shell happens when Phase 3 actually wires this into the nav.
    <div className="salesjourney-hub flex flex-col h-[75vh] min-h-[500px] w-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onBack} className="text-slate-400 hover:text-slate-600 shrink-0">
            <ArrowLeft size={18} />
          </button>
          {editingName ? (
            <input
              autoFocus
              defaultValue={name}
              disabled={nameSaving}
              className="text-sm font-bold text-slate-800 border border-blue-300 rounded px-1 py-0.5 min-w-0 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              onBlur={(e) => handleRename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.target.blur();
                if (e.key === 'Escape') setEditingName(false);
              }}
            />
          ) : (
            <h2
              className={`text-sm font-bold text-slate-800 truncate flex items-center gap-1.5 ${canEdit ? 'cursor-pointer group' : ''}`}
              title={canEdit ? 'Click to rename' : ''}
              onClick={() => canEdit && setEditingName(true)}
            >
              {name}
              {canEdit && (
                <Pencil size={12} className="text-slate-300 group-hover:text-slate-500 shrink-0" />
              )}
            </h2>
          )}
          <span title={STATUS_TITLE[status] || ''}>
            <Badge variant={STATUS_VARIANT[status] || 'default'} className="capitalize">{status}</Badge>
          </span>
          {errors.length > 0 && (
            <span className="text-xs text-red-600 shrink-0">{errors.length} issue{errors.length > 1 ? 's' : ''}</span>
          )}
          {status !== 'archived' && (
            readOnly ? (
              <span className="text-xs text-slate-500">{pods.find((p) => p.id === podId)?.name || 'All pods'}</span>
            ) : (
              <Select
                ariaLabel="Change pod"
                value={podId}
                onChange={handlePodChange}
                options={pods.map((p) => ({ value: p.id, label: p.name }))}
                placeholder="All pods"
              >
                <button
                  type="button"
                  disabled={podSaving}
                  title="Only leads in this pod can be auto-enrolled by this cadence's trigger. All pods if unset."
                  className="flex items-center gap-1 text-xs border border-slate-200 rounded-md px-1.5 py-1 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pods.find((p) => p.id === podId)?.name || 'All pods'}
                  <ChevronDown size={12} className="text-slate-400 shrink-0" />
                </button>
              </Select>
            )
          )}
          {canEdit && (
            <>
              <SendWindowSettings journeyId={journeyId} journey={sendWindow} onSaved={setSendWindow} />
              <span data-tour="cadence-rules">
                <CadenceRulesSettings journeyId={journeyId} journey={sendWindow} onSaved={setSendWindow} />
              </span>
              <CadenceBuilderTour />
            </>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && view === 'builder' && NODE_TYPES.map((type) => {
            const isSingletonUsed = SINGLETON_NODE_TYPES.includes(type) && existingTypes.has(type);
            return (
              <Button
                key={type}
                variant="outline"
                size="sm"
                disabled={isSingletonUsed}
                onClick={() => handleAddNode(type)}
                data-tour={type === 'task' ? 'add-task-step' : type === 'condition' ? 'add-condition-step' : type === 'instantly_sequence' ? 'add-instantly-sequence-step' : undefined}
                title={isSingletonUsed ? `Only one ${NODE_LABELS[type]} node is allowed per cadence.` : NODE_TYPE_HINT[type]}
              >
                <Plus size={14} /> {NODE_LABELS[type]}
              </Button>
            );
          })}
          {canEdit && view === 'builder' && nodes.length > 1 && (
            <div className="flex items-center border border-slate-200 rounded-md overflow-hidden" title="Re-arrange the graph by depth from the trigger">
              <button
                type="button"
                onClick={() => applyLayout('TB')}
                title="Vertical layout"
                className={`p-1.5 ${layoutDirection === 'TB' ? 'bg-slate-200 text-slate-800' : 'bg-white text-slate-400 hover:text-slate-600'}`}
              >
                <AlignStartVertical size={14} />
              </button>
              <button
                type="button"
                onClick={() => applyLayout('LR')}
                title="Horizontal layout"
                className={`p-1.5 border-l border-slate-200 ${layoutDirection === 'LR' ? 'bg-slate-200 text-slate-800' : 'bg-white text-slate-400 hover:text-slate-600'}`}
              >
                <AlignStartHorizontal size={14} />
              </button>
            </div>
          )}
          {canEdit && (
            <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
              <Save size={14} /> {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </Button>
          )}
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setPublishConfirmOpen(true)}
              disabled={errors.length > 0 || dirty}
              title={
                errors.length > 0 ? `Fix ${errors.length} issue${errors.length > 1 ? 's' : ''} before publishing.`
                : dirty ? 'Save your changes first.'
                : 'Publish this cadence.'
              }>
              <Rocket size={14} /> Publish
            </Button>
          )}
          {(status === 'active' || status === 'paused') && !readOnly && (
            <Button size="sm" variant="outline" onClick={handlePauseResume} disabled={pauseResumeBusy}>
              {status === 'paused' ? <Play size={14} /> : <Pause size={14} />}
              {status === 'paused' ? 'Resume' : 'Pause'}
            </Button>
          )}
          {canEdit && (
            <Button size="sm" variant="danger" onClick={openArchiveConfirm}>
              <ArchiveIcon size={14} /> Archive
            </Button>
          )}
        </div>
      </div>

      {status !== 'draft' && status !== 'archived' && (
        <Tabs
          className="px-4"
          tabs={[{ key: 'builder', label: 'Builder', icon: Workflow }, { key: 'reporting', label: 'Reporting', icon: BarChart3 }]}
          active={view}
          onChange={setView}
        />
      )}

      {readOnly && (
        <div data-tour="cadence-readonly-banner" className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-500 flex items-center gap-1.5">
          <Lock size={12} className="shrink-0 text-slate-400" />
          {ownerName
            // Whose it is, and who to go to — a bare "read-only" left a Pod
            // Admin with no idea why their own edit rights didn't apply here.
            ? <span>Read-only — this cadence is owned by <strong className="font-semibold text-slate-600">{ownerName}</strong>. Ask them to make changes.</span>
            : <span>Read-only — contact your Pod Admin to request a change.</span>}
        </div>
      )}

      {(status === 'active' || status === 'paused') && liveVersionId && versionId !== liveVersionId && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
          {readOnly ? (
            // Don't instruct someone to Save/Publish when both buttons are
            // hidden from them — that's what this banner did for every
            // read-only viewer (visible to SDRs since v12.1).
            <>There are unpublished draft changes — leads already enrolled keep running the live version.</>
          ) : (
            <>
              You're editing a draft — leads already enrolled keep running the live version.
              {dirty ? ' Save, then click ' : ' Click '}
              <strong>Publish</strong> to make these changes live for new enrollments.
            </>
          )}
        </div>
      )}

      {view === 'builder' ? (
        <>
          {status !== 'draft' && status !== 'archived' && <FailedEnrollmentsPanel journeyId={journeyId} readOnly={readOnly} />}

          <div className="flex flex-1 min-h-0">
            <div className="flex-1 min-w-0 h-full relative">
              {nodes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                  <p className="text-sm text-slate-400 text-center max-w-xs">
                    Start by adding a <strong>Trigger</strong> node above — it defines how a lead enters this cadence.
                  </p>
                </div>
              )}
              <ReactFlow
                nodes={nodesWithErrors}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, node) => selectNode(node.id)}
                onPaneClick={() => selectNode(null)}
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                fitView
              >
                <Background />
                <Controls />
                <MiniMap pannable zoomable nodeColor={(n) => (NODE_ACCENT[n.type] || NODE_ACCENT.wait).hex} />
              </ReactFlow>
            </div>
            <NodeConfigPanel errors={errorMap} readOnly={readOnly} />
          </div>
        </>
      ) : (
        <ReportingTab journeyId={journeyId} nodes={nodes} />
      )}

      <ConfirmDialog
        open={publishConfirmOpen}
        onClose={() => setPublishConfirmOpen(false)}
        title="Publish Cadence"
        message={`${publishEntryNote} You can still edit it afterward — publishing again replaces the live version for new enrollments only; leads already in progress keep running the version they enrolled on.`}
        confirmLabel="Publish"
        onConfirm={handlePublish}
        loading={publishing}
      />

      <ConfirmDialog
        open={!!archiveConfirm}
        onClose={() => setArchiveConfirm(null)}
        title="Archive Cadence"
        message={archiveConfirm ? `This cadence currently has ${archiveConfirm.count} active enrollment(s). Archiving will exit all of them immediately — this cannot be undone.` : ''}
        confirmLabel="Archive"
        confirmVariant="danger"
        onConfirm={handleArchive}
        loading={archiving}
      />
    </div>
  );
}
