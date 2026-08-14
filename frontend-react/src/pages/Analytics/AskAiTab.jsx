/**
 * AskAiTab.jsx
 *
 * The Ask AI panel for the Analytics Hub.
 * Receives shared filters from DashboardTab via AnalyticsHub parent.
 *
 * Bugs fixed in this version:
 *   - BUG-1: report.query was undefined (field is natural_language_query) → crash + blank page
 *   - BUG-2: Pod UUID shown in scoping banner instead of pod name
 *   - BUG-3: No output when query returns action:clarify or scalar result
 *   - BUG-4: saveReport API call had wrong parameter order (sent result obj, not dsl_json)
 *   - BUG-5: Result card showed nothing when answer+chart_data+table all empty
 *
 * Features:
 *   - Context scoping banner (shows current Pod name/Date/Batch from Dashboard)
 *   - Natural language query input with Run button
 *   - Suggestion chips (4 presets)
 *   - Result card: AI text summary + Chart.js bar chart + data table
 *   - Clarify/Unsupported action responses handled gracefully
 *   - Save Report / Show in Dashboard actions
 *   - Saved Reports right panel (load + delete)
 *   - EC-06: auto-submit initialQuery with 500ms delay after filters settle
 *   - EC-12: AbortController cleanup on every unmount
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles, Send, Trash2, BookOpen, ChevronRight,
  BarChart2, Save, Pin, Edit3, Loader2, X,
  HelpCircle, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { SmartAnalyticsService } from '../../services/api';
import { AiResultChart } from './AiResultChart';

/* ── Suggestion chips ────────────────────────────────────── */
const SUGGESTIONS = [
  'Calls made by each SDR this week',
  'Top performers vs target this month',
  'Meeting conversion rate by pod',
  'Pipeline health score summary',
];

/* ── Scoping Banner ──────────────────────────────────────── */
const ScopingBanner = ({ filters, onEdit }) => {
  const parts = [];
  // BUG-2 FIX: use pod_name (human-readable) instead of pod_id (UUID)
  if (filters?.pod_name) parts.push(`Pod: ${filters.pod_name}`);
  else if (filters?.pod_id) parts.push(`Pod: ${filters.pod_id}`);

  if (filters?.preset) parts.push(filters.preset.replace(/_/g, ' ').toUpperCase());
  if (filters?.date_from && filters?.date_to) parts.push(`${filters.date_from} → ${filters.date_to}`);
  if (filters?.upload_log_id) parts.push(`Batch filter active`);

  const label = parts.length ? parts.join(' · ') : 'All Pods · All Time';

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-xl text-xs text-indigo-700 font-semibold mb-4">
      <span className="text-indigo-400">⬡</span>
      <span>Scoped to: <strong>{label}</strong></span>
      <button
        onClick={onEdit}
        title="Edit filters in Dashboard tab"
        className="ml-auto text-indigo-400 hover:text-indigo-600 transition-colors"
      >
        <Edit3 size={12} />
      </button>
    </div>
  );
};

