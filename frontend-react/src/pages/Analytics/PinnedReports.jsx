/**
 * PinnedReports.jsx — Pinned AI Report cards rendered on the Dashboard tab.
 *
 * Fetches all reports the current user has pinned, re-runs each one to get
 * fresh data, and renders them as premium cards with Refresh + Unpin actions.
 *
 * Edge cases handled:
 *   EC-1: Deleted report → backend cascade removes it; won't appear on next load
 *   EC-2/3: Re-run failure → per-card error state (stale data still shown if any)
 *   EC-9: Independent from main Dashboard loading — fetches in parallel
 *   EC-10: 0 pinned reports → nothing rendered (no empty section)
 *   EC-11: chart_type null → falls back to table view
 *   EC-12: Malformed chart data → guard before rendering AiResultChart
 */
import React, { useState, useEffect, useCallback } from 'react';
import { BarChart2, RefreshCw, X, Pin, AlertTriangle, Loader2 } from 'lucide-react';
import { SmartAnalyticsService } from '../../services/api';
import { AiResultChart } from './AiResultChart';

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const fmt = (ts) => {
  if (!ts) return '';
  const d = new Date(ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z');
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const relTime = (ts) => {
  if (!ts) return '';
  const diff = Math.round((Date.now() - new Date(ts)) / 60000);
  if (diff < 1) return 'just now';
  if (diff === 1) return '1 min ago';
  if (diff < 60) return `${diff} min ago`;
  return `${Math.round(diff / 60)}h ago`;
};

/** Normalise backend result into { labels, values, type, label } for AiResultChart */
const buildChartData = (result) => {
  if (!result) return null;
  // Time-series (line chart)
  if (result.group_by === 'day' || result.group_by === 'week' || result.group_by === 'month') {
    const rows = result.data || [];
    return {
      type: 'line',
      labels: rows.map(r => r.period || r.label || ''),
      values: rows.map(r => r.value ?? r[result.metric] ?? 0),
      label: result.metric,
    };
  }
  // Bar chart (SDR/pod/source breakdowns)
  const rows = result.data || [];
  if (!rows.length) return null;
  return {
    type: 'bar',
    labels: rows.map(r => r.sdr_name || r.label || r.name || r.group || String(r)),
    values: rows.map(r => r.value ?? r[result.metric] ?? 0),
    label: result.metric?.replace(/_/g, ' '),
  };
};

/* ── PinnedReportCard ────────────────────────────────────────────────────── */
const PinnedReportCard = ({ report, onUnpin }) => {
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [refreshed, setRefreshed] = useState(null);
  const [unpinning, setUnpinning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await SmartAnalyticsService.runReport(report.id);
      setData(result);
      setRefreshed(new Date().toISOString());
    } catch (e) {
      const msg = e?.response?.data?.detail?.message || e?.response?.data?.detail || 'Refresh failed.';
      setError(typeof msg === 'string' ? msg : 'Could not refresh this report.');
    } finally {
      setLoading(false);
    }
  }, [report.id]);

  useEffect(() => { load(); }, [load]);

  const handleUnpin = async () => {
    setUnpinning(true);
    try {
      await SmartAnalyticsService.pinReport(report.id, false);
      onUnpin(report.id);
    } catch {
      setUnpinning(false);
    }
  };

  const chartData = buildChartData(data);
  const tableRows = data?.data || [];

  return (
    <div className="pinned-card">
      {/* Header */}
      <div className="pinned-card-header">
        <div className="pinned-card-title-row">
          <Pin size={13} className="pinned-card-pin-icon" />
          <span className="pinned-card-title">{report.name}</span>
        </div>
        <div className="pinned-card-actions">
          <button
            onClick={load}
            disabled={loading}
            className="pinned-card-btn pinned-card-btn--refresh"
            title="Refresh data"
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
          <button
            onClick={handleUnpin}
            disabled={unpinning}
            className="pinned-card-btn pinned-card-btn--unpin"
            title="Unpin from Dashboard"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Query */}
      <p className="pinned-card-query">{report.natural_language_query}</p>

      {/* Body */}
      <div className="pinned-card-body">
        {loading && (
          <div className="pinned-card-loading">
            <Loader2 size={20} className="spin" />
            <span>Loading…</span>
          </div>
        )}

        {!loading && error && (
          <div className="pinned-card-error">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* EC-12: guard malformed chart data */}
        {!loading && !error && chartData?.labels?.length > 0 && (
          <AiResultChart data={chartData} />
        )}

        {/* Fallback table (EC-11: chart_type null or no chart data) */}
        {!loading && !error && (!chartData || !chartData.labels?.length) && tableRows.length > 0 && (
          <table className="pinned-card-table">
            <tbody>
              {tableRows.slice(0, 6).map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? 'pinned-card-table-even' : ''}>
                  <td className="pinned-card-table-label">
                    {row.sdr_name || row.label || row.name || row.group || `Row ${i + 1}`}
                  </td>
                  <td className="pinned-card-table-value">
                    {(row.value ?? 0).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Scalar result */}
        {!loading && !error && data?.answer && !tableRows.length && (
          <p className="pinned-card-scalar">{data.answer}</p>
        )}

        {/* Empty */}
        {!loading && !error && !data?.answer && !tableRows.length && !chartData?.labels?.length && (
          <p className="pinned-card-empty">No data available for this period.</p>
        )}
      </div>

      {/* Footer */}
      {refreshed && (
        <div className="pinned-card-footer">
          Updated {relTime(refreshed)}
        </div>
      )}
    </div>
  );
};

/* ── PinnedReports (section) ─────────────────────────────────────────────── */
export const PinnedReports = ({ token, onPinCountChange }) => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    SmartAnalyticsService.getPinnedReports()
      .then(data => {
        const list = Array.isArray(data) ? data : [];
        setReports(list);
        onPinCountChange?.(list.length);
      })
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line

  const handleUnpin = (id) => {
    setReports(prev => {
      const next = prev.filter(r => r.id !== id);
      onPinCountChange?.(next.length);
      return next;
    });
  };

  // EC-10: nothing pinned → render nothing
  if (!loading && reports.length === 0) return null;

  return (
    <section className="pinned-reports-section">
      <div className="pinned-reports-header">
        <BarChart2 size={15} className="pinned-reports-icon" />
        <span className="pinned-reports-title">Pinned Reports</span>
        <span className="pinned-reports-count">{reports.length}</span>
      </div>

      {loading ? (
        <div className="pinned-reports-skeleton-row">
          {[1, 2].map(i => <div key={i} className="pinned-card-skeleton" />)}
        </div>
      ) : (
        <div className="pinned-reports-grid">
          {reports.map(report => (
            <PinnedReportCard
              key={report.id}
              report={report}
              onUnpin={handleUnpin}
            />
          ))}
        </div>
      )}
    </section>
  );
};
