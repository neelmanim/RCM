/**
 * FeedbackModal.jsx
 *
 * React feedback modal, on the shared design system (ui/Modal + ui/Button,
 * lucide icons, Tailwind). Opened via window.NavHub.openFeedback() called
 * from app.js onAction handler.
 * Submits to /api/admin/feedback via window.__CRM_API_BASE__ + window._authHeaders().
 */
import React, { useState, useEffect, useRef } from 'react';
import { Bug, Lightbulb, MessageSquare, Send, CheckCircle2, AlertCircle } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';

const TYPES = [
  { value: 'bug',     label: 'Bug Report',      Icon: Bug },
  { value: 'feature', label: 'Feature Request', Icon: Lightbulb },
  { value: 'general', label: 'General Feedback', Icon: MessageSquare },
];

async function _submit(type, message) {
  const base    = window.__CRM_API_BASE__ || '';
  const headers = typeof window._authHeaders === 'function'
    ? window._authHeaders()
    : { Authorization: `Bearer ${localStorage.getItem('crm_token')}` };

  const res = await fetch(`${base}/api/admin/feedback`, {
    method:  'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ type, message }),
  });
  return res.json();
}

export function FeedbackModal({ open, onClose }) {
  const [type,      setType]      = useState('bug');
  const [message,   setMessage]   = useState('');
  const [status,    setStatus]    = useState('idle'); // idle | loading | success | error
  const [errorText, setErrorText] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    if (open) {
      setStatus('idle');
      setErrorText('');
      setTimeout(() => textareaRef.current?.focus(), 80);
    } else {
      setTimeout(() => { setMessage(''); setType('bug'); setStatus('idle'); }, 300);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!message.trim()) { setErrorText('Please enter a message.'); return; }
    setStatus('loading');
    setErrorText('');
    try {
      await _submit(type, message.trim());
      setStatus('success');
      setTimeout(() => onClose(), 1800);
    } catch {
      setStatus('error');
      setErrorText('Failed to submit. Please try again.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Send Feedback" maxWidth="max-w-md">
      {status === 'success' ? (
        <div className="text-center py-6">
          <CheckCircle2 className="mx-auto text-green-500" size={48} />
          <p className="font-bold text-slate-800 mt-3">Thanks for your feedback!</p>
          <p className="text-sm text-slate-500 mt-1.5">We'll review it and get back to you if needed.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-500 mb-5">
            Report a bug, suggest a feature, or share your thoughts — we improve RCM based on your input.
          </p>

          <div className="mb-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
              Type
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {TYPES.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setType(value)}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all
                    ${type === value
                      ? 'bg-blue-50 border-blue-400 text-blue-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-1">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
              Message
            </label>
            <textarea
              ref={textareaRef}
              className="w-full px-3 py-2 rounded-lg text-sm border transition-all duration-150 outline-none
                bg-white text-slate-800 placeholder:text-slate-400 border-slate-200
                focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 resize-y min-h-[110px]"
              value={message}
              onChange={e => { setMessage(e.target.value); if (errorText) setErrorText(''); }}
              placeholder="Describe the issue or suggestion..."
              rows={5}
            />
          </div>

          {errorText && (
            <p className="flex items-center gap-1.5 text-xs text-red-600 mt-2">
              <AlertCircle size={14} /> {errorText}
            </p>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6 pt-4 border-t border-slate-100">
            <Button variant="secondary" size="sm" onClick={onClose} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={status === 'loading'}
              className="w-full sm:w-auto"
            >
              {status === 'loading' ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send size={14} /> Submit Feedback
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
