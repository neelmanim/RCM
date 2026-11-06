import { resolveLeadPhone } from './columns';

/**
 * Auto-created leads (Klenty sync with no caller name, manual-dial anonymous
 * leads) get a hardcoded "Unknown"/"Unknown Caller" name so the DB's
 * NOT NULL last_name constraint is satisfied — showing that placeholder to
 * the user reads as a bug. The phone number is the one real identifier these
 * rows always have, so surface that instead of the word "Unknown".
 */
export function displayName(lead) {
  if (!lead) return '—';
  const raw = `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
  const isPlaceholder = !raw || /^unknown(\s+caller)?$/i.test(raw);
  return isPlaceholder ? (resolveLeadPhone(lead) || '—') : raw;
}
