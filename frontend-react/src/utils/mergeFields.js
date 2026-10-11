// ── utils/mergeFields.js ─────────────────────────────────────────────────────
// Canonical {{field}} list + a preview substituter, shared by every compose
// surface (Email Campaigns, saved templates, Sales Cadence email nodes).
//
// Mirrors backend/journey_engine/merge_fields.py's own field map — that module
// is what actually substitutes at send time. Keep the two lists in sync; this
// one previously existed only as sales-journey/nodeDefaults.js
// EMAIL_MERGE_FIELDS (which now re-exports from here) plus a hardcoded
// placeholder string in CampaignsSection, so the campaign composer advertised
// the fields in grey text with no way to discover or insert them.
export const LEAD_MERGE_FIELDS = [
  'first_name', 'last_name', 'company', 'title', 'email', 'phone',
  // v13.0.0: the lead's AI research (Pre-Call Intelligence) and who it's from.
  'research_hook', 'research_opening', 'rep_name', 'sender_name',
];

// Stand-in values for read-only previews ("what will the lead actually get?").
// Deliberately obvious placeholders, not real-looking data — a preview that
// looks like a real lead invites someone to trust it as one.
export const SAMPLE_LEAD = {
  first_name: 'Priya',
  last_name: 'Sharma',
  company: 'Acme Corp',
  title: 'Head of Sales',
  email: 'priya@acme.example',
  phone: '+91 98765 43210',
  research_hook: '[their recent post / news, from AI research]',
  research_opening: '[AI research opening line]',
  rep_name: '[assigned rep]',
  sender_name: '[sending rep]',
};

const MERGE_FIELD_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;

/** Substitute {{field}} tokens for preview only — the real send-time
 *  substitution is backend/journey_engine/merge_fields.py::apply_merge_fields.
 *  Matches its "unmatched fields render blank" rule so a preview can't imply
 *  a literal "{{last_name}}" would ever reach a recipient. */
export function applyMergeFields(text) {
  if (!text) return text || '';
  return text.replace(MERGE_FIELD_PATTERN, (_, field) => SAMPLE_LEAD[field] ?? '');
}