/* ── Clarify response card ───────────────────────────────── */
const ClarifyCard = ({ question, onSend }) => {
  const [reply, setReply] = useState('');
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <HelpCircle size={15} className="text-amber-500 shrink-0" />
        <p className="text-xs font-bold text-amber-700 uppercase tracking-wider">Clarification needed</p>
      </div>
      <p className="text-sm text-slate-700 leading-relaxed">{question}</p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={reply}
          onChange={e => setReply(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && reply.trim() && onSend(reply.trim())}
          placeholder="Type your answer…"
          className="flex-1 text-xs border border-amber-300 rounded-lg px-3 py-1.5 outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20 bg-white"
        />
        <button
          onClick={() => reply.trim() && onSend(reply.trim())}
          disabled={!reply.trim()}
          className="px-3 py-1.5 text-xs font-bold bg-indigo-600 text-white rounded-lg disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
};

/* ── Unsupported response card ───────────────────────────── */
const UnsupportedCard = ({ message }) => (
  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex items-start gap-3">
    <AlertCircle size={16} className="text-slate-400 shrink-0 mt-0.5" />
    <div>
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Not supported</p>
      <p className="text-sm text-slate-600 leading-relaxed">{message || "I can't answer that yet. Try asking about calls, meetings, emails, or SDR performance."}</p>
    </div>
  </div>
);

/* ── Saved Report Item ───────────────────────────────────── */
const SavedReportItem = ({ report, onRun, onDelete }) => {
  const nlq = report.natural_language_query || report.query || '';

  // If the saved name is a meaningful custom label (differs from the NL query), use it as title
  // and show the full query as subtitle. Otherwise just show the (possibly truncated) query.
  const hasCustomName = report.name && report.name !== nlq && report.name.trim().length > 0;
  const displayName   = hasCustomName
    ? report.name
    : (nlq.length > 42 ? nlq.slice(0, 42) + '…' : nlq);

  // Subtitle: full NL query (adds context when name is custom or query is truncated)
  // Always render *something* so every card has consistent 2-line height.
  const subtitle = hasCustomName
    ? nlq                                         // custom name → show full query as subtitle
    : nlq.length > 42
      ? nlq                                       // truncated title → show full query for tooltip
      : null;                                     // short identical → no subtitle (clean)

  return (
    <div className="py-2.5 px-1 border-b border-slate-100 last:border-0 group">
      <div className="flex items-start justify-between gap-1">
        <button
          className="flex-1 min-w-0 text-left"
          onClick={() => onRun(report)}
          title={nlq || report.name}
        >
          <p className="text-xs font-semibold text-slate-700 truncate leading-snug">{displayName || '—'}</p>
          {subtitle ? (
            <p className="text-[10px] text-slate-400 mt-0.5 truncate leading-snug">{subtitle}</p>
          ) : (
            <p className="text-[10px] text-slate-300 mt-0.5 italic leading-snug">tap to run</p>
          )}
        </button>
        <button
          onClick={() => onDelete(report.id)}
          className="mt-0.5 p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shrink-0"
          title="Delete"
        >
          <Trash2 size={11} />
        </button>
      </div>
      {report.is_pinned && (
        <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-indigo-400 mt-0.5">
          <Pin size={8} /> pinned
        </span>
      )}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════ */
/* ── AskAiTab ────────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
export const AskAiTab = ({ token, filters, initialQuery, onPinSuccess }) => {
  const [queryText, setQueryText]       = useState(initialQuery || '');
  const [isRunning, setIsRunning]       = useState(false);
  const [result, setResult]             = useState(null);
  const [error, setError]               = useState('');
  const [history, setHistory]           = useState([]);
  const [savedReports, setSavedReports] = useState([]);
  const [isSaving, setIsSaving]         = useState(false);
  const [saveNameInput, setSaveNameInput] = useState('');
  const [showSaveForm, setShowSaveForm]  = useState(false);
  // Pin state
  const [isPinned,    setIsPinned]    = useState(false);  // true once this result is pinned
  const [isPinning,   setIsPinning]   = useState(false);
  const [pinToast,    setPinToast]    = useState('');     // toast message
  const [savedReportId, setSavedReportId] = useState(null); // id after auto-save

  const abortRef = useRef(null);

  // Load saved reports on mount
  useEffect(() => {
    let cancelled = false;
    SmartAnalyticsService.getReports()
      .then(reports => { if (!cancelled) setSavedReports(Array.isArray(reports) ? reports : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // EC-06: auto-submit initialQuery with 500ms delay
  useEffect(() => {
    if (!initialQuery?.trim()) return;
    setQueryText(initialQuery);
    const t = setTimeout(() => { runQuery(initialQuery); }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // EC-12: abort on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const runQuery = useCallback(async (q) => {
    // BUG-1 FIX: guard against undefined — q may come from report.natural_language_query
    const query = typeof q === 'string' ? q.trim() : (typeof queryText === 'string' ? queryText.trim() : '');
    if (!query || isRunning) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setIsRunning(true);
    setError('');
    setResult(null);

    try {
      const data = await SmartAnalyticsService.query(query, history, filters);

      // Handle clarify / unsupported action responses (BUG-3 FIX)
      if (data?.action === 'clarify') {
        setResult({ type: 'clarify', question: data.question || data.message || 'Can you clarify?', query });
        setHistory(prev => [...prev, { role: 'user', content: query }]);
        return;
      }
      if (data?.action === 'unsupported') {
        setResult({ type: 'unsupported', message: data.message, query });
        return;
      }

      // ── Normalise API response to UI field names ──────────────────────
      const mode = data.mode || 'standard';

      // Flatten all backend modes into a renderable table (array of plain {key: value} rows)
      let rawRows = [];
      let multiSections = null;   // for multi mode: [{metric, label, rows, chartData}]

      if (mode === 'multi' && Array.isArray(data.results)) {
        // Each element of data.results is {metric, group_by, chart_type, data: [...]}
        multiSections = data.results.map(sec => {
          const rows = Array.isArray(sec.data) ? sec.data : [];
          let cd = null;
          const ct = sec.chart_type || '';
          if (rows.length > 0 && (ct === 'bar' || ct === 'line')) {
            const keys = Object.keys(rows[0]);
            const lk = keys[0];
            const vk = keys.find(k => typeof rows[0][k] === 'number') || keys[1];
            if (lk && vk) cd = { labels: rows.map(r => String(r[lk] ?? '')), values: rows.map(r => Number(r[vk] ?? 0)), label: vk.replace(/_/g, ' '), type: ct };
          }
          return { metric: sec.metric, label: sec.metric.replace(/_/g, ' '), rows, chartData: cd };
        });
        // Also build a flat rawRows from all sections for save purposes
        rawRows = data.results.flatMap(s => Array.isArray(s.data) ? s.data : []);

      } else if (mode === 'compare' && Array.isArray(data.comparisons)) {
        rawRows = data.comparisons.map(c => ({
          sdr:   c.sdr   || c.label || '',
          value: c.value ?? c.count ?? 0,
        }));

      } else if (mode === 'funnel' && data.steps && !Array.isArray(data.steps)) {
        // steps is a {stage: count} dict — convert to rows
        rawRows = Object.entries(data.steps).map(([label, value]) => ({ label, value }));

      } else if (mode === 'pod_summary' && Array.isArray(data.pods)) {
        rawRows = data.pods;

      } else if (Array.isArray(data.data)) {
        rawRows = data.data;
      } else if (Array.isArray(data.results)) {
        rawRows = data.results;
      } else if (Array.isArray(data.steps)) {
        rawRows = data.steps;
      }

      // Build chart data for non-multi modes
      const chartType = data.chart_type || '';
      let chartData = null;
      if (!multiSections && rawRows.length > 0 && (chartType === 'bar' || chartType === 'line')) {
        const keys = Object.keys(rawRows[0]);
        const labelKey = keys[0];
        const valueKey = keys.find(k => typeof rawRows[0][k] === 'number') || keys[1];
        if (labelKey && valueKey) {
          chartData = {
            labels: rawRows.map(r => String(r[labelKey] ?? '')),
            values: rawRows.map(r => Number(r[valueKey] ?? 0)),
            label:  valueKey.replace(/_/g, ' '),
            type:   chartType,
          };
        }
      }

      const answerText = data.answer || data.text || data.insight || data.summary || null;

      setResult({
        type:           'result',
        query,
        mode,
        dsl_json:       JSON.stringify(data.dsl || {}),
        chart_type:     chartType,
        answer:         answerText,
        table:          rawRows,
        chart_data:     chartData,
        multi_sections: multiSections,
        _raw:           data,
      });
      // Reset pin state on new query result
      setIsPinned(false);
      setSavedReportId(null);
      setPinToast('');

      setHistory(prev => [
        ...prev,
        { role: 'user',      content: query },
        { role: 'assistant', content: answerText || '' },
      ]);
    } catch (err) {
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
      // Show API error detail if available
      const detail = err?.response?.data?.detail?.message || err?.response?.data?.detail || null;
      setError(detail || 'Something went wrong. Please try again.');
    } finally {
      setIsRunning(false);
    }
  }, [queryText, history, filters, isRunning]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runQuery(); }
  };

  // BUG-4 FIX: saveReport backend expects (name, natural_language_query, dsl_json, chart_type)
  const handleSaveReport = async () => {
    if (!result || !saveNameInput.trim()) return;
    setIsSaving(true);
    try {
      const saved = await SmartAnalyticsService.saveReport(
        saveNameInput.trim(),
        result.query,
        result.dsl_json || '{}',
        result.chart_type || null,
      );
      const newReport = { ...saved, natural_language_query: result.query };
      setSavedReports(prev => [newReport, ...prev]);
      setSavedReportId(saved.id);  // track for pin
      setShowSaveForm(false);
      setSaveNameInput('');
    } catch {
      // silent
    } finally {
      setIsSaving(false);
    }
  };

  /** Pin to Dashboard: auto-save if not yet saved, then pin. */
  const handlePinReport = async () => {
    if (!result || isPinned || isPinning) return;
    setIsPinning(true);
    setPinToast('');
    try {
      let reportId = savedReportId;
      // Auto-save with query text as default name (truncated to 60 chars) if not already saved
      if (!reportId) {
        const defaultName = (result.query || 'Pinned Report').slice(0, 60);
        const saved = await SmartAnalyticsService.saveReport(
          defaultName,
          result.query,
          result.dsl_json || '{}',
          result.chart_type || null,
          true, // skip_dsl_validation — NL query is source of truth for re-runs
        );
        reportId = saved.id;
        setSavedReportId(reportId);
        setSavedReports(prev => [{ ...saved, natural_language_query: result.query }, ...prev]);
      }
      // Pin it
      await SmartAnalyticsService.pinReport(reportId, true);
      setIsPinned(true);
      setPinToast('Pinned! Visible on your Dashboard.');
      onPinSuccess?.();  // notify DashboardTab to refresh PinnedReports
      setTimeout(() => setPinToast(''), 4000);
    } catch (e) {
      const msg = e?.response?.data?.detail?.message || e?.response?.data?.detail || 'Could not pin. Please try again.';
      setPinToast(typeof msg === 'string' ? msg : 'Pin limit reached (max 5). Unpin a report first.');
      setTimeout(() => setPinToast(''), 5000);
    } finally {
      setIsPinning(false);
    }
  };

  // BUG-1 FIX: use natural_language_query (the correct field name from the API)
  const handleRunSaved = async (report) => {
    const q = report.natural_language_query || report.query || '';
    if (!q) return;
    setQueryText(q);
    await runQuery(q);
  };

  const handleDeleteSaved = async (id) => {
    try {
      await SmartAnalyticsService.deleteReport(id);
      setSavedReports(prev => prev.filter(r => r.id !== id));
    } catch {}
  };

  // Called when user answers a clarify prompt
  const handleClarifyReply = (reply) => {
    setQueryText(reply);
    runQuery(reply);
  };

  return (
    <div className="flex gap-5">
      {/* ── Main Column ─────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Scoping banner */}
        <ScopingBanner filters={filters} onEdit={undefined} />

        {/* Query input card */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
          <div className="flex items-start gap-3">
            <Sparkles size={18} className="text-indigo-500 shrink-0 mt-1" />
            <textarea
              id="ai-query-input"
              rows={2}
              value={queryText}
              onChange={e => setQueryText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask your pipeline anything… e.g. Which SDRs had the most calls last week?"
              className="flex-1 resize-none text-sm text-slate-700 placeholder-slate-400 outline-none bg-transparent leading-relaxed"
            />
            <button
              id="ai-run-btn"
              onClick={() => runQuery()}
              disabled={isRunning || !queryText?.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {isRunning
                ? <Loader2 size={13} className="animate-spin" />
                : <Send size={13} />}
              {isRunning ? 'Running…' : 'Run Query'}
            </button>
          </div>
        </div>

        {/* Suggestion chips — only when no result and not running */}
        {!result && !isRunning && !error && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Try asking…</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map(s => (
                <button key={s}
                  onClick={() => { setQueryText(s); runQuery(s); }}
                  className="px-3 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full hover:bg-indigo-100 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm font-semibold flex items-center gap-2">
            <X size={14} className="shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">
              <X size={12} />
            </button>
          </div>
        )}

        {/* Loading skeleton */}
        {isRunning && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-3 animate-pulse">
            <div className="h-3 bg-slate-100 rounded w-1/4" />
            <div className="h-4 bg-slate-100 rounded w-3/4" />
            <div className="h-4 bg-slate-100 rounded w-1/2" />
            <div className="h-32 bg-slate-100 rounded mt-4" />
          </div>
        )}

        {/* Clarify response */}
        {result?.type === 'clarify' && !isRunning && (
          <ClarifyCard question={result.question} onSend={handleClarifyReply} />
        )}

        {/* Unsupported response */}
        {result?.type === 'unsupported' && !isRunning && (
          <UnsupportedCard message={result.message} />
        )}

        {/* Result card */}
        {result?.type === 'result' && !isRunning && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            {/* Result header */}
            <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3 border-b border-slate-100">
              <div>
                <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <CheckCircle2 size={11} />
                  Results for
                </p>
                <p className="text-sm font-semibold text-slate-800 italic">"{result.query}"</p>
              </div>
              <button onClick={() => { setResult(null); setError(''); }}
                className="text-slate-300 hover:text-slate-500 transition-colors mt-0.5">
                <X size={16} />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Backend message banner (e.g. batch_not_found) */}
              {result._raw?.message && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800">{result._raw.message}</p>
                </div>
              )}

              {/* AI text summary */}
              {result.answer && (
                <div className="flex items-start gap-2.5 bg-indigo-50 rounded-xl p-4">
                  <Sparkles size={14} className="text-indigo-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-slate-700 leading-relaxed">{result.answer}</p>
                </div>
              )}

              {/* Multi-metric: one section per metric */}
              {result.multi_sections && result.multi_sections.length > 0 && (
                <div className="space-y-4">
                  {result.multi_sections.map((sec, si) => (
                    <div key={si} className="border border-slate-100 rounded-xl overflow-hidden">
                      <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider capitalize">{sec.label}</p>
                      </div>
                      {sec.rows.length === 0 ? (
                        <p className="text-xs text-slate-400 italic text-center py-4">No data for this metric</p>
                      ) : (
                        <>
                          {sec.chartData && <AiResultChart data={sec.chartData} />}
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-100">
                                {Object.keys(sec.rows[0]).map(col => (
                                  <th key={col} className="py-2 px-4 text-left font-bold text-slate-500 uppercase tracking-wider text-[10px]">
                                    {col.replace(/_/g, ' ')}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {sec.rows.map((row, ri) => (
                                <tr key={ri} className="border-b border-slate-50 hover:bg-slate-50">
                                  {Object.values(row).map((val, vi) => (
                                    <td key={vi} className="py-2 px-4 text-slate-700">{String(val ?? '—')}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Standard chart (non-multi modes) */}
              {!result.multi_sections && result.chart_data?.labels?.length > 0 && (
                <AiResultChart data={result.chart_data} />
              )}

              {/* Standard data table (non-multi modes) */}
              {!result.multi_sections && result.table?.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        {Object.keys(result.table[0]).map(col => (
                          <th key={col} className="py-2.5 px-4 text-left font-bold text-slate-500 uppercase tracking-wider text-[10px] whitespace-nowrap">
                            {col.replace(/_/g, ' ')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.table.map((row, i) => (
                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                          {Object.values(row).map((val, j) => (
                            <td key={j} className="py-2.5 px-4 text-slate-700">{String(val ?? '—')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* No-data fallback — only when truly nothing to show */}
              {!result.answer
                && !result.multi_sections
                && !result.chart_data
                && (!result.table || result.table.length === 0)
                && !result._raw?.message && (
                <div className="text-center py-8 text-slate-400">
                  <BarChart2 size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No data found for this query.</p>
                  <p className="text-xs mt-1">Try a different date range or check the filter scope above.</p>
                </div>
              )}

              {/* Actions row — consistent button styling */}
              <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                {/* Save Report — outlined secondary */}
                <button
                  onClick={() => setShowSaveForm(v => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-600 bg-white transition-all"
                >
                  <Save size={13} />
                  Save Report
                </button>

                {/* Pin to Dashboard — filled primary */}
                <button
                  onClick={handlePinReport}
                  disabled={isPinned || isPinning}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ml-auto ${
                    isPinned
                      ? 'bg-indigo-50 text-indigo-400 border border-indigo-200 cursor-default'
                      : 'bg-indigo-600 text-white border border-indigo-600 hover:bg-indigo-700 shadow-sm'
                  }`}
                  title={isPinned ? 'Already pinned to Dashboard' : 'Pin this result to your Dashboard'}
                >
                  {isPinning
                    ? <Loader2 size={13} className="spin" />
                    : <Pin size={13} />}
                  {isPinned ? 'Pinned ✓' : 'Pin to Dashboard'}
                </button>
              </div>

              {/* Pin toast notification */}
              {pinToast && (
                <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg mt-2 ${
                  pinToast.includes('Pinned!')
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-red-50 text-red-700'
                }`}>
                  {pinToast.includes('Pinned!')
                    ? <CheckCircle2 size={13} />
                    : <AlertCircle size={13} />}
                  {pinToast}
                </div>
              )}

              {/* Save name form */}
              {showSaveForm && (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="text"
                    value={saveNameInput}
                    onChange={e => setSaveNameInput(e.target.value)}
                    placeholder="Report name…"
                    className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20"
                    onKeyDown={e => e.key === 'Enter' && handleSaveReport()}
                    autoFocus
                  />
                  <button
                    onClick={handleSaveReport}
                    disabled={isSaving || !saveNameInput.trim()}
                    className="px-3 py-1.5 text-xs font-bold bg-indigo-600 text-white rounded-lg disabled:opacity-50"
                  >
                    {isSaving ? '…' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setShowSaveForm(false); setSaveNameInput(''); }}
                    className="p-1.5 text-slate-400 hover:text-slate-600"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Saved Reports Panel ─────────────────────── */}
      <div className="w-56 shrink-0">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sticky top-4">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={14} className="text-slate-400" />
            <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Saved Reports</p>
          </div>
          {savedReports.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic text-center py-6">
              No saved reports yet.<br />Run a query and save it.
            </p>
          ) : (
            <div>
              {savedReports.map(r => (
                <SavedReportItem
                  key={r.id}
                  report={r}
                  onRun={handleRunSaved}
                  onDelete={handleDeleteSaved}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
