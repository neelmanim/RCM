import React, { useEffect, useState } from 'react';
import { Modal } from '../../../../components/ui/Modal';
import { Input } from '../../../../components/ui/Input';
import { Select } from '../../../../components/ui/Select';
import { Button } from '../../../../components/ui/Button';

const EMPTY_FORM = { sdrId: '', messengerUserId: '', phone: '', email: '', whatsappSender: '' };

/**
 * Right-side drawer, ported from settings_ai_dialer.js's
 * _openAssignDrawer/_closeAssignDrawer + the "New Agent Assignment" markup
 * in settings.js (conv-add-* ids). Same 5 fields, save/cancel, inline
 * validation-error display. Reused for both "Assign" (mode='add', SDR
 * picker shown, only unassigned SDRs listed) and "Edit" (mode='edit',
 * target fixed, fields pre-filled) — one drawer instead of a second
 * inline-edit-row UI the legacy page also carried.
 */
export function AssignAlternateMessenger({ open, mode, targetUser, unassignedSdrs, onClose, onSave }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setWarning('');
    if (mode === 'edit' && targetUser) {
      setForm({
        sdrId: targetUser.id,
        messengerUserId: targetUser.messenger_user_id || '',
        phone: targetUser.messenger_from_number || '',
        email: targetUser.messenger_email || '',
        whatsappSender: targetUser.messenger_whatsapp_sender_id || '',
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, mode, targetUser]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSave = async () => {
    setError('');
    if (mode === 'add' && !form.sdrId) { setError('Please select an SDR.'); return; }
    if (!form.messengerUserId.trim()) { setError('Alternate Messenger User ID is required.'); return; }
    setSaving(true);
    try {
      const data = await onSave(form.sdrId, {
        messenger_user_id: form.messengerUserId.trim(),
        messenger_from_number: form.phone.trim() || null,
        messenger_email: form.email.trim().toLowerCase() || null,
        messenger_whatsapp_sender_id: form.whatsappSender.trim() || null,
      });
      // A soft warning (e.g. "won't send yet") is surfaced, not swallowed —
      // keep the drawer open so it's actually seen, instead of the legacy
      // page's close-right-after-showing-it sequence.
      if (data?.warning) { setWarning(data.warning); return; }
      onClose();
    } catch (e) {
      // The PATCH endpoint 422s with a specific message on an invalid
      // Alternate Messenger agent ID — surfaced verbatim here, not swallowed.
      setError(e.message || 'Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const sdrOptions = unassignedSdrs.map((s) => ({ value: s.id, label: s.name || s.email }));

  return (
    <Modal open={open} onClose={onClose} position="right" title={mode === 'edit' ? 'Edit Agent Assignment' : 'New Agent Assignment'}>
      <div className="flex flex-col gap-3.5">
        {mode === 'add' ? (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Select SDR</label>
            <Select
              value={form.sdrId}
              onChange={(v) => setForm((f) => ({ ...f, sdrId: v }))}
              options={sdrOptions.length ? sdrOptions : [{ value: '', label: 'All SDRs already assigned', disabled: true }]}
              placeholder="— Select SDR —"
              className="w-full"
            />
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">SDR</label>
            <div className="text-sm font-semibold text-slate-800">{targetUser?.name || targetUser?.email}</div>
          </div>
        )}
        <Input
          label="Alternate Messenger User ID"
          value={form.messengerUserId}
          onChange={set('messengerUserId')}
          placeholder="e.g. 1128097"
          containerClassName="mb-0"
        />
        <Input
          label="Caller Number"
          value={form.phone}
          onChange={set('phone')}
          placeholder="+91..."
          containerClassName="mb-0"
        />
        <Input
          label="Alternate Messenger Email"
          type="email"
          value={form.email}
          onChange={set('email')}
          placeholder="agent@company.com"
          containerClassName="mb-0"
        />
        <Input
          label="WhatsApp Sender"
          value={form.whatsappSender}
          onChange={set('whatsappSender')}
          placeholder="Optional — uses org default"
          containerClassName="mb-0"
        />

        {error && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
        )}
        {warning && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">⚠️ {warning}</div>
        )}

        <div className="flex gap-2 mt-1">
          <Button className="flex-1" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : warning ? 'Save again' : 'Assign'}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
