import React from 'react';

const ROW_LABELS = {
  description: 'Definition',
  formula_description: 'Formula',
  numerator_description: 'Numerator',
  denominator_description: 'Denominator',
  date_basis: 'Date basis',
  known_caveats: 'Known caveats',
};

const fmt = (v) => (Array.isArray(v) ? (v.length ? v.join('; ') : '—') : (v || '—'));

/**
 * Draft vs. published definition-text diff (Phase 3) — same "never switch
 * without seeing the difference first" principle as MetricCard's existing
 * old-vs-new compare, applied to metadata instead of a resolved value since
 * a metadata-only draft never changes the number itself.
 */
export const MetricCompare = ({ compare }) => {
  if (!compare) return <div style={{ fontSize: 12, color: '#64748B' }}>Loading…</div>;
  if (compare.error) return <div style={{ fontSize: 12, color: '#B45309' }}>{compare.message}</div>;

  return (
    <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ color: '#64748B' }}>
        Published v{compare.published_version} vs. Draft v{compare.draft_version}
      </div>
      {Object.keys(ROW_LABELS).map((f) => {
        const changed = compare.changed_fields.includes(f);
        return (
          <div key={f} style={{ padding: 6, borderRadius: 6, background: changed ? '#FFFBEB' : '#F8FAFC' }}>
            <div style={{ fontWeight: 600, color: '#334155' }}>
              {ROW_LABELS[f]}{changed ? ' (changed)' : ''}
            </div>
            <div style={{ color: '#64748B' }}>Published: {fmt(compare.published[f])}</div>
            <div style={{ color: changed ? '#B45309' : '#64748B' }}>Draft: {fmt(compare.draft[f])}</div>
          </div>
        );
      })}
    </div>
  );
};
