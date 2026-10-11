import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, Building2, AlertTriangle, MessageSquarePlus, UserX,
  SlidersHorizontal, CalendarPlus, Phone, TriangleAlert, Milestone as MilestoneIcon,
} from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { StageSelect } from '../../components/ui/StageSelect';
import { Switch } from '../../components/ui/Switch';
import { Checkbox } from '../../components/ui/Checkbox';
import { Select } from '../../components/ui/Select';
import { DatePicker } from '../../components/ui/DatePicker';
import { SkeletonCard, SkeletonText } from '../../components/ui/Skeleton';
import { CsmPortalService, CallsService } from '../../services/api';
import { getCurrentUser } from '../../services/auth';
import { tierVariant, formatMoney, formatDate, formatDateTime } from './utils';
import { AccountDetailTour } from './AccountDetailTour';

const TIER_OPTIONS = ['Critical', 'At Risk', 'Healthy'];
const STAKEHOLDER_ROLE_OPTIONS = [
  { value: '', label: 'No role' },
  { value: 'POC', label: 'POC' },
  { value: 'Billing', label: 'Billing' },
  { value: 'Champion', label: 'Champion' },
  { value: 'Decision Maker', label: 'Decision Maker' },
];
const MILESTONE_TYPE_OPTIONS = [
  { value: 'Onboarding', label: 'Onboarding' },
  { value: 'Go-Live', label: 'Go-Live' },
  { value: 'QBR', label: 'QBR' },
  { value: 'Renewal', label: 'Renewal' },
  { value: 'Custom', label: 'Custom' },
];
const EMPTY_MILESTONE_FORM = {
  milestone_type: 'QBR', label: '', milestone_date: '',
  ae_name: '', use_cases: '', cs_name: '', summary: '', action_items: '', poc_stakeholder_ids: [],
};

/** Account 360 — header, health score (with the partial-data footnote),
 * Renewal & QBR, Handover summary (gap #2 fallback copy when no brief),
 * call history, activity timeline, and the 4 action buttons. */
