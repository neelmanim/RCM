import React, { useState } from 'react';
import { Phone, MessageSquare, MessageCircle } from 'lucide-react';

// Ported from settings_ai_dialer.js's _buildCapabilityToggles/_doToggle/
// _showRowNotice. One capability-toggle group per user row, owning its own
// inline notice (success warning, or a friendlier retry-able message on a
// dropped connection) — same as the legacy `wrap` element did.
//
// 2026-09-03: emoji glyphs replaced with lucide icons — same Phone/
// MessageSquare/MessageCircle set as UsersRolesPanel's channel chips, so
// "Calling/SMS/WhatsApp" reads identically wherever it appears in Team & Access.
const CAPABILITY_DEFS = [
  { field: 'dialer_enabled', name: 'Calling', icon: Phone, colour: '#7c3aed' },
  { field: 'sms_enabled', name: 'SMS', icon: MessageSquare, colour: '#2563eb' },
  { field: 'whatsapp_enabled', name: 'WhatsApp', icon: MessageCircle, colour: '#059669' },
];

export function CapabilityToggles({ user, messagingUnverified, saveUserSettings }) {
  const [notice, setNotice] = useState(null); // { kind: 'warn'|'error', text, onRetry? }
  const [busyField, setBusyField] = useState(null);

  const doToggle = async (field) => {
    setBusyField(field);
    setNotice(null);
    const next = !user[field];
    try {
      const data = await saveUserSettings(user.id, { [field]: next });
      // The API returns a warning when a channel is granted on a vendor
      // that isn't fully configured yet — surfaced here, not swallowed.
      if (data?.warning) setNotice({ kind: 'warn', text: data.warning });
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err.isNetworkError ? 'Network error — check your connection and try again.' : (err.message || 'Failed to save.'),
        onRetry: err.isNetworkError ? () => doToggle(field) : null,
      });
    } finally {
      setBusyField(null);
    }
  };

  return (
    <div>
      <div className="flex gap-1.5 flex-wrap items-center">
        {CAPABILITY_DEFS.map(({ field, name, icon: Icon, colour }) => {
          const isUnverified = messagingUnverified && field !== 'dialer_enabled';
          const on = !!user[field];
          const disabled = busyField === field;
          return (
            <button
              key={field}
              type="button"
              disabled={disabled}
              onClick={() => doToggle(field)}
              title={isUnverified
                ? `${name} on Aircall works off the org API credentials and this user's Aircall email match — no per-user setup. The send path itself is unverified.`
                : `Click to ${on ? 'revoke' : 'grant'} ${name}`}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-opacity"
              style={on
                ? { background: colour, borderColor: colour, color: '#fff', opacity: disabled ? 0.45 : 1, border: '1px solid' }
                : { background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb', opacity: disabled ? 0.45 : 1 }}
            >
              <Icon size={12} /> {name}{isUnverified ? ' ⚠' : ''}
            </button>
          );
        })}
      </div>
      {notice && (
        <div className={`mt-2 flex items-center justify-between gap-2 text-xs rounded-lg px-2.5 py-1.5 ${
          notice.kind === 'error' ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-amber-50 border border-amber-200 text-amber-700'
        }`}>
          <span>{notice.text}</span>
          {notice.onRetry && (
            <button
              type="button"
              onClick={notice.onRetry}
              className="shrink-0 border border-current rounded px-2 py-0.5 font-semibold"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
