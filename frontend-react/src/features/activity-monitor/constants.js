export const CHANNEL_TABS = [
  { key: 'calls', label: 'Calls' },
  { key: 'email', label: 'Email' },
  { key: 'messages', label: 'Messages' },
];

export const PROVIDER_OPTIONS = [
  { value: '', label: 'All Providers' },
  { value: 'messenger', label: 'Alternate Messenger' },
  { value: 'aircall', label: 'Aircall' },
  { value: 'klenty', label: 'Klenty' },
  { value: 'manual', label: 'Manual' },
];

export const DIRECTION_OPTIONS = [
  { value: '', label: 'All Directions' },
  { value: 'outbound', label: 'Outbound' },
  { value: 'inbound', label: 'Inbound' },
];

export const OUTCOME_OPTIONS = [
  { value: '', label: 'All Outcomes' },
  { value: 'Interested', label: 'Interested' },
  { value: 'No Answer', label: 'No Answer' },
  { value: 'Left Voicemail', label: 'Left Voicemail' },
  { value: 'Call Back Later', label: 'Call Back Later' },
  { value: 'Meeting Scheduled', label: 'Meeting Scheduled' },
  { value: 'Not Interested', label: 'Not Interested' },
  { value: 'Not the Right Person', label: 'Not the Right Person' },
];

export const MESSAGE_CHANNEL_OPTIONS = [
  { value: '', label: 'All Channels' },
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

export const MESSAGE_STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'sent', label: 'Sent' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed', label: 'Failed' },
];

// has_recording deliberately stays a tri-state string ('' / 'true'), matching
// the backend's Optional[bool] query param and the legacy checkbox's own
// "unchecked = no filter, not false" semantics.
export const EMPTY_FILTERS = {
  sdr_id: '', provider: '', direction: '', outcome: '',
  date_from: '', date_to: '', has_recording: '', search: '',
  channel: '', status: '',
};

export const PER_PAGE = 25;
export const POLL_INTERVAL_MS = 30_000;
export const CSV_EXPORT_CAP = 2000;
