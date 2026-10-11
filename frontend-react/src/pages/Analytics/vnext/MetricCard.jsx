import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { AnalyticsVNextService, AnalyticsGovernanceService } from '../../../services/api';
import { formatMetricValue } from './format';
import { MetricCompare } from './MetricCompare';

const BTN_STYLE = { fontSize: 12, padding: '4px 10px', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', cursor: 'pointer' };

/**
 * One metric card: value, version badge, [Inspect], [Compare with current],
 * and — for a metric editor with a draft version pending — [Try vN] (Phase 3
 * governance). The old-vs-new compare panel is the mandatory legacy-vs-vNext
 * mechanism (docs §20); Try vN/Compare versions is the separate draft-vs-
 * published mechanism for a metric definition someone is actively editing.
 */
export const MetricCard = ({ metric, filters, onInspect, canEdit, canPublish }) => {
  const [value, setValue] = useState(undefined);
  const [compare, setCompare] = useState(null);
  const [showCompare, setShowCompare] = useState(false);
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const [versionCompare, setVersionCompare] = useState(null);
  const [showTry, setShowTry] = useState(false);
  const [draftDescription, setDraftDescription] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setValue(undefined);
    AnalyticsVNextService.resolveMetric(metric.id, filters).then((data) => {
      if (!cancelled) setValue(data?.error ? null : data?.value);
    });
    return () => { cancelled = true; };
  }, [metric.id, filters]);

  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    AnalyticsGovernanceService.listVersions(metric.id).then((versions) => {
      if (cancelled) return;
      setDraft(versions.find((v) => v.status === 'draft') || null);
    });
    return () => { cancelled = true; };
  }, [metric.id, canEdit]);

  const toggleCompare = async () => {
    if (showCompare) { setShowCompare(false); return; }
    setShowCompare(true);
    if (!compare) {
      const data = await AnalyticsVNextService.compareMetric(metric.id, filters);
      setCompare(data);
    }
  };

  const startDraft = async () => {
    const created = await AnalyticsGovernanceService.createDraft(metric.id);
    setDraft(created);
    setDraftDescription(created.definition?.description || '');
  };

  const toggleTry = async () => {
    if (showTry) { setShowTry(false); return; }
    setShowTry(true);
    setDraftDescription(draft.definition?.description || '');
    if (!preview) setPreview(await AnalyticsGovernanceService.previewDraft(draft.id));
    if (!versionCompare) setVersionCompare(await AnalyticsGovernanceService.compareVersions(metric.id));
  };

  const saveDraft = async () => {
    setSavingDraft(true);
    try {
      const updated = await AnalyticsGovernanceService.editDraft(draft.id, { description: draftDescription });
      setDraft(updated);
      setVersionCompare(await AnalyticsGovernanceService.compareVersions(metric.id));
    } finally {
      setSavingDraft(false);
    }
  };

  const publish = async () => {
    await AnalyticsGovernanceService.publish(metric.id);
    setShowTry(false);
    setPreview(null);
    setVersionCompare(null);
    setDraft(null);
  };

  return (
    <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>{metric.name}</div>
      <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {value === undefined ? '···' : formatMetricValue(value, metric.unit)}
      </div>
      <div style={{ fontSize: 11, color: '#94A3B8' }}>v{metric.version} · {metric.status}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          onClick={() => onInspect(metric.id)}
          style={BTN_STYLE}
        >
          Inspect
        </button>
        <button
          onClick={toggleCompare}
          style={BTN_STYLE}
        >
          {showCompare ? 'Hide compare' : 'Compare with current'}
        </button>
        {draft ? (
          <button onClick={toggleTry} style={{ ...BTN_STYLE, borderColor: '#4F46E5', color: '#4F46E5' }}>
            {showTry ? 'Hide' : `Try v${draft.version_number}`}
          </button>
        ) : canEdit && (
          <button onClick={startDraft} style={{ ...BTN_STYLE, borderColor: '#4F46E5', color: '#4F46E5' }}>
            Draft v{metric.version + 1}
          </button>
        )}
      </div>
      {showCompare && (
        <div style={{ marginTop: 4, fontSize: 12, background: '#F8FAFC', borderRadius: 6, padding: 8 }}>
          {!compare ? 'Loading…' : compare.error ? compare.message : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {compare.match
                ? <CheckCircle2 size={14} color="#16A34A" />
                : <AlertCircle size={14} color="#B45309" />}
              <span>
                Current: {formatMetricValue(compare.legacy_value, metric.unit)} · vNext: {formatMetricValue(compare.vnext_value, metric.unit)}
                {compare.match ? ' — match' : ' — difference (see Inspect for why)'}
              </span>
            </div>
          )}
        </div>
      )}
      {showTry && draft && (
        <div style={{ marginTop: 4, fontSize: 12, background: '#F5F3FF', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <span style={{ color: '#64748B' }}>Draft value: </span>
            <strong>{!preview ? '···' : formatMetricValue(preview.value, metric.unit)}</strong>
            <span style={{ color: '#94A3B8' }}> (execution unchanged by a metadata-only draft)</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ color: '#64748B' }}>Edit definition:</span>
            <textarea
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              rows={2}
              style={{ fontSize: 12, padding: 6, border: '1px solid #CBD5E1', borderRadius: 6, resize: 'vertical', fontFamily: 'inherit' }}
            />
            <button onClick={saveDraft} disabled={savingDraft} style={{ ...BTN_STYLE, alignSelf: 'flex-start' }}>
              {savingDraft ? 'Saving…' : 'Save draft'}
            </button>
          </div>
          <MetricCompare compare={versionCompare} />
          {canPublish && (
            <button onClick={publish} style={{ ...BTN_STYLE, background: '#4F46E5', color: '#fff', borderColor: '#4F46E5', alignSelf: 'flex-start' }}>
              Publish v{draft.version_number}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
