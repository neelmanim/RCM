import React, { useState } from 'react';
import { X } from 'lucide-react';
import { ConfirmDialog } from '../../../components/ui/Modal';

export function SavedViewsTabs({ savedViews, activeViewId, activeFilterKeys, onApply, onSave, onRemove }) {
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState('');
  const [removeTarget, setRemoveTarget] = useState(null); // saved view | null

  const handleSave = () => {
    setSaveNameInput('');
    setSaveModalOpen(true);
  };
  const confirmSave = () => {
    if (!saveNameInput.trim()) return;
    onSave(saveNameInput.trim());
    setSaveModalOpen(false);
  };

  const handleRemove = (e, v) => {
    e.stopPropagation();
    setRemoveTarget(v);
  };
  const confirmRemove = () => {
    onRemove(removeTarget.id);
    setRemoveTarget(null);
  };

  return (
    <div className="flex items-center gap-0.5 border-b border-slate-200 mb-3">
      <button
        type="button" onClick={() => onApply('all')}
        className={`relative px-1 py-2 mr-4 text-xs font-semibold ${activeViewId === 'all' ? 'text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
      >
        All Leads
        {activeViewId === 'all' && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-blue-600 rounded" />}
      </button>
      {savedViews.map((v) => (
        <button
          key={v.id} type="button" onClick={() => onApply(v.id)}
          className={`relative group px-1 py-2 mr-4 inline-flex items-center gap-1 text-xs font-semibold ${activeViewId === v.id ? 'text-slate-800' : 'text-slate-500 hover:text-slate-800'}`}
        >
          {v.name}
          <span
            role="button" tabIndex={-1} aria-label={`Remove view ${v.name}`} title="Remove this saved view"
            onClick={(e) => handleRemove(e, v)}
            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 rounded hover:bg-slate-100"
          >
            <X size={11} strokeWidth={2.5} />
          </span>
          {activeViewId === v.id && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-blue-600 rounded" />}
        </button>
      ))}
      <button
        type="button"
        title={activeFilterKeys.length ? 'Save current filters as a view' : 'Add a filter first to save it as a view'}
        disabled={!activeFilterKeys.length}
        onClick={handleSave}
        className="mb-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:text-slate-300 disabled:hover:bg-transparent"
      >
        + Save view
      </button>

      <ConfirmDialog
        open={saveModalOpen} onClose={() => setSaveModalOpen(false)}
        title="Save current filters as a view" confirmLabel="Save view" onConfirm={confirmSave}
      >
        <input
          autoFocus type="text" value={saveNameInput} onChange={(e) => setSaveNameInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && confirmSave()}
          placeholder="Name this view…"
          className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title="Remove saved view"
        message={removeTarget ? `Remove the saved view "${removeTarget.name}"?` : ''}
        confirmLabel="Remove"
        confirmVariant="danger"
        onConfirm={confirmRemove}
      />
    </div>
  );
}
