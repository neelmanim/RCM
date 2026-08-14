// Mirrors backend/models.py's Status enum — no public endpoint exposes this
// list, so it's hardcoded here the same way the legacy frontend does.
export const STATUSES = [
  'Lead Assigned', 'Research', 'Calling', 'Meeting Scheduled',
  '1st Discovery Meeting', 'Discovery Complete', 'Demo Scheduled',
  'Demo Done', 'Pending Review', 'Completed', 'Disqualified',
];

// Values must match GET /leads' source filter contract exactly (see
// backend/routes/lead_helpers.py::_apply_filters) — "uploaded" and "gsheet"
// are special-cased there to match the "upload:<name>:<ts>"/"gsheet:<name>:<ts>"
// stored values; everything else is an exact match against lead_source.
export const SOURCES = [
  { value: 'salesforce', label: 'Salesforce' },
  { value: 'gsheet', label: 'Google Sheet' },
  { value: 'uploaded', label: 'Uploaded' },
  { value: 'manual', label: 'Manual' },
];

// priority_score: 100=High, 50=Medium, 25=Deprioritized (backend/models.py:317)
export const PRIORITY_TIERS = [
  { score: 100, label: 'High', dotClass: 'bg-red-500' },
  { score: 50, label: 'Medium', dotClass: 'bg-amber-500' },
  { score: 25, label: 'Deprioritized', dotClass: 'bg-slate-400' },
];

export function priorityTierFor(score) {
  if (score >= 75) return PRIORITY_TIERS[0];
  if (score >= 40) return PRIORITY_TIERS[1];
  return PRIORITY_TIERS[2];
}
