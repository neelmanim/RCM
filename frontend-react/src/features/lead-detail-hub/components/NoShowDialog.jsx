import React, { useEffect, useId, useRef, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { LeadsService } from '../../../services/api';

export function NoShowDialog({ leadId, leadName, onClose, onSaved, onToast }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const reasonId = useId();
  const pending = useRef(false);
  const mounted = useRef(false);
  const reasonLength = reason.trim().length;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const close = () => {
    if (!pending.current) onClose();
  };

  const submit = async (event) => {
    event.preventDefault();
    const submittedReason = reason.trim();
    if (pending.current || submittedReason.length < 10) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await LeadsService.markNoShow(leadId, submittedReason);
      if (!mounted.current) return;
      onToast(`No-show recorded. Lead moved back to Calling. (Total: ${result.no_show_count})`, 'success');
      onSaved();
      onClose();
    } catch (err) {
      if (!mounted.current) return;
      const message = err.response?.data?.detail || err.message || 'Failed to mark no-show';
      setError(message);
      onToast(message, 'error');
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <Modal open onClose={close} title="Mark as no-show">
      <form onSubmit={submit}>
        <p className="text-sm mb-4">Record why {leadName} missed the meeting. The lead will move back to Calling.</p>
        <label htmlFor={reasonId} className="block text-sm font-medium mb-2">Reason</label>
        <textarea
          id={reasonId}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={saving}
          required
          rows={4}
          aria-describedby={`${reasonId}-count`}
          className="w-full rounded-lg border border-white/15 bg-white/5 p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        />
        <p id={`${reasonId}-count`} className="text-xs text-slate-400 mt-1">{reasonLength} / 10 minimum characters</p>
        {error && <p role="alert" className="text-sm text-red-400 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={saving || reasonLength < 10}>{saving ? 'Processing…' : 'Confirm no-show'}</Button>
        </div>
      </form>
    </Modal>
  );
}
