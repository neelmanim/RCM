/**
 * RecipientChips.jsx
 *
 * A labeled chip-input for one recipient list (To/CC/BCC) — type an email,
 * press Enter or comma to add it as a chip, click × to remove. Validation
 * (format, duplicates across To/CC/BCC) happens server-side on save; this
 * component only prevents adding an obviously-empty or already-present chip.
 */
import React, { useState } from 'react';
import { X } from 'lucide-react';

export const RecipientChips = ({ label, values, onChange, placeholder }) => {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const email = draft.trim().replace(/,$/, '');
    if (email && !values.includes(email)) {
      onChange([...values, email]);
    }
    setDraft('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !draft && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <div
        className="flex flex-wrap items-center gap-1.5 w-full px-2 py-1.5 rounded-lg border border-slate-200
          bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20"
        onClick={(e) => e.currentTarget.querySelector('input')?.focus()}
      >
        {values.map((email) => (
          <span key={email} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-xs font-medium text-slate-700">
            {email}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(values.filter(v => v !== email)); }}
              className="text-slate-400 hover:text-slate-700"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          type="text"
          aria-label={label}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          placeholder={values.length === 0 ? (placeholder || 'name@company.com') : ''}
          className="flex-1 min-w-[140px] text-sm outline-none py-0.5 px-1"
        />
      </div>
    </div>
  );
};
