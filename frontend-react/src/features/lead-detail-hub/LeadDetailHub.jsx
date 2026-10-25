import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { LeadsService, AdminService, AssignmentsService } from '../../services/api';
import { getToken } from '../../services/auth';
import { LeadDetailSkeleton } from '../../components/ui/Skeleton';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { EmailHub } from '../../pages/Email/EmailHub';
import { useLeadDetail } from './hooks/useLeadDetail';
import { useCallController } from './call/useCallController';
import { deriveNextBestAction } from './lib/deriveNextBestAction';
import { deriveResearchStatus } from './lib/deriveResearchStatus';
import { fmtDate } from './lib/formatDate';

import { LeadHeader } from './components/LeadHeader';
import { SalesStage } from './components/SalesStage';
import { NextBestAction } from './components/NextBestAction';
import { LeadSummary } from './components/LeadSummary';
import { ContactCard } from './components/ContactCard';
import { EnrichmentCard } from './components/EnrichmentCard';
import { PreCallIntelligence } from './components/PreCallIntelligence';
import { ActivityTimeline } from './components/ActivityTimeline';
import { TasksPanel } from './components/TasksPanel';
import { EmailsPanel } from './components/EmailsPanel';

import { QuickActions } from './rail/QuickActions';
import { useEnrollInCadence } from '../sales-journey/EnrollInCadence';
import { tasksChanged } from '../../components/tasks/taskMeta';
import { CallStrategy } from './rail/CallStrategy';
import { NotesPanel } from './rail/NotesPanel';
import { RelatedOpportunity } from './rail/RelatedOpportunity';
import { StatusHistory } from './rail/StatusHistory';

function toast(message, type = 'info') {
  window.dispatchEvent(new CustomEvent('alternate:toast', { detail: { message, type } }));
}

const OUTCOME_ELIGIBLE_STATUSES = new Set([
  'Meeting Scheduled', '1st Discovery Meeting', 'Discovery Complete',
  'Demo Scheduled', 'Demo Done', 'Completed', 'Disqualified',
]);

