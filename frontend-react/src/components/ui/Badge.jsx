import React from 'react';

const variantMap = {
  default:  'bg-white/5 text-[#9BA9A5] ring-white/10',
  primary:  'bg-[#C9FF68]/15 text-[#C9FF68] ring-[#C9FF68]/30',
  success:  'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30',
  warning:  'bg-amber-500/15 text-amber-400 ring-amber-500/30',
  danger:   'bg-red-500/15 text-red-400 ring-red-500/30',
  info:     'bg-sky-500/15 text-sky-400 ring-sky-500/30',
  purple:   'bg-purple-500/15 text-purple-400 ring-purple-500/30',
  emerald:  'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30',
  indigo:   'bg-indigo-500/15 text-indigo-400 ring-indigo-500/30',
  teal:     'bg-teal-500/15 text-teal-400 ring-teal-500/30',
  rose:     'bg-rose-500/15 text-rose-400 ring-rose-500/30',
};

// Map common CRM status strings to variants automatically
// Updated for the full 9-stage pipeline
const statusVariantMap = {
  // Pipeline stages
  'Lead Assigned':       'primary',
  'Research':            'info',
  'Calling':             'warning',
  'Meeting Scheduled':   'purple',
  '1st Discovery Meeting': 'indigo',
  'Discovery Complete':  'teal',
  'Demo Scheduled':      'emerald',
  'Demo Done':           'success',
  'Completed':           'success',
  'Disqualified':        'danger',

  // Call outcomes
  // ponytail: manually-synced snapshot of DEFAULT_OUTCOME_CONFIG (backend/models.py) —
  // will drift if admin-configured outcomes change. Wire to CallsService.getCallOutcomes()
  // if a live call site ever needs outcome-aware Badge coloring.
  'Meeting Confirmed':   'success',
  'Call Back Later':     'warning',
  'Left Voicemail':      'default',
  'No Answer':           'default',
  'Not Interested':      'danger',
  'Wrong Number':        'danger',
  'Unreachable':         'danger',
  'Do Not Call':         'danger',

  // Connection statuses
  'Connected':           'success',
  'Disconnected':        'danger',
  'Pending':             'warning',

  // Roles
  'Super Admin':         'primary',
  'Admin':               'primary',
  'Pod Admin':           'purple',
  'SDR':                 'info',

  // Sentiment
  'Positive':            'success',
  'Neutral':             'default',
  'Negative':            'danger',
};

export const Badge = ({ children, variant, className = '', ...rest }) => {
  const resolvedVariant =
    variant || statusVariantMap[children] || 'default';
  return (
    <span
      className={`
        inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ring-1 ring-inset
        ${variantMap[resolvedVariant] || variantMap.default}
        ${className}
      `}
      {...rest}
    >
      {children}
    </span>
  );
};
