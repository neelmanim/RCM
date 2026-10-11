import React, { useCallback, useEffect, useState } from 'react';
import { Briefcase, Phone, Handshake, TriangleAlert } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { StageSelect } from '../../components/ui/StageSelect';
import { Select } from '../../components/ui/Select';
import { Switch } from '../../components/ui/Switch';
import { Checkbox } from '../../components/ui/Checkbox';
import { Modal } from '../../components/ui/Modal';
import { DatePicker } from '../../components/ui/DatePicker';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../components/ui/Table';
import { SortableTableHeader } from '../../components/ui/SortableTableHeader';
import { useSort } from '../../utils/useSort';
import { EmptyState } from '../../components/ui/EmptyState';
import { DonutSummaryCard } from '../../components/ui/DonutSummaryCard';
import { SearchInput } from '../../components/ui/SearchInput';
import { Pagination } from '../../components/ui/Pagination';
import { SkeletonTable, SkeletonText } from '../../components/ui/Skeleton';
import { AEPipelineService, CallsService } from '../../services/api';
import { getCurrentUser } from '../../services/auth';
import { AEPipelineTour } from './AEPipelineTour';

/**
 * AE Pipeline — an AE's own Opportunities (pulled read-only from Salesforce,
 * see backend/salesforce.py's sync_opportunities_from_salesforce), plus the
 * "Close deal" action, which is the one write path: it flips is_closed/
 * is_won locally, captures a handover brief on a Won close, and pushes the
 * same stage fields back to Salesforce in the background (see
 * backend/routes/ae_pipeline_routes.py's close_opportunity).
 *
 * Visibility is entirely server-side (GET /api/ae-pipeline/opportunities):
 * an AE sees only opportunities they own, admins see all, SDR gets a 403.
 * Nothing is re-checked here — same trust boundary as SdrPerformanceHub.
 */
function formatCurrency(amount) {
  if (amount == null) return '—';
  return `$${Number(amount).toLocaleString()}`;
}

function formatDate(value) {
  if (!value) return '—';
  return value.slice(0, 10);
}

function stageBadge(opp) {
  if (opp.is_closed) return <Badge variant={opp.is_won ? 'success' : 'danger'}>{opp.is_won ? 'Closed Won' : 'Closed Lost'}</Badge>;
  return <Badge variant="info">{opp.stage_name || 'Open'}</Badge>;
}

function CallHistory({ calls }) {
  if (!calls || calls.length === 0) {
    return <p className="text-xs text-slate-400">No calls logged yet.</p>;
  }
  return (
    <div className="space-y-2">
      {calls.map((c) => (
        <div key={c.id} className="flex items-start justify-between gap-2 text-sm border-b border-slate-100 pb-2 last:border-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge>{c.outcome}</Badge>
              <span className="text-xs text-slate-400">{c.user_name || 'Unknown'}</span>
            </div>
            {c.notes && <p className="text-xs text-slate-500 mt-1">{c.notes}</p>}
          </div>
          <span className="text-xs text-slate-400 shrink-0">{formatDate(c.called_at)}</span>
        </div>
      ))}
    </div>
  );
}

const PER_PAGE = 15;
const STAGE_FILTER_OPTIONS = [
  { value: 'all', label: 'All stages' },
  { value: 'open', label: 'Open' },
  { value: 'won', label: 'Closed Won' },
  { value: 'lost', label: 'Closed Lost' },
];

const EMPTY_CALL_FORM = { outcome: '', notes: '' };
const EMPTY_CLOSE_FORM = {
  won: false, close_date: '', champion_name: '', champion_role: '',
  champion_contact: '', promises_made: '', handover_notes: '',
  standard_product_names: [], invoice_number: '', lost_reason: '',
};

/** Mirrors ae_pipeline_routes._require_write_access. Admins can open any AE's
 *  deal (oversight), but the write forms are the owner's — so hide them here
 *  rather than let the click come back a 403 with no explanation. An unowned
 *  deal stays actionable: a plain AE never sees one (the list query filters to
 *  owner == self), so in practice that branch is the admin closing out a
 *  departed rep's pipeline. */
function canWriteTo(detail) {
  const me = getCurrentUser();
  if (!me) return false;
  return !detail.owner_user_id || detail.owner_user_id === me.sub;
}

