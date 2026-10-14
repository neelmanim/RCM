import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Spinner } from './Spinner';

/**
 * Reusable Modal shell — handles backdrop click, escape key, and focus trap.
 *
 * Props:
 *   open       – boolean controlling visibility
 *   onClose    – callback to close the modal
 *   title      – header text (optional)
 *   children   – modal body
 *   maxWidth   – Tailwind max-w class (default 'max-w-lg'), ignored when position='right'
 *   position   – 'center' (default) or 'right' (full-height slide-over drawer)
 */
export const Modal = ({ open, onClose, title, children, maxWidth = 'max-w-lg', position = 'center' }) => {
  const overlayRef = useRef(null);

  // Close on Escape — skip if a nested Radix layer (Popover/DropdownMenu/
  // Select) already handled it: those call preventDefault() on Escape
  // during the capture phase before this bubble-phase listener runs, so a
  // picker open inside the modal closes itself without also closing us.
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  const isDrawer = position === 'right';

  return (
    <div
      ref={overlayRef}
      className={`fixed inset-0 z-[100] flex p-4 ${isDrawer ? 'justify-end' : 'items-center justify-center'}`}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200" />

      {/* Content */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Dialog'}
        className={
          isDrawer
            ? `relative w-full max-w-sm h-full bg-[#12181A] border-l border-white/10 text-[#F4F6F2] rounded-2xl shadow-2xl
              animate-in fade-in slide-in-from-right duration-300 overflow-hidden flex flex-col`
            : `relative ${maxWidth} w-full bg-[#12181A] border border-white/10 text-[#F4F6F2] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.8)]
              animate-in fade-in slide-in-from-bottom-4 duration-300 overflow-hidden`
        }
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
            <h2 className="text-lg font-bold text-[#F4F6F2] m-0">{title}</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center
                text-[#9BA9A5] hover:text-[#F4F6F2] hover:bg-white/10 transition-all"
            >
              <X size={18} />
            </button>
          </div>
        )}
        {/* Body */}
        <div className={`px-6 py-5 overflow-y-auto ${isDrawer ? 'flex-1' : 'max-h-[75vh]'}`}>
          {children}
        </div>
      </div>
    </div>
  );
};

/**
 * ConfirmDialog — a ready-made confirm/cancel modal.
 *
 * Props:
 *   open, onClose, title    – same as Modal
 *   message                 – body text
 *   confirmLabel            – button text (default 'Confirm')
 *   confirmVariant          – 'danger' | 'primary' (default 'primary')
 *   onConfirm               – async callback
 *   loading                 – boolean for button loading state
 */
export const ConfirmDialog = ({
  open, onClose, title = 'Confirm Action', message, children,
  confirmLabel = 'Confirm', confirmVariant = 'primary',
  onConfirm, loading = false
}) => {
  const btnClass = confirmVariant === 'danger'
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : 'bg-blue-600 hover:bg-blue-700 text-white';

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-md">
      {message && <p className="text-sm text-slate-600 mb-4">{message}</p>}
      {children}
      <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100 mt-4">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600
            hover:bg-slate-100 transition-all"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all
            disabled:opacity-50 disabled:cursor-not-allowed ${btnClass}`}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <Spinner size={16} tone="light" />
              Processing...
            </span>
          ) : confirmLabel}
        </button>
      </div>
    </Modal>
  );
};
