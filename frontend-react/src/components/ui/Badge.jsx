import React from 'react';

const variantMap = {
  default:  'bg-slate-100 text-slate-600',
  primary:  'bg-blue-100 text-blue-700',
  success:  'bg-green-100 text-green-700',
  warning:  'bg-amber-100 text-amber-700',
  danger:   'bg-red-100 text-red-700',
  info:     'bg-sky-100 text-sky-700',
  purple:   'bg-purple-100 text-purple-700',
  emerald:  'bg-emerald-100 text-emerald-700',
  indigo:   'bg-indigo-100 text-indigo-700',
  teal:     'bg-teal-100 text-teal-700',
  rose:     'bg-rose-100 text-rose-700',
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
