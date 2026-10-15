import React, { useState } from 'react';
import { X, UserPlus, Building, Mail, Phone, Briefcase, Tag, AlertCircle } from 'lucide-react';
import { LeadsService } from '../services/api';

export function CreateLeadModal({ isOpen, onClose, onLeadCreated }) {
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    company: '',
    title: '',
    email: '',
    phone: '',
    status: 'Lead Assigned',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.last_name?.trim() || !formData.company?.trim()) {
      setError('Last name and Company are required.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        company: formData.company.trim(),
        title: formData.title.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        status: formData.status,
        notes: formData.notes.trim(),
      };
      const res = await LeadsService.createLead(payload);
      const createdLead = res?.lead || res || payload;

      // Dispatch global toast
      window.dispatchEvent(
        new CustomEvent('alternate:toast', {
          detail: {
            message: `Lead "${payload.first_name} ${payload.last_name}" created successfully`,
            type: 'success',
            duration: 3500,
          },
        })
      );

      // Notify parent / refresh views
      onLeadCreated?.(createdLead);
      window.dispatchEvent(new CustomEvent('alternate:lead-created', { detail: createdLead }));

      onClose();
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'Failed to create lead.';
      setError(typeof msg === 'string' ? msg : 'Validation error creating lead.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fadeIn">
      <div
        className="w-full max-w-lg bg-[#11171D] border border-white/10 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col animate-scaleUp"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-lead-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[#141C22]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#C9FF68]/15 border border-[#C9FF68]/30 flex items-center justify-center text-[#C9FF68]">
              <UserPlus size={16} />
            </div>
            <div>
              <h2 id="create-lead-title" className="text-base font-bold text-[#F4F6F2] m-0">
                Create New Lead
              </h2>
              <p className="text-xs text-[#9BA9A5] m-0">Add a prospective commercial account or contact</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#9BA9A5] hover:text-[#F4F6F2] hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4 overflow-y-auto max-h-[80vh]">
          {error && (
            <div className="px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#9BA9A5] mb-1.5">First Name</label>
              <input
                type="text"
                name="first_name"
                value={formData.first_name}
                onChange={handleChange}
                placeholder="e.g. Rachel"
                className="w-full px-3.5 py-2.5 bg-[#151D20] border border-white/10 rounded-xl text-sm text-[#F4F6F2] placeholder-[#9BA9A5]/50 focus:outline-none focus:border-[#C9FF68] focus:ring-1 focus:ring-[#C9FF68]/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#9BA9A5] mb-1.5">
                Last Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="last_name"
                required
                value={formData.last_name}
                onChange={handleChange}
                placeholder="e.g. Miller"
                className="w-full px-3.5 py-2.5 bg-[#151D20] border border-white/10 rounded-xl text-sm text-[#F4F6F2] placeholder-[#9BA9A5]/50 focus:outline-none focus:border-[#C9FF68] focus:ring-1 focus:ring-[#C9FF68]/30 transition-colors"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#9BA9A5] mb-1.5">
                Company <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="company"
                required
                value={formData.company}
                onChange={handleChange}
                placeholder="e.g. Stripe, Acme Corp"
                className="w-full px-3.5 py-2.5 bg-[#151D20] border border-white/10 rounded-xl text-sm text-[#F4F6F2] placeholder-[#9BA9A5]/50 focus:outline-none focus:border-[#C9FF68] focus:ring-1 focus:ring-[#C9FF68]/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#9BA9A5] mb-1.5">Title / Role</label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                placeholder="e.g. VP Revenue Operations"
                className="w-full px-3.5 py-2.5 bg-[#151D20] border border-white/10 rounded-xl text-sm text-[#F4F6F2] placeholder-[#9BA9A5]/50 focus:outline-none focus:border-[#C9FF68] focus:ring-1 focus:ring-[#C9FF68]/30 transition-colors"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#9BA9A5] mb-1.5">Work Email</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="rachel@company.com"
                className="w-full px-3.5 py-2.5 bg-[#151D20] border border-white/10 rounded-xl text-sm text-[#F4F6F2] placeholder-[#9BA9A5]/50 focus:outline-none focus:border-[#C9FF68] focus:ring-1 focus:ring-[#C9FF68]/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#9BA9A5] mb-1.5">Phone Number</label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+1 (555) 000-0000"
                className="w-full px-3.5 py-2.5 bg-[#151D20] border border-white/10 rounded-xl text-sm text-[#F4F6F2] placeholder-[#9BA9A5]/50 focus:outline-none focus:border-[#C9FF68] focus:ring-1 focus:ring-[#C9FF68]/30 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#9BA9A5] mb-1.5">Initial Stage</label>
            <select
              name="status"
              value={formData.status}
              onChange={handleChange}
              className="w-full px-3.5 py-2.5 bg-[#151D20] border border-white/10 rounded-xl text-sm text-[#F4F6F2] focus:outline-none focus:border-[#C9FF68] focus:ring-1 focus:ring-[#C9FF68]/30 transition-colors"
            >
              <option value="Lead Assigned">Lead Assigned</option>
              <option value="Research">Research</option>
              <option value="Calling">Calling</option>
              <option value="Meeting Scheduled">Meeting Scheduled</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#9BA9A5] mb-1.5">Opportunity Notes</label>
            <textarea
              name="notes"
              rows={2}
              value={formData.notes}
              onChange={handleChange}
              placeholder="Context, referral source, or initial discussion details..."
              className="w-full px-3.5 py-2.5 bg-[#151D20] border border-white/10 rounded-xl text-sm text-[#F4F6F2] placeholder-[#9BA9A5]/50 focus:outline-none focus:border-[#C9FF68] focus:ring-1 focus:ring-[#C9FF68]/30 transition-colors resize-none"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/[0.08] mt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2.5 rounded-xl border border-white/10 text-xs font-bold text-[#F4F6F2] hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-[#C9FF68] hover:bg-[#D8FF85] text-[#090D0E] text-xs font-extrabold shadow-[0_2px_12px_rgba(201,255,104,0.3)] transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create Lead →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