export function LeadDetailHub({
  leadId, userRole, userPodId,
  navPosition, onPreviousLead, onNextLead, onBack,
  onSwitchToClassic,
}) {
  const {
    lead, leadLoading, leadError,
    activities, callsLoading, callsError, hasMoreActivities, loadMoreActivities,
    tasks, tasksLoading,
    notes, notesLoading,
    emails, emailsLoading, emailsError,
    journey,
    historyLoading,
    researching, researchError, triggerResearch,
    refetch,
  } = useLeadDetail(leadId);

  const [activityFilter, setActivityFilter] = useState('all');

  // ── Alternate Messenger Widget context sync ──────────────────────────────────────
  // Mirrors frontend/js/views/lead_detail.js's exact sync so the FAB's Call
  // and Message tabs know which lead is open here too — this page never set
  // it, so the widget always showed "No lead selected" (v13 cadence-launch
  // gap check, 2026-10-01).
  useEffect(() => {
    if (!lead) return;
    window._currentLead = lead;
    if (window._messengerWidgetReady && typeof window.MessengerWidget !== 'undefined') {
      const phone = lead.phone || lead.phone_secondary || lead.company_phone || '';
      const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || '';
      window.MessengerWidget.setLead(lead.id, phone, name);
    }
    return () => {
      if (window._messengerWidgetReady && typeof window.MessengerWidget !== 'undefined') {
        window.MessengerWidget.setLead(null, null, null);
      }
      window._currentLead = null;
    };
  }, [lead]);

  const isSuperAdmin = userRole === 'Super Admin' || userRole === 'Admin';
  const isPodAdmin = userRole === 'Pod Admin';
  const isAdmin = isSuperAdmin || isPodAdmin;

  // Assignable SDR/AE list for the "change assignment" control below —
  // mirrors frontend/js/views/assignments.js's exact role filter. Backend
  // (GET /admin/users) already pod-scopes this for Pod Admin.
  const [assignableUsers, setAssignableUsers] = useState([]);
  useEffect(() => {
    if (!isAdmin) return;
    AdminService.getUsers()
      .then((users) => setAssignableUsers(users.filter((u) => u.role === 'SDR' || u.role === 'AE' || u.role === 'Sales')))
      .catch(() => {});
  }, [isAdmin]);

  const handleReassign = useCallback(async (userId) => {
    try {
      await AssignmentsService.bulkUnassign([leadId]);
      if (userId) await AssignmentsService.bulkAssign(userId, [leadId]);
      toast('Assignment updated', 'success');
      refetch.lead();
    } catch (err) {
      toast(err.message || 'Failed to update assignment', 'error');
    }
  }, [leadId, refetch]);
  // Mirrors frontend/js/views/lead_helpers.js::canModifyLead exactly: Super
  // Admin always; SDR/AE always (backend already scopes their visibility);
  // Pod Admin only for unassigned leads or leads in their own pod.
  const canModify = useMemo(() => {
    if (!lead) return false;
    if (isSuperAdmin) return true;
    if (!isPodAdmin) return true;
    if (!lead.lead_pod_ids || lead.lead_pod_ids.length === 0) return true;
    return Boolean(userPodId) && lead.lead_pod_ids.includes(userPodId);
  }, [lead, isSuperAdmin, isPodAdmin, userPodId]);
  // isAdmin alone isn't enough for actions that mutate/leave the lead — a
  // Pod Admin must also pass the pod-boundary check canModify already does.
  const canAdminModify = isAdmin && canModify;

  const handleOutcomeResolved = useCallback(() => {
    refetch.activity();
    refetch.lead();
    refetch.journey();
  }, [refetch]);

  const { startCall } = useCallController(lead, { onOutcomeResolved: handleOutcomeResolved });

  // Legacy modules (Alternate Messenger widget, Calls-tab "Edit outcome") read
  // window._currentLead regardless of which view is mounted — set it here
  // the same way lead_detail.js does on every render.
  useEffect(() => {
    window._currentLead = lead || null;
  }, [lead]);

  // Stage-progression actions bridged through window._runLeadStageAction
  // (modals.js) dispatch this event on success — same refresh set as the
  // call-outcome-resolved handler above.
  useEffect(() => {
    if (!leadId) return;
    const handler = (ev) => {
      if (ev.detail?.leadId !== leadId) return;
      handleOutcomeResolved();
    };
    window.addEventListener('alternate:lead-detail-refresh', handler);
    return () => window.removeEventListener('alternate:lead-detail-refresh', handler);
  }, [leadId, handleOutcomeResolved]);

  const researchStatus = deriveResearchStatus(lead, { researching, error: researchError });
  const nextAction = deriveNextBestAction(lead, activities);
  const leadName = [lead?.first_name, lead?.last_name].filter(Boolean).join(' ') || lead?.email || 'this lead';

  // Outcome-eligible statuses mirror PATCH /leads/{id}/outcome's own gate —
  // RCA 2026-09-29: the card used to render only when an SF opportunity
  // already existed, so most Meeting Scheduled+ leads had no Won/Lost at all.
  const opportunities = useMemo(() => {
    if (!lead) return [];
    if (!OUTCOME_ELIGIBLE_STATUSES.has(lead.status)
        && !lead.opportunity_status && !lead.opportunity_notes && !lead.sf_opportunity_id) return [];
    return [{
      name: lead.company ? `${lead.company} Opportunity` : 'Opportunity',
      status: lead.opportunity_status,
      notes: lead.opportunity_notes,
    }];
  }, [lead]);

  const [showDisqualify, setShowDisqualify] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // 'delete' | 'optout' | null
  const [confirmBusy, setConfirmBusy] = useState(false);
  // null = closed; { emailId, mode } opens the in-place email hub.
  const [emailView, setEmailView] = useState(null);
  const closeEmailView = useCallback(() => { setEmailView(null); refetch.emails(); }, [refetch]);

  const runStageAction = useCallback((actionKey) => {
    if (typeof window._runLeadStageAction !== 'function') {
      toast('This action needs the classic view for now.', 'error');
      return;
    }
    // window._runLeadStageAction (modals.js) already shows its own success
    // toast and dispatches alternate:lead-detail-refresh — only the failure
    // path needs handling here.
    window._runLeadStageAction(leadId, actionKey).catch((e) => toast(e.message || 'Action failed', 'error'));
  }, [leadId]);

  const handleExecuteAction = useCallback((ctaKind) => {
    switch (ctaKind) {
      case 'call':
        startCall();
        break;
      case 'no-show':
        if (typeof window._openNoShowModal === 'function') {
          window._openNoShowModal(lead.id, [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email);
        } else {
          toast('This action needs the classic view for now.', 'error');
        }
        break;
      case 'demo-failed':
        if (typeof window._openDemoFailedModal === 'function') {
          window._openDemoFailedModal(lead.id, lead);
        } else {
          toast('This action needs the classic view for now.', 'error');
        }
        break;
      case 'meeting-complete':
        runStageAction('meetingComplete');
        break;
      case 'demo-success':
        runStageAction('demoSuccess');
        break;
      case 'add-discovery':
        runStageAction('addDiscovery');
        break;
      case 'complete-discovery':
        runStageAction('completeDiscovery');
        break;
      case 'schedule-demo':
        runStageAction('scheduleDemo');
        break;
      case 'disqualify':
        setShowDisqualify(true);
        break;
      case 'edit-contact':
        document.getElementById('lead-detail-hub-contact')?.scrollIntoView({ behavior: 'smooth' });
        break;
      case 'view-opportunity':
        document.getElementById('lead-detail-hub-opportunity')?.scrollIntoView({ behavior: 'smooth' });
        break;
      default:
        break; // unhandled ctaKinds are a no-op by design
    }
  }, [startCall, lead, runStageAction]);

  const handleChangeStage = useCallback((status) => {
    LeadsService.updateLead(leadId, { status })
      .then(() => { toast(`Stage updated to ${status}`, 'success'); refetch.lead(); refetch.activity(); })
      .catch((e) => toast(e?.response?.data?.detail || 'Failed to update stage', 'error'));
  }, [leadId, refetch]);

  const handleDisqualify = useCallback((reason) => {
    LeadsService.closeLead(leadId, reason)
      .then(() => { toast(`Lead disqualified: ${reason}`, 'success'); refetch.lead(); refetch.activity(); })
      .catch((e) => toast(e.message || 'Failed to close lead', 'error'));
  }, [leadId, refetch]);

  const handleDelete = useCallback(() => setConfirmAction('delete'), []);

  const confirmDeleteLead = useCallback(async () => {
    setConfirmBusy(true);
    try {
      await AssignmentsService.bulkDelete([leadId]);
      toast('Lead deleted successfully', 'success');
      window.location.hash = '#leads';
    } catch (e) {
      toast(e.message || 'Error deleting lead', 'error');
    } finally {
      setConfirmBusy(false);
      setConfirmAction(null);
    }
  }, [leadId]);

  const handleOpenClassicTab = useCallback((tab) => {
    sessionStorage.setItem('leadDetailPendingTab', tab);
    sessionStorage.setItem('leadDetailPendingTabLeadId', leadId);
    onSwitchToClassic?.();
  }, [leadId, onSwitchToClassic]);

  // Any task change here also tells the bell + sidebar badge to refetch now
  // (they poll every 60s otherwise, so a sent approval kept showing).
  const tasksMoved = useCallback(() => { refetch.tasks(); tasksChanged(); }, [refetch]);
  const handleAddTask = useCallback((title, dueDate, dueTime) => {
    LeadsService.addTask(leadId, title, dueDate, dueTime).then(tasksMoved).catch(() => toast('Failed to add task', 'error'));
  }, [leadId, refetch, tasksMoved]);
  const handleCompleteTask = useCallback((taskId, done) => {
    LeadsService.patchTask(leadId, taskId, { done }).then(tasksMoved).catch(() => toast('Failed to update task', 'error'));
  }, [leadId, refetch, tasksMoved]);
  // A cadence manual step's outcome finishes the task and moves the cadence on.
  const handleTaskOutcome = useCallback((taskId, outcome) => {
    LeadsService.patchTask(leadId, taskId, { done: true, outcome })
      .then(() => { tasksMoved(); refetch.journey(); })
      .catch((err) => toast(err.response?.data?.detail || 'Failed to record the outcome', 'error'));
  }, [leadId, refetch, tasksMoved]);
  // v13.1.0: approving (and optionally editing) a manual cadence email draft —
  // sends it and advances the cadence (journey_engine.complete_manual_email_step).
  const handleTaskSendEmail = useCallback((taskId, subject, body) => {
    return LeadsService.patchTask(leadId, taskId, { done: true, subject, body })
      .then(() => { tasksMoved(); refetch.journey(); })
      .catch((err) => { throw new Error(err.response?.data?.detail || 'Failed to send — try again'); });   // shown on the draft card
  }, [leadId, refetch, tasksMoved]);
  // Feedback #15: approving (and optionally editing) a manual cadence SMS draft.
  const handleTaskSendSms = useCallback((taskId, message) => {
    return LeadsService.patchTask(leadId, taskId, { done: true, message })
      .then(() => { tasksMoved(); refetch.journey(); })
      .catch((err) => { throw new Error(err.response?.data?.detail || 'Failed to send — try again'); });   // shown on the draft card
  }, [leadId, refetch, tasksMoved]);
  const handleDeleteTask = useCallback((taskId) => {
    return LeadsService.deleteTask(leadId, taskId).then(tasksMoved)
      .catch((err) => toast(err.response?.data?.detail || 'Failed to delete task', 'error'));
  }, [leadId, refetch, tasksMoved]);
  // v13.7.0 "Skip this step": the cadence moves on without this step (nothing sent).
  const handleSkipTask = useCallback((taskId) => {
    return LeadsService.skipTask(leadId, taskId)
      .then(() => { tasksMoved(); refetch.journey(); toast('Step skipped — the cadence moves on', 'success'); })
      .catch((err) => toast(err.response?.data?.detail || 'Failed to skip the step', 'error'));
  }, [leadId, refetch, tasksMoved]);

  // v13.7.0: enroll this one lead from its own page (was Leads-list bulk only).
  const enroll = useEnrollInCadence({ leadIds: [leadId], onToast: toast, onDone: () => { refetch.journey(); tasksMoved(); } });

  const handleAddNote = useCallback((content) => {
    LeadsService.addNote(leadId, content).then(refetch.notes).catch(() => toast('Failed to save note', 'error'));
  }, [leadId, refetch]);
  const handleDeleteNote = useCallback((noteId) => {
    LeadsService.deleteNote(leadId, noteId).then(refetch.notes).catch(() => toast('Failed to delete note', 'error'));
  }, [leadId, refetch]);

  const handleSetOutcome = useCallback((status, notes = '') => {
    LeadsService.setOutcome(leadId, status, notes).then(refetch.lead).catch(() => toast('Failed to update outcome', 'error'));
  }, [leadId, refetch]);

  const handleOptOut = useCallback(() => setConfirmAction('optout'), []);

  const confirmOptOutLead = useCallback(async () => {
    setConfirmBusy(true);
    try {
      await LeadsService.updateLead(leadId, { do_not_contact: true });
      toast('Lead marked as opted out', 'success');
      refetch.lead();
    } catch (e) {
      toast(e.message || 'Failed to opt out lead', 'error');
    } finally {
      setConfirmBusy(false);
      setConfirmAction(null);
    }
  }, [leadId, refetch]);

  const confirmWrongNumber = useCallback(async () => {
    setConfirmBusy(true);
    try {
      await LeadsService.markPhoneInvalid(leadId);
      toast('Number marked as wrong — call and text steps will skip it', 'success');
      refetch.lead();
      refetch.activity();
      tasksMoved(); // open call reminders were closed
    } catch (e) {
      toast(e?.response?.data?.detail || e.message || 'Failed to mark the number as wrong', 'error');
    } finally {
      setConfirmBusy(false);
      setConfirmAction(null);
    }
  }, [leadId, refetch, tasksMoved]);

  // One dialog, config keyed by confirmAction — delete and opt-out are the
  // same shape (title/message/confirmLabel/onConfirm), never open together.
  const CONFIRM_DIALOGS = {
    delete: {
      title: 'Delete Lead',
      message: `Delete ${leadName}? It will be removed from Leads, Kanban, and reports immediately. Its calls, notes, and emails are kept, not destroyed.`,
      confirmLabel: 'Delete',
      onConfirm: confirmDeleteLead,
    },
    optout: {
      title: 'Mark Opted Out',
      message: `Mark ${leadName} as opted out? They'll be excluded from future calls and email campaigns.`,
      confirmLabel: 'Mark Opted Out',
      onConfirm: confirmOptOutLead,
    },
    wrongNumber: {
      title: 'Mark this number as wrong?',
      message: 'Call and text steps in cadences will be skipped; the lead stays active for email. You can fix the number any time.',
      confirmLabel: 'Mark wrong number',
      onConfirm: confirmWrongNumber,
    },
    // RCA 2026-09-29: legacy asks before overwriting research; React didn't.
    regenerate: {
      title: 'Regenerate research',
      message: 'Regenerate AI research? This will replace all current research with fresh AI content.',
      confirmLabel: 'Regenerate',
      confirmVariant: 'primary',
      onConfirm: () => { setConfirmAction(null); triggerResearch(true); },
    },
  };

  if (leadError) {
    return (
      <div className="p-8 text-center">
        {/* 404 = the lead doesn't exist OR the caller may not see it — the
            backend deliberately doesn't say which. */}
        <p className="text-red-600 font-semibold mb-2">
          {leadError?.response?.status === 404
            ? "This lead doesn't exist, or you don't have access to it."
            : "⚠️ Couldn't load this lead."}
        </p>
      </div>
    );
  }

  if (leadLoading && !lead) {
    return <LeadDetailSkeleton />;
  }

  return (
    <div className="leaddetailhub max-w-[1400px] mx-auto px-4 py-6 space-y-4">
      <LeadHeader
        lead={lead}
        navPosition={navPosition}
        onPreviousLead={onPreviousLead}
        onNextLead={onNextLead}
        onBack={onBack}
        onOptOut={handleOptOut}
        canModify={canModify}
        isAssignAdmin={canAdminModify}
        assignableUsers={assignableUsers}
        onReassign={handleReassign}
      />

      {lead.company_resolved?.resolved && !['Meeting Scheduled', '1st Discovery Meeting', 'Discovery Complete', 'Demo Scheduled', 'Demo Done', 'Completed'].includes(lead.status) && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-5 py-3.5 flex items-center gap-3">
          <span className="text-xl">⚡</span>
          <div className="text-sm text-amber-300">
            <p className="font-bold m-0 text-amber-200">Company Already Connected</p>
            <p className="m-0 mt-0.5 text-amber-300/80">
              A meeting has been booked with <strong className="text-amber-100">{lead.company_resolved.resolved_by}</strong>
              {lead.company_resolved.resolved_title && ` (${lead.company_resolved.resolved_title})`} at this company.
              {lead.company_resolved.resolved_at && ` · ${fmtDate(lead.company_resolved.resolved_at)}`}
            </p>
          </div>
        </div>
      )}

      <SalesStage lead={lead} />
      <NextBestAction action={nextAction} onExecute={handleExecuteAction} canModify={canModify} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div id="lead-detail-hub-contact" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <LeadSummary lead={lead} journey={journey} onJourneyChange={refetch.journey} />
            <ContactCard lead={lead} canModify={canModify} onCall={startCall} />
          </div>
          <EnrichmentCard lead={lead} />
          <PreCallIntelligence
            lead={lead}
            status={researchStatus}
            canModify={canModify}
            onResearch={triggerResearch}
            onRegenerate={() => setConfirmAction('regenerate')}
          />
          <ActivityTimeline
            activities={activities}
            filter={activityFilter}
            onFilterChange={setActivityFilter}
            loading={callsLoading}
            error={callsError}
            hasMore={hasMoreActivities}
            onLoadMore={loadMoreActivities}
            onOpenClassicTab={handleOpenClassicTab}
          />
          <EmailsPanel emails={emails} loading={emailsLoading} error={!!emailsError} onOpen={(emailId) => setEmailView({ emailId, mode: 'thread' })} />
          <TasksPanel
            tasks={tasks}
            canModify={canModify}
            loading={tasksLoading}
            onAdd={handleAddTask}
            onComplete={handleCompleteTask}
            onDelete={handleDeleteTask}
            onOutcome={handleTaskOutcome}
            onSendEmail={handleTaskSendEmail}
            onSendSms={handleTaskSendSms}
            onSkip={handleSkipTask}
          />
        </div>

        <div className="space-y-4">
          <QuickActions
            canModify={canModify}
            canDelete={canAdminModify}
            canSkipStages={isAdmin}
            hasNoPhone={!((lead.phone || '').trim()) && !((lead.phone_secondary || '').trim()) && !((lead.company_phone || '').trim())}
            hasPhone={!!(lead.phone || '').trim()}
            phoneInvalid={!!lead.phone_invalid_at}
            onWrongNumber={() => setConfirmAction('wrongNumber')}
            onCall={() => startCall()}
            onEmail={() => setEmailView({ emailId: null, mode: 'compose' })}
            onEnroll={enroll.start}
            canMessage={!!window._canMessageLeads?.()}
            onMessage={() => window._openMessagingWidget?.(
              lead.id, leadName, lead.phone || lead.phone_secondary || lead.company_phone || '', lead
            )}
            onAddTask={() => document.getElementById('lead-detail-hub-tasks')?.scrollIntoView({ behavior: 'smooth' })}
            onAddNote={() => document.getElementById('lead-detail-hub-notes')?.scrollIntoView({ behavior: 'smooth' })}
            currentStatus={lead.status}
            onChangeStage={handleChangeStage}
            onOptOut={handleOptOut}
            onDelete={handleDelete}
            showDisqualify={showDisqualify}
            onShowDisqualifyChange={setShowDisqualify}
            onDisqualify={handleDisqualify}
          />
          <CallStrategy lead={lead} />
          <div id="lead-detail-hub-notes">
            <NotesPanel notes={notes} canModify={canModify} loading={notesLoading} onAdd={handleAddNote} onDelete={handleDeleteNote} />
          </div>
          <div id="lead-detail-hub-opportunity">
            <RelatedOpportunity
              opportunities={opportunities}
              canSetOutcome={canAdminModify}
              onSetOutcome={handleSetOutcome}
            />
          </div>
          <StatusHistory activities={activities} loading={historyLoading} />
        </div>
      </div>
      <div id="lead-detail-hub-tasks" />

      {confirmAction && (
        <ConfirmDialog
          open
          onClose={() => setConfirmAction(null)}
          confirmVariant="danger"
          loading={confirmBusy}
          {...CONFIRM_DIALOGS[confirmAction]}
        />
      )}
      {emailView && (
        <Modal open onClose={closeEmailView} title={`Emails · ${leadName}`} maxWidth="max-w-6xl">
          <div className="h-[70vh]">
            <EmailHub
              leadId={leadId}
              lead={lead}
              token={getToken()}
              apiBase={window.__CRM_API_BASE__}
              initialEmailId={emailView.emailId}
              initialMode={emailView.mode}
            />
          </div>
        </Modal>
      )}
      {enroll.dialog}
    </div>
  );
}
