/**
 * Strips empty-string/null/undefined filter values before they reach the
 * backend. FastAPI's typed query params (e.g. has_recording: bool = None)
 * 422 on an empty string rather than treating it as "unset" — sending
 * EMPTY_FILTERS' '' placeholders straight through crashed every tab on
 * first load. Mirrors call_monitor.js's own URLSearchParams building, which
 * only ever set a param when the filter was truthy.
 */
export function cleanParams(params) {
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === '' || value === null || value === undefined) continue;
    out[key] = value;
  }
  return out;
}
