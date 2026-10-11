/**
 * deriveResearchStatus.js
 *
 * POST /leads/{id}/ai-research returns no status enum (confirmed against
 * backend/routes/ai_research_routes.py) — this infers NOT_AVAILABLE /
 * RESEARCHING / READY / LIMITED / FAILED client-side from: an in-flight
 * request, a failed request's error, whether the lead has enough identity to
 * research at all, and how many research_* fields are meaningfully populated
 * (excluding the Klenty historical-sync placeholder text, which must never
 * be shown as if it were real research — spec principle #5).
 */

export const RESEARCH_STATUS = {
  NOT_AVAILABLE: 'NOT_AVAILABLE',
  RESEARCHING: 'RESEARCHING',
  READY: 'READY',
  LIMITED: 'LIMITED',
  FAILED: 'FAILED',
};

const RESEARCH_FIELDS = [
  'research_company', 'research_contact', 'research_hypothesis',
  'research_personalization', 'research_industry', 'research_company_size',
  'research_services', 'research_geo', 'research_timezone', 'research_hook',
  'research_channels',
];

// backend/scheduled_jobs.py::_KLENTY_RESEARCH_NOTE — written verbatim into
// every research_* field for leads the Klenty historical sync creates with no
// real research available.
const KLENTY_PLACEHOLDER = 'No research done';

function populatedFieldCount(lead) {
  return RESEARCH_FIELDS.filter((f) => {
    const v = lead?.[f];
    return typeof v === 'string' && v.trim() && !v.includes(KLENTY_PLACEHOLDER);
  }).length;
}

export function deriveResearchStatus(lead, { researching = false, error = null } = {}) {
  if (researching) return RESEARCH_STATUS.RESEARCHING;
  if (error) return RESEARCH_STATUS.FAILED;
  if (!lead) return RESEARCH_STATUS.NOT_AVAILABLE;

  const populated = populatedFieldCount(lead);
  if (populated === 0) return RESEARCH_STATUS.NOT_AVAILABLE;
  if (populated < 4) return RESEARCH_STATUS.LIMITED;
  return RESEARCH_STATUS.READY;
}

export function hasEnoughIdentityToResearch(lead) {
  return Boolean(lead?.company || lead?.title || `${lead?.first_name || ''}${lead?.last_name || ''}`.trim());
}
