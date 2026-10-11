export const PER_PAGE = 25;

export const pct = (v) => (v == null ? '—' : `${Math.round(v * 10) / 10}%`);

export const EMPTY_FILTERS = {
  journey_id: '', rep_id: '', mailbox: '', intent: '', status: '',
  from: '', to: '', search: '', sort: 'newest', include_auto: false,
};

export const CSV_COLUMNS = [
  { key: 'lead_name', label: 'Lead' }, { key: 'lead_company', label: 'Company' },
  { key: 'subject', label: 'Subject' }, { key: 'from_email', label: 'From' },
  { key: 'mailbox', label: 'Mailbox' }, { key: 'journey_name', label: 'Cadence' },
  { key: 'step', label: 'Step' }, { key: 'intent_label', label: 'Intent' },
  { key: 'rep_name', label: 'Rep' }, { key: 'unread', label: 'Unread' },
  { key: 'timestamp', label: 'Time' },
];