function OpportunityDrawer({ opportunityId, onClose, onChanged }) {
  const [detail, setDetail] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [outcomes, setOutcomes] = useState([]);
  const [stageOptions, setStageOptions] = useState([]); // [] = SF not configured, falls back to free text
  const [productOptions, setProductOptions] = useState([]); // this org's Standard_Product_Name__c picklist
  const [lostReasonOptions, setLostReasonOptions] = useState([]); // this org's Opportunity_Lost_Reason__c picklist

  const [callForm, setCallForm] = useState(EMPTY_CALL_FORM);
  const [callSubmitting, setCallSubmitting] = useState(false);
  const [callError, setCallError] = useState(null);

  const [closeForm, setCloseForm] = useState(EMPTY_CLOSE_FORM);
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [closeError, setCloseError] = useState(null);

  const [updateForm, setUpdateForm] = useState({ stage_name: '', close_date: '' });
  const [updateSubmitting, setUpdateSubmitting] = useState(false);
  const [updateError, setUpdateError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await AEPipelineService.get(opportunityId);
      setDetail(data);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to load this opportunity.');
    }
  }, [opportunityId]);

  useEffect(() => {
    setDetail(null);
    setCallForm(EMPTY_CALL_FORM);
    setCloseForm(EMPTY_CLOSE_FORM);
    setCallError(null);
    setCloseError(null);
    setUpdateError(null);
    load();
    CallsService.getCallOutcomes().then((res) => setOutcomes(res?.enabled_outcomes || [])).catch(() => setOutcomes([]));
    AEPipelineService.getStageOptions().then(setStageOptions);
    AEPipelineService.getCloseFieldOptions().then((r) => {
      setProductOptions(r?.standard_product_names || []);
      setLostReasonOptions(r?.lost_reasons || []);
    });
  }, [opportunityId, load]);

  // Prefill the update form once the detail loads, so it starts at the
  // opportunity's current stage/close date rather than blank.
  useEffect(() => {
    if (detail) setUpdateForm({ stage_name: detail.stage_name || '', close_date: (detail.close_date || '').slice(0, 10) });
  }, [detail]);

  const submitUpdate = async (e) => {
    e.preventDefault();
    setUpdateSubmitting(true);
    setUpdateError(null);
    try {
      await AEPipelineService.updateOpportunity(opportunityId, {
        stageName: updateForm.stage_name || undefined,
        closeDate: updateForm.close_date || undefined,
      });
      await load();
      onChanged();
    } catch (err) {
      setUpdateError(err.response?.data?.detail || err.message || 'Failed to update this opportunity.');
    } finally {
      setUpdateSubmitting(false);
    }
  };

  const submitCall = async (e) => {
    e.preventDefault();
    if (!callForm.outcome) return;
    setCallSubmitting(true);
    setCallError(null);
    try {
      await AEPipelineService.logCall(opportunityId, callForm.outcome, callForm.notes);
      setCallForm(EMPTY_CALL_FORM);
      await load();
      onChanged();
    } catch (err) {
      setCallError(err.response?.data?.detail || err.message || 'Failed to log this call.');
    } finally {
      setCallSubmitting(false);
    }
  };

  const submitClose = async (e) => {
    e.preventDefault();
    if (!closeForm.close_date) { setCloseError('Close date is required.'); return; }
    // Live finding, 2026-09-15: a synced deal will fail to push without
    // these — collect them upfront rather than let the push fail silently
    // in the background with no chance for the AE to fix it here.
    if (detail?.sf_opportunity_id && (!closeForm.standard_product_names.length || !closeForm.invoice_number
        || (!closeForm.won && !closeForm.lost_reason))) {
      setCloseError('Standard product(s), invoice number' + (closeForm.won ? '' : ', and lost reason') + ' are required to close a Salesforce-synced deal.');
      return;
    }
    setCloseSubmitting(true);
    setCloseError(null);
    try {
      await AEPipelineService.closeDeal(opportunityId, closeForm);
      await load();
      onChanged();
    } catch (err) {
      setCloseError(err.response?.data?.detail || err.message || 'Failed to close this deal.');
    } finally {
      setCloseSubmitting(false);
    }
  };

  const writable = detail ? canWriteTo(detail) : false;

  return (
    <Modal open onClose={onClose} title={detail?.name || detail?.account?.name || 'Opportunity'} position="right" maxWidth="max-w-lg">
      {error && (
        <EmptyState icon={TriangleAlert} title="Couldn't load this opportunity" message={error} />
      )}

      {!error && !detail && <SkeletonText lines={8} />}

      {!error && detail && (
        <div className="space-y-6">
          {!writable && (
            <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <TriangleAlert size={14} className="shrink-0 mt-0.5" />
              <span>
                Read-only — this deal belongs to {detail.owner_name || 'another AE'}. Closing it or
                logging a call here would be recorded as their work. Reassign the owner first if you
                need to act on it.
              </span>
            </div>
          )}
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {stageBadge(detail)}
              {detail.sf_push_status === 'failed' && (
                <Badge variant="danger" title={detail.sf_push_error || 'Salesforce did not accept the last update'}>
                  <TriangleAlert size={11} /> Not synced to Salesforce
                </Badge>
              )}
            </div>
            <p className="text-sm text-slate-600 m-0">
              {detail.account?.name || 'No account'} · {formatCurrency(detail.amount)} · Closes {formatDate(detail.close_date)}
            </p>
          </div>

          {detail.closing_brief && (
            <Card>
              <CardHeader title="Closing brief" subtitle={detail.closing_brief.locked ? 'Locked by CSM' : 'Editable until a CSM logs their first touch'} />
              <CardContent className="space-y-1.5 text-sm">
                <p className="m-0"><strong>Champion:</strong> {detail.closing_brief.champion_name || '—'} {detail.closing_brief.champion_role ? `(${detail.closing_brief.champion_role})` : ''}</p>
                <p className="m-0"><strong>Contact:</strong> {detail.closing_brief.champion_contact || '—'}</p>
                <p className="m-0"><strong>Promises made:</strong> {detail.closing_brief.promises_made || '—'}</p>
                <p className="m-0"><strong>Handover notes:</strong> {detail.closing_brief.handover_notes || '—'}</p>
              </CardContent>
            </Card>
          )}

          {!detail.is_closed && writable && (
            <Card data-tour="ae-pipeline-update-stage">
              <CardHeader title="Update deal" subtitle="Progress the stage or push out the close date — no need to open Salesforce" />
              <CardContent>
                <form onSubmit={submitUpdate} className="space-y-3">
                  <StageSelect
                    stageOptions={stageOptions}
                    value={updateForm.stage_name}
                    onChange={(v) => setUpdateForm((f) => ({ ...f, stage_name: v }))}
                  />
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Close date</label>
                    <DatePicker
                      value={updateForm.close_date}
                      onChange={(v) => setUpdateForm((f) => ({ ...f, close_date: v }))}
                      ariaLabel="Close date"
                    />
                  </div>
                  {updateError && <p className="text-xs text-red-600 m-0">{updateError}</p>}
                  <Button type="submit" variant="secondary" size="sm" disabled={updateSubmitting}>
                    {updateSubmitting ? 'Saving…' : 'Save'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          <Card data-tour="ae-pipeline-log-call">
            <CardHeader title="Call history" subtitle="Most recent first" />
            <CardContent>
              <CallHistory calls={detail.calls} />
              {/* History stays readable for oversight; only the form is gated —
                  a logged call feeds the AE leaderboard under the owner's name. */}
              {writable && (
              <form onSubmit={submitCall} className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                <p className="text-sm font-semibold text-slate-700 m-0">Log a call</p>
                <Select
                  value={callForm.outcome}
                  onChange={(v) => setCallForm((f) => ({ ...f, outcome: v }))}
                  options={outcomes.map((o) => ({ value: o.value, label: o.value }))}
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

          {!detail.is_closed && writable && (
            <Card data-tour="ae-pipeline-close-deal">
              <CardHeader title="Close deal" />
              <CardContent>
                <form onSubmit={submitClose} className="space-y-3">
                  <Switch
                    checked={closeForm.won}
                    onChange={(e) => setCloseForm((f) => ({ ...f, won: e.target.checked }))}
                    label={closeForm.won ? 'Won' : 'Lost'}
                    hint="Toggle on for a Won deal — reveals the handover brief fields."
                  />
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Close date</label>
                    <DatePicker
                      value={closeForm.close_date}
                      onChange={(v) => setCloseForm((f) => ({ ...f, close_date: v }))}
                      ariaLabel="Close date"
                    />
                  </div>
                  {detail.sf_opportunity_id && (
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide m-0">Required for Salesforce to accept this close</p>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Standard product(s)</label>
                        <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 grid grid-cols-1 gap-1">
                          {productOptions.map((opt) => (
                            <Checkbox
                              key={opt.value}
                              label={opt.label}
                              checked={closeForm.standard_product_names.includes(opt.value)}
                              onChange={(e) => setCloseForm((f) => ({
                                ...f,
                                standard_product_names: e.target.checked
                                  ? [...f.standard_product_names, opt.value]
                                  : f.standard_product_names.filter((v) => v !== opt.value),
                              }))}
                            />
                          ))}
                        </div>
                      </div>
                      <Input
                        label="Invoice number"
                        value={closeForm.invoice_number}
                        onChange={(e) => setCloseForm((f) => ({ ...f, invoice_number: e.target.value }))}
                      />
                      {!closeForm.won && (
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Lost reason</label>
                          <Select
                            ariaLabel="Lost reason"
                            value={closeForm.lost_reason}
                            onChange={(v) => setCloseForm((f) => ({ ...f, lost_reason: v }))}
                            options={lostReasonOptions}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {closeForm.won && (
                    <div className="space-y-3 pt-2 border-t border-slate-100">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide m-0">Handover brief — for the CSM</p>
                      <Input
                        label="Champion name"
                        value={closeForm.champion_name}
                        onChange={(e) => setCloseForm((f) => ({ ...f, champion_name: e.target.value }))}
                        required={closeForm.won}
                      />
                      <Input
                        label="Champion role"
                        value={closeForm.champion_role}
                        onChange={(e) => setCloseForm((f) => ({ ...f, champion_role: e.target.value }))}
                        required={closeForm.won}
                      />
                      <Input
                        label="Champion contact"
                        value={closeForm.champion_contact}
                        onChange={(e) => setCloseForm((f) => ({ ...f, champion_contact: e.target.value }))}
                        required={closeForm.won}
                      />
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Promises made</label>
                        <textarea
                          value={closeForm.promises_made}
                          onChange={(e) => setCloseForm((f) => ({ ...f, promises_made: e.target.value }))}
                          required={closeForm.won}
                          rows={2}
                          className="w-full px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Handover notes</label>
                        <textarea
                          value={closeForm.handover_notes}
                          onChange={(e) => setCloseForm((f) => ({ ...f, handover_notes: e.target.value }))}
                          required={closeForm.won}
                          rows={2}
                          className="w-full px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                    </div>
                  )}
                  {closeError && <p className="text-xs text-red-600 m-0">{closeError}</p>}
                  <Button type="submit" variant={closeForm.won ? 'primary' : 'danger'} disabled={closeSubmitting}>
                    <Handshake size={14} /> {closeSubmitting ? 'Closing…' : `Close as ${closeForm.won ? 'Won' : 'Lost'}`}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Won / Lost / Still open, off is_closed+is_won — the two standard SF fields
 *  the rest of this file already trusts over the org's custom StageName
 *  picklist. Counts, not amounts: DonutSummaryCard renders a segment's raw
 *  value in the centre, so currency would come out as an unformatted
 *  "120000". The pipeline value goes in the subtitle instead, where it can
 *  be formatted. */
function PerformanceDonut({ opportunities }) {
  const won = opportunities.filter((o) => o.is_closed && o.is_won).length;
  const lost = opportunities.filter((o) => o.is_closed && !o.is_won).length;
  // One scan, reused for both the count and the value — these were two
  // separate passes with the same predicate.
  const openOpps = opportunities.filter((o) => !o.is_closed);
  const openValue = openOpps.reduce((sum, o) => sum + (o.amount || 0), 0);

  const segments = [
    { label: 'Won', value: won, color: '#16a34a' },
    { label: 'Lost', value: lost, color: '#dc2626' },
    { label: 'Open', value: openOpps.length, color: '#2563eb' },
  ];

  return (
    <DonutSummaryCard
      title="Deal performance"
      subtitle={`${formatCurrency(openValue)} still open across ${openOpps.length} deal(s)`}
      segments={segments}
      size={140}
      strokeWidth={18}
      className="mb-6"
    />
  );
}

export function AEPipelineHub() {
  const [opportunities, setOpportunities] = useState(null); // null = loading
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [sort, toggleSort] = useSort();
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    AEPipelineService.list().then((data) => setOpportunities(Array.isArray(data) ? data : []));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, stageFilter, ownerFilter, sort]);

  const loading = opportunities === null;

  // Owner filter only makes sense once more than one owner shows up in the
  // list — a plain AE's own list is already scoped server-side to just them.
  const ownerOptions = loading ? [] : [...new Set(opportunities.map((o) => o.owner_name).filter(Boolean))]
    .sort()
    .map((name) => ({ value: name, label: name }));

  const q = search.trim().toLowerCase();
  const filtered = loading ? [] : opportunities.filter((o) => {
    if (stageFilter === 'open' && o.is_closed) return false;
    if (stageFilter === 'won' && !(o.is_closed && o.is_won)) return false;
    if (stageFilter === 'lost' && !(o.is_closed && !o.is_won)) return false;
    if (ownerFilter !== 'all' && o.owner_name !== ownerFilter) return false;
    if (q && !(o.account_name?.toLowerCase().includes(q) || o.name?.toLowerCase().includes(q))) return false;
    return true;
  });
  const SORT_ACCESSORS = {
    account: (o) => (o.account_name || o.name || '').toLowerCase(),
    ae: (o) => (o.owner_name || '').toLowerCase(),
    amount: (o) => o.amount || 0,
    close_date: (o) => o.close_date || '',
  };
  const sorted = sort.key ? [...filtered].sort((a, b) => {
    const av = SORT_ACCESSORS[sort.key](a), bv = SORT_ACCESSORS[sort.key](b);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sort.dir === 'desc' ? -cmp : cmp;
  }) : filtered;
  const totalPages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const pageOpportunities = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div className="ae-pipeline-hub min-h-full bg-slate-50 px-6 py-6 max-w-5xl mx-auto">
      <AEPipelineTour />

      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900 m-0 flex items-center gap-2">
          <Briefcase size={20} className="text-slate-400" /> AE Pipeline
        </h1>
        {/* Was "Your open Opportunities" — but the list has always included
            closed ones (the table's own Closed Won badges prove it), and for
            an admin they aren't "yours" at all. */}
        <p className="text-sm text-slate-500 mt-1 mb-0">Opportunities synced from Salesforce, open and closed.</p>
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : opportunities.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No Opportunities yet"
          message="These sync in from Salesforce, or ask your Super Admin to check the Opportunity sync settings."
        />
      ) : (
        <>
        <PerformanceDonut opportunities={opportunities} />

        <div className="flex items-center gap-2 flex-wrap mb-3">
          <SearchInput
            placeholder="Search by account…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
            aria-label="Search opportunities"
          />
          <Select ariaLabel="Filter by stage" value={stageFilter} onChange={setStageFilter} options={STAGE_FILTER_OPTIONS} />
          {ownerOptions.length > 1 && (
            <Select
              ariaLabel="Filter by AE"
              value={ownerFilter}
              onChange={setOwnerFilter}
              options={[{ value: 'all', label: 'All AEs' }, ...ownerOptions]}
            />
          )}
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={Briefcase} title="No Opportunities match these filters" message="Try a different search or clear a filter." />
        ) : (
          <>
        <Card data-tour="ae-pipeline-table">
          <Table>
            <TableHead>
              <TableRow>
                <SortableTableHeader label="Account" sortKey="account" sort={sort} onSort={toggleSort} />
                <SortableTableHeader label="AE" sortKey="ae" sort={sort} onSort={toggleSort} />
                <SortableTableHeader label="Amount" sortKey="amount" sort={sort} onSort={toggleSort} className="text-right" />
                <TableHeader>Stage</TableHeader>
                <SortableTableHeader label="Close date" sortKey="close_date" sort={sort} onSort={toggleSort} />
              </TableRow>
            </TableHead>
            <TableBody>
              {pageOpportunities.map((opp) => (
                <TableRow key={opp.id} onClick={() => setSelectedId(opp.id)}>
                  <TableCell className="font-semibold text-slate-800">{opp.account_name || opp.name || 'Untitled'}</TableCell>
                  <TableCell className="text-slate-600">{opp.owner_name || <span className="text-slate-400">Unassigned</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(opp.amount)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {stageBadge(opp)}
                      {opp.sf_push_status === 'failed' && (
                        <TriangleAlert size={13} className="text-red-500 shrink-0" title="Not synced to Salesforce" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(opp.close_date)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Pagination page={page} pages={totalPages} total={filtered.length} perPage={PER_PAGE} onChange={setPage} />
          </>
        )}
        </>
      )}

      {selectedId && (
        <OpportunityDrawer
          opportunityId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
