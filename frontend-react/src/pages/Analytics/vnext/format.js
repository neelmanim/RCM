// Shared by MetricCard/MetricInspect/AskAnalyticsVNext — one formatting rule
// for a metric value, keyed by the registry's own `unit` field, instead of
// each surface re-deriving "is this a percent metric?" from a hardcoded
// metric-id list (ponytail-audit flagged that duplication).
export const formatMetricValue = (value, unit) => {
  if (value === null || value === undefined) return '—';
  return unit === 'percent' ? `${value}%` : value.toLocaleString();
};