export function AccountDetail({ accountId, onBack }) {
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [touchModalOpen, setTouchModalOpen] = useState(false);
  const [touchNote, setTouchNote] = useState('');

  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideTier, setOverrideTier] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  const [renewalModalOpen, setRenewalModalOpen] = useState(false);
  const [renewalAmount, setRenewalAmount] = useState('');
  const [renewalCloseDate, setRenewalCloseDate] = useState('');

  // Manage (update/close) an open opportunity without opening Salesforce —
  // the CSM Portal counterpart to AE Pipeline's own "Update deal"/"Close deal".
  const [manageOpp, setManageOpp] = useState(null); // the opportunity object, or null
  const [manageError, setManageError] = useState(null);
  const [manageForm, setManageForm] = useState({
    stage_name: '', close_date: '', won: false,
    champion_name: '', champion_role: '', champion_contact: '', promises_made: '', handover_notes: '',
    standard_product_names: [], invoice_number: '', lost_reason: '',
  });

  const [stageOptions, setStageOptions] = useState([]); // [] = SF not configured, falls back to free text
  const [productOptions, setProductOptions] = useState([]); // this org's Standard_Product_Name__c picklist
  const [lostReasonOptions, setLostReasonOptions] = useState([]); // this org's Opportunity_Lost_Reason__c picklist

  // Log a call — CSM Portal's counterpart to AE Pipeline's own call log
  // (backend/routes/csm_portal_routes.py's log_account_opportunity_call).
  // A CSM has no Lead to call against; this logs the call against whichever
  // of the account's Opportunities is selected, same as the AE side.
  const [callOutcomes, setCallOutcomes] = useState([]);
  const [callOppId, setCallOppId] = useState(''); // '' = follow the default (first open opportunity)
  const [callForm, setCallForm] = useState({ outcome: '', notes: '' });
  const [callSubmitting, setCallSubmitting] = useState(false);
  const [callError, setCallError] = useState(null);

  // Engagement cadence timeline (item #8) — one modal doubles as "view
  // details" (click a timeline entry) and "log a new one", same as opening
  // an existing renewal opportunity vs. creating one.
  const [milestoneModalOpen, setMilestoneModalOpen] = useState(false);
  const [editingMilestoneId, setEditingMilestoneId] = useState(null); // null = creating new
  const [milestoneForm, setMilestoneForm] = useState(EMPTY_MILESTONE_FORM);
  const [milestoneError, setMilestoneError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    return CsmPortalService.getAccount(accountId)
      .then((res) => setData(res))
      .catch(() => setError('Failed to load this account.'));
  }, [accountId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { CsmPortalService.getStageOptions().then(setStageOptions); }, []);
  useEffect(() => {
    CallsService.getCallOutcomes().then((res) => setCallOutcomes(res?.enabled_outcomes || [])).catch(() => setCallOutcomes([]));
  }, []);
  useEffect(() => {
    CsmPortalService.getCloseFieldOptions().then((r) => {
      setProductOptions(r?.standard_product_names || []);
      setLostReasonOptions(r?.lost_reasons || []);
    });
  }, []);

  const backLink = (
    <Button variant="ghost" size="sm" onClick={onBack} className="mb-4">
      <ArrowLeft size={14} /> Back
    </Button>
  );

  if (error) {
    return (
      <div className="p-6">
        {backLink}
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        {backLink}
        <SkeletonCard><SkeletonText lines={6} /></SkeletonCard>
      </div>
    );
  }

  const { account, opportunities, closing_brief, closing_brief_reason, opportunity_calls, activities, health, stakeholders, milestones } = data;

  // Mirrors csm_portal_routes._require_account_write_access. Admins can open
  // any CSM's account (bulk-assign needs that), but logging a touch here is
  // not neutral: the first touch LOCKS the AE's closing brief and refreshes
  // the relationship half of the health score. Health override is deliberately
  // NOT gated — the plan specifies it as a Super Admin escape hatch.
  const me = getCurrentUser();
  const writable = !!me && (!account.assigned_csm_id || account.assigned_csm_id === me.sub);
  const openOpportunities = opportunities.filter((o) => !o.is_closed);
  // Call log defaults to the first open opportunity (falls back to the
  // first one at all) until the CSM picks a different one themselves.
  const effectiveCallOppId = callOppId || openOpportunities[0]?.id || opportunities[0]?.id || '';

  const runAction = async (fn) => {
    setBusy(true);
    try { await fn(); await load(); } finally { setBusy(false); }
  };

  const submitTouch = () => {
    if (!touchNote.trim()) return;
    runAction(() => CsmPortalService.logTouch(accountId, touchNote.trim())).then(() => {
      setTouchNote('');
      setTouchModalOpen(false);
    });
  };

  const markChampionDeparted = () => runAction(() => CsmPortalService.championDeparted(accountId));

  const submitCall = async (e) => {
    e.preventDefault();
    if (!callForm.outcome) return;
    setCallSubmitting(true);
    setCallError(null);
    try {
      if (effectiveCallOppId) {
        await CsmPortalService.logOpportunityCall(accountId, effectiveCallOppId, callForm.outcome, callForm.notes);
      } else {
        // No Opportunity on this account yet — log against the activity
        // timeline instead of blocking the call log entirely.
        const note = callForm.notes ? `${callForm.outcome}: ${callForm.notes}` : callForm.outcome;
        await CsmPortalService.logTouch(accountId, note);
      }
      setCallForm({ outcome: '', notes: '' });
      await load();
    } catch (err) {
      setCallError(err.response?.data?.detail || err.message || 'Failed to log this call.');
    } finally {
      setCallSubmitting(false);
    }
  };

  const submitOverride = (clear) => {
    const reason = clear ? (overrideReason || 'Override cleared') : overrideReason;
    runAction(() => CsmPortalService.setHealthOverride(accountId, clear ? null : overrideTier, reason)).then(() => {
      setOverrideModalOpen(false);
      setOverrideTier('');
      setOverrideReason('');
    });
  };

  const setStakeholderRole = (stakeholderId, role) =>
    runAction(() => CsmPortalService.setStakeholderRole(accountId, stakeholderId, role || null));

  const openNewMilestone = () => {
    setEditingMilestoneId(null);
    setMilestoneForm(EMPTY_MILESTONE_FORM);
    setMilestoneError(null);
    setMilestoneModalOpen(true);
  };

  const openMilestone = (m) => {
    setEditingMilestoneId(m.id);
    setMilestoneForm({
      milestone_type: m.milestone_type, label: m.label, milestone_date: (m.milestone_date || '').slice(0, 10),
      ae_name: m.ae_name || '', use_cases: m.use_cases || '', cs_name: m.cs_name || '',
      summary: m.summary || '', action_items: m.action_items || '', poc_stakeholder_ids: m.poc_stakeholder_ids || [],
    });
    setMilestoneError(null);
    setMilestoneModalOpen(true);
  };

  const submitMilestone = async () => {
    if (!milestoneForm.label.trim() || !milestoneForm.milestone_date) return;
    setBusy(true);
    setMilestoneError(null);
    try {
      const body = { ...milestoneForm, label: milestoneForm.label.trim() };
      if (editingMilestoneId) {
        await CsmPortalService.updateMilestone(accountId, editingMilestoneId, body);
      } else {
        await CsmPortalService.createMilestone(accountId, body);
      }
      await load();
      setMilestoneModalOpen(false);
    } catch (err) {
      setMilestoneError(err.response?.data?.detail || err.message || 'Failed to save this milestone.');
    } finally {
      setBusy(false);
    }
  };

  const submitRenewal = () => {
    runAction(() => CsmPortalService.createRenewalOpportunity(accountId, {
      amount: renewalAmount ? Number(renewalAmount) : undefined,
      closeDate: renewalCloseDate || undefined,
    })).then(() => {
      setRenewalModalOpen(false);
      setRenewalAmount('');
      setRenewalCloseDate('');
    });
  };

  const openManage = (opp) => {
    setManageOpp(opp);
    setManageError(null);
    setManageForm({
      stage_name: opp.stage_name || '', close_date: (opp.close_date || '').slice(0, 10), won: false,
      champion_name: '', champion_role: '', champion_contact: '', promises_made: '', handover_notes: '',
      standard_product_names: [], invoice_number: '', lost_reason: '',
    });
  };

  const submitManageUpdate = async () => {
    setBusy(true);
    setManageError(null);
    try {
      await CsmPortalService.updateOpportunity(accountId, manageOpp.id, {
        stageName: manageForm.stage_name || undefined, closeDate: manageForm.close_date || undefined,
      });
      await load();
      setManageOpp(null);
    } catch (err) {
      setManageError(err.response?.data?.detail || err.message || 'Failed to update this opportunity.');
    } finally {
      setBusy(false);
    }
  };

  const submitManageClose = async () => {
    // Live finding, 2026-09-15: a synced deal will fail to push without
    // these — collect them upfront rather than let the push fail silently
    // in the background with no chance for the CSM to fix it here.
    if (manageOpp.sf_opportunity_id && (!manageForm.standard_product_names.length || !manageForm.invoice_number
        || (!manageForm.won && !manageForm.lost_reason))) {
      setManageError('Standard product(s), invoice number' + (manageForm.won ? '' : ', and lost reason') + ' are required to close a Salesforce-synced deal.');
      return;
    }
    setBusy(true);
    setManageError(null);
    try {
      await CsmPortalService.closeOpportunity(accountId, manageOpp.id, {
        won: manageForm.won, close_date: manageForm.close_date,
        champion_name: manageForm.champion_name || undefined,
        champion_role: manageForm.champion_role || undefined,
        champion_contact: manageForm.champion_contact || undefined,
        promises_made: manageForm.promises_made || undefined,
        handover_notes: manageForm.handover_notes || undefined,
        standard_product_names: manageForm.standard_product_names.length ? manageForm.standard_product_names : undefined,
        invoice_number: manageForm.invoice_number || undefined,
        lost_reason: manageForm.lost_reason || undefined,
      });
      await load();
      setManageOpp(null);
    } catch (err) {
      setManageError(err.response?.data?.detail || err.message || 'Failed to close this deal.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AccountDetailTour />
      {backLink}

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 m-0 flex items-center gap-2">
            <Building2 size={18} className="text-slate-400" /> {account.name}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {account.industry || 'Industry unknown'} · CSM: {account.assigned_csm_name || 'Unassigned'}
          </p>
          {!writable && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 mb-0">
              Read-only — assigned to {account.assigned_csm_name || 'another CSM'}. Logging a touch
              here would lock their handover brief and count as their outreach. Health override is
              still available below.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap" data-tour="csm-portal-account-actions">
          {writable && (
            <>
              <Button variant="outline" size="sm" onClick={() => setTouchModalOpen(true)} disabled={busy}>
                <MessageSquarePlus size={14} /> Log touch
              </Button>
              <Button variant="outline" size="sm" onClick={markChampionDeparted} disabled={!closing_brief || busy}>
                <UserX size={14} /> Champion departed
              </Button>
              <Button variant="outline" size="sm" onClick={() => setRenewalModalOpen(true)} disabled={busy}>
                <CalendarPlus size={14} /> New renewal opp
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Health */}
      <Card className="mb-5">
        <CardHeader
          title="Health score"
          actions={
            <Button
              variant="ghost" size="sm" disabled={busy}
              onClick={() => { setOverrideTier(health.displayed_tier); setOverrideReason(''); setOverrideModalOpen(true); }}
            >
              <SlidersHorizontal size={14} /> Override
            </Button>
          }
        />
        <CardContent>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="text-3xl font-extrabold text-slate-800 tabular-nums">{health.score}</span>
            <Badge variant={tierVariant(health.displayed_tier)}>{health.displayed_tier}</Badge>
            {health.displayed_tier !== health.tier && (
              <span className="text-xs text-slate-400">(computed: {health.tier} — overridden)</span>
            )}
          </div>
          {/* Rendered from whatever factors the backend actually returned —
              hardcoding commercial/relationship here meant a newly added
              factor (csm_health.py's _FACTOR_WEIGHTS) would silently not
              show up, despite the score already including it. */}
          <div className="flex gap-4 text-xs text-slate-500 mb-2 flex-wrap">
            {Object.entries(health.factors || {}).map(([name, value]) => (
              <span key={name} className="capitalize">{name}: {value}</span>
            ))}
          </div>
          {health.partial && (
            <p className="text-xs text-amber-600 m-0 flex items-center gap-1">
              <AlertTriangle size={12} /> {health.partial_label}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Engagement cadence timeline — CSM feedback item #8. Portal-native
          (no SF object backs this, see AccountMilestone's doc comment).
          Click an entry to see its details (OB: AE/use cases/POCs, QBR:
          CS/summary/action items) and to edit it. */}
      <Card className="mb-5">
        <CardHeader
          title="Engagement timeline"
          subtitle="Onboarding, Go-Live, QBRs, Renewal — click an entry for details"
          actions={writable && (
            <Button variant="outline" size="sm" onClick={openNewMilestone} disabled={busy}>
              <MilestoneIcon size={14} /> Log milestone
            </Button>
          )}
        />
        <CardContent>
          {milestones && milestones.length ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {milestones.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => openMilestone(m)}
                  className="shrink-0 text-left px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer min-w-[140px]"
                >
                  <Badge variant="info">{m.milestone_type}</Badge>
                  <p className="text-sm font-semibold text-slate-700 mt-1 mb-0">{m.label}</p>
                  <p className="text-xs text-slate-400 m-0">{formatDate(m.milestone_date)}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 m-0">No milestones logged yet.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Renewal & QBR */}
        <Card>
          <CardHeader title="Renewal & QBR" subtitle="Open opportunities on this account" />
          <CardContent>
            {openOpportunities.length ? (
              <div className="space-y-2">
                {openOpportunities.map((o) => (
                  <div key={o.id} className="flex items-center justify-between text-sm gap-2">
                    <div className="min-w-0">
                      <span className="text-slate-700">{o.name || 'Opportunity'}</span>
                      <span className="text-slate-500"> — {formatMoney(o.amount)} · {formatDate(o.close_date)}</span>
                      {o.stage_name && <Badge variant="info" className="ml-2">{o.stage_name}</Badge>}
                      {o.sf_push_status === 'failed' && (
                        <TriangleAlert size={13} className="text-red-500 inline-block ml-2 align-text-bottom" title={o.sf_push_error || 'Not synced to Salesforce'} />
                      )}
                    </div>
                    {writable && <Button variant="ghost" size="sm" onClick={() => openManage(o)} disabled={busy}>Manage</Button>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 m-0">No open renewal opportunity — use "New renewal opp" above to create one.</p>
            )}
          </CardContent>
        </Card>

        {/* Handover summary — gap #2 fallback copy when nothing exists */}
        <Card>
          <CardHeader title="Handover summary" />
          <CardContent>
            {closing_brief ? (
              <div className="space-y-1 text-sm">
                <p className="m-0"><strong>Champion:</strong> {closing_brief.champion_name || '—'}{closing_brief.champion_role ? ` (${closing_brief.champion_role})` : ''}</p>
                <p className="m-0"><strong>Contact:</strong> {closing_brief.champion_contact || '—'}</p>
                {closing_brief.promises_made && <p className="m-0"><strong>Promises made:</strong> {closing_brief.promises_made}</p>}
                {closing_brief.handover_notes && <p className="m-0"><strong>Handover notes:</strong> {closing_brief.handover_notes}</p>}
                <p className="m-0 mt-2 flex items-center gap-2 flex-wrap">
                  <Badge variant={closing_brief.champion_active ? 'success' : 'danger'}>
                    {closing_brief.champion_active ? 'Champion active' : 'Champion departed'}
                  </Badge>
                  {closing_brief.locked && <span className="text-xs text-slate-400">Locked after first touch</span>}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-400 m-0">
                {closing_brief_reason === 'closed_before_handover_tracking'
                  ? 'Closed before handover tracking began.'
                  : 'No handover brief on file.'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stakeholder mapping — CSM feedback item #7. Synced from SF Contacts;
          role is a Alternate CRM-only tag (SF has no field for it, see
          AccountStakeholder's doc comment). "New" badge = SF CreatedDate
          within the last 14 days ("contact change alert"). */}
      <Card className="mb-5">
        <CardHeader title="Stakeholders" subtitle="Synced from Salesforce contacts — role is set here" />
        <CardContent>
          {stakeholders && stakeholders.length ? (
            <div className="space-y-2">
              {stakeholders.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 flex-wrap text-sm py-1">
                  <div className="min-w-0">
                    <span className="text-slate-700 font-medium">{s.name}</span>
                    {s.title && <span className="text-slate-500"> — {s.title}</span>}
                    {s.email && <span className="text-slate-400 text-xs block">{s.email}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {s.is_new && <Badge variant="info">New</Badge>}
                    {writable ? (
                      <Select
                        ariaLabel={`Role for ${s.name}`}
                        value={s.role || ''}
                        onChange={(v) => setStakeholderRole(s.id, v)}
                        options={STAKEHOLDER_ROLE_OPTIONS}
                        disabled={busy}
                      />
                    ) : (
                      s.role && <Badge>{s.role}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 m-0">No stakeholders synced from Salesforce yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Call history + log a call — CSM's counterpart to AE Pipeline's
          own call log; a CSM has no Lead to call against, so this attaches
          the call to whichever Opportunity on this account is selected. */}
      <Card className="mb-5" data-tour="csm-portal-call-log">
        <CardHeader
          title="Call history"
          subtitle={opportunities.length ? "Logged against this account's opportunities" : "No open opportunity yet — calls are logged to the activity timeline below"}
        />
        <CardContent className="space-y-2">
          {opportunity_calls.length ? (
            opportunity_calls.slice(0, 10).map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-sm flex-wrap">
                <Phone size={12} className="text-slate-300 shrink-0" />
                <Badge>{c.outcome}</Badge>
                <span className="text-slate-500 text-xs">{formatDateTime(c.called_at)}</span>
                {c.notes && <span className="text-slate-600">{c.notes}</span>}
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-400 m-0">No calls logged yet.</p>
          )}

          {writable && opportunities.length > 0 && (
            <form onSubmit={submitCall} className="mt-4 pt-4 border-t border-slate-100 space-y-3">
              <p className="text-sm font-semibold text-slate-700 m-0">Log a call</p>
              {opportunities.length > 1 && (
                <Select
                  ariaLabel="Opportunity"
                  value={effectiveCallOppId}
                  onChange={setCallOppId}
                  options={opportunities.map((o) => ({ value: o.id, label: o.name || 'Opportunity' }))}
                />
              )}
              <Select
                value={callForm.outcome}
                onChange={(v) => setCallForm((f) => ({ ...f, outcome: v }))}
                options={callOutcomes.map((o) => ({ value: o.value, label: o.value }))}
                placeholder="Select an outcome…"
                ariaLabel="Call outcome"
                className="w-full justify-between"
              />
              <textarea
                value={callForm.notes}
                onChange={(e) => setCallForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Notes (optional)"
                rows={2}
                className="w-full px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
              {callError && <p className="text-xs text-red-600 m-0">{callError}</p>}
              <Button type="submit" size="sm" disabled={callSubmitting || !callForm.outcome}>
                <Phone size={14} /> {callSubmitting ? 'Logging…' : 'Log call'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Activity timeline */}
      <Card>
        <CardHeader title="Activity timeline" subtitle="Most recent first" />
        <CardContent>
          {activities.length ? (
            <div className="space-y-2">
              {activities.map((a) => (
                <div key={a.id} className="flex items-start gap-2 text-sm">
                  <Badge variant="default" className="shrink-0">{a.kind}</Badge>
                  <div className="min-w-0">
                    {a.note && <p className="m-0 text-slate-700">{a.note}</p>}
                    <p className="m-0 text-xs text-slate-400">{formatDateTime(a.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 m-0">No activity logged yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Log touch */}
      <Modal open={touchModalOpen} onClose={() => setTouchModalOpen(false)} title="Log a touch">
        <label className="block text-sm font-medium text-slate-700 mb-1">Note</label>
        <textarea
          className="w-full px-3 py-2 rounded-lg text-sm border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none mb-4"
          rows={3}
          value={touchNote}
          onChange={(e) => setTouchNote(e.target.value)}
          placeholder="What did you do / discuss?"
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setTouchModalOpen(false)}>Cancel</Button>
          <Button onClick={submitTouch} disabled={busy || !touchNote.trim()}>Save</Button>
        </div>
      </Modal>

      {/* Health override — visibly labeled, never silently replaces the score above */}
      <Modal open={overrideModalOpen} onClose={() => setOverrideModalOpen(false)} title="Override health tier">
        <p className="text-xs text-slate-500 mb-3">
          This only changes what's <strong>displayed</strong> — the computed score stays visible either way.
        </p>
        <div className="flex gap-2 mb-3">
          {TIER_OPTIONS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setOverrideTier(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                overrideTier === t ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 bg-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <Input label="Reason" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Why override the computed tier?" />
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={() => submitOverride(true)} disabled={busy}>Clear override</Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setOverrideModalOpen(false)}>Cancel</Button>
            <Button onClick={() => submitOverride(false)} disabled={busy || !overrideTier || !overrideReason.trim()}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* New renewal opportunity */}
      <Modal open={renewalModalOpen} onClose={() => setRenewalModalOpen(false)} title="Create renewal opportunity">
        <Input label="Amount" type="number" value={renewalAmount} onChange={(e) => setRenewalAmount(e.target.value)} placeholder="e.g. 50000" />
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">Close date</label>
          <DatePicker value={renewalCloseDate} onChange={setRenewalCloseDate} ariaLabel="Close date" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRenewalModalOpen(false)}>Cancel</Button>
          <Button onClick={submitRenewal} disabled={busy}>Create</Button>
        </div>
      </Modal>

      {/* Manage an open opportunity — progress it or close it, without opening Salesforce */}
      <Modal open={!!manageOpp} onClose={() => setManageOpp(null)} title={manageOpp?.name || 'Manage opportunity'}>
        {manageOpp && (
          <div className="space-y-4">
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide m-0">Update</p>
              <StageSelect
                stageOptions={stageOptions}
                value={manageForm.stage_name}
                onChange={(v) => setManageForm((f) => ({ ...f, stage_name: v }))}
              />
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">Close date</label>
                <DatePicker
                  value={manageForm.close_date}
                  onChange={(v) => setManageForm((f) => ({ ...f, close_date: v }))}
                  ariaLabel="Close date"
                />
              </div>
              <Button variant="secondary" size="sm" onClick={submitManageUpdate} disabled={busy}>Save update</Button>
            </div>

            <div className="space-y-3 pt-3 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide m-0">Close this deal</p>
              <Switch
                checked={manageForm.won}
                onChange={(e) => setManageForm((f) => ({ ...f, won: e.target.checked }))}
                label={manageForm.won ? 'Won' : 'Lost'}
              />
              {manageOpp.sf_opportunity_id && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide m-0">Required for Salesforce to accept this close</p>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Standard product(s)</label>
                    <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 grid grid-cols-1 gap-1">
                      {productOptions.map((opt) => (
                        <Checkbox
                          key={opt.value}
                          label={opt.label}
                          checked={manageForm.standard_product_names.includes(opt.value)}
                          onChange={(e) => setManageForm((f) => ({
                            ...f,
                            standard_product_names: e.target.checked
                              ? [...f.standard_product_names, opt.value]
                              : f.standard_product_names.filter((v) => v !== opt.value),
                          }))}
                        />
                      ))}
                    </div>
                  </div>
                  <Input label="Invoice number" value={manageForm.invoice_number} onChange={(e) => setManageForm((f) => ({ ...f, invoice_number: e.target.value }))} />
                  {!manageForm.won && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Lost reason</label>
                      <Select
                        ariaLabel="Lost reason"
                        value={manageForm.lost_reason}
                        onChange={(v) => setManageForm((f) => ({ ...f, lost_reason: v }))}
                        options={lostReasonOptions}
                      />
                    </div>
                  )}
                </div>
              )}
              {manageForm.won && (
                <div className="space-y-3">
                  <Input label="Champion name" value={manageForm.champion_name} onChange={(e) => setManageForm((f) => ({ ...f, champion_name: e.target.value }))} />
                  <Input label="Champion role" value={manageForm.champion_role} onChange={(e) => setManageForm((f) => ({ ...f, champion_role: e.target.value }))} />
                  <Input label="Champion contact" value={manageForm.champion_contact} onChange={(e) => setManageForm((f) => ({ ...f, champion_contact: e.target.value }))} />
                  <Input label="Promises made" value={manageForm.promises_made} onChange={(e) => setManageForm((f) => ({ ...f, promises_made: e.target.value }))} />
                  <Input label="Handover notes" value={manageForm.handover_notes} onChange={(e) => setManageForm((f) => ({ ...f, handover_notes: e.target.value }))} />
                </div>
              )}
              {manageError && <p className="text-xs text-red-600 m-0">{manageError}</p>}
              <Button variant={manageForm.won ? 'primary' : 'danger'} size="sm" onClick={submitManageClose} disabled={busy || !manageForm.close_date}>
                Close as {manageForm.won ? 'Won' : 'Lost'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Engagement timeline — log or edit a milestone. Fields shown depend
          on milestone_type: Onboarding gets AE/use cases/POCs, QBR gets
          CS/summary/action items — everything else just gets a summary. */}
      <Modal
        open={milestoneModalOpen}
        onClose={() => setMilestoneModalOpen(false)}
        title={editingMilestoneId ? 'Milestone details' : 'Log a milestone'}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
            <Select
              ariaLabel="Milestone type"
              value={milestoneForm.milestone_type}
              onChange={(v) => setMilestoneForm((f) => ({ ...f, milestone_type: v }))}
              options={MILESTONE_TYPE_OPTIONS}
            />
          </div>
          <Input
            label="Label"
            value={milestoneForm.label}
            onChange={(e) => setMilestoneForm((f) => ({ ...f, label: e.target.value }))}
            placeholder="e.g. QBR 1, Go-Live"
          />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
            <DatePicker
              value={milestoneForm.milestone_date}
              onChange={(v) => setMilestoneForm((f) => ({ ...f, milestone_date: v }))}
              ariaLabel="Milestone date"
            />
          </div>

          {milestoneForm.milestone_type === 'Onboarding' && (
            <>
              <Input label="AE name" value={milestoneForm.ae_name} onChange={(e) => setMilestoneForm((f) => ({ ...f, ae_name: e.target.value }))} />
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Use cases</label>
                <textarea
                  value={milestoneForm.use_cases}
                  onChange={(e) => setMilestoneForm((f) => ({ ...f, use_cases: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              {stakeholders && stakeholders.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">POCs involved</label>
                  <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 grid grid-cols-1 gap-1">
                    {stakeholders.map((s) => (
                      <Checkbox
                        key={s.id}
                        label={s.name}
                        checked={milestoneForm.poc_stakeholder_ids.includes(s.id)}
                        onChange={(e) => setMilestoneForm((f) => ({
                          ...f,
                          poc_stakeholder_ids: e.target.checked
                            ? [...f.poc_stakeholder_ids, s.id]
                            : f.poc_stakeholder_ids.filter((id) => id !== s.id),
                        }))}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {milestoneForm.milestone_type === 'QBR' && (
            <>
              <Input label="CS name" value={milestoneForm.cs_name} onChange={(e) => setMilestoneForm((f) => ({ ...f, cs_name: e.target.value }))} />
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Summary</label>
                <textarea
                  value={milestoneForm.summary}
                  onChange={(e) => setMilestoneForm((f) => ({ ...f, summary: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Action items</label>
                <textarea
                  value={milestoneForm.action_items}
                  onChange={(e) => setMilestoneForm((f) => ({ ...f, action_items: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </>
          )}

          {!['Onboarding', 'QBR'].includes(milestoneForm.milestone_type) && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <textarea
                value={milestoneForm.summary}
                onChange={(e) => setMilestoneForm((f) => ({ ...f, summary: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          )}

          {milestoneError && <p className="text-xs text-red-600 m-0">{milestoneError}</p>}
          {!writable && <p className="text-xs text-slate-400 m-0">Read-only — assigned to another CSM.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMilestoneModalOpen(false)}>Cancel</Button>
            {writable && (
              <Button onClick={submitMilestone} disabled={busy || !milestoneForm.label.trim() || !milestoneForm.milestone_date}>
                Save
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
