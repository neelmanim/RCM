import React from 'react';
import { Input } from './Input';
import { Select } from './Select';

// Opportunity stage editor for AE Pipeline's "Update deal" and CSM Portal's
// "Manage opportunity" — both needed the exact same "real dropdown sourced
// from Salesforce's StageName picklist, falling back to free text only when
// Salesforce isn't configured" widget (guardrails against pushing an
// invalid value to a restricted SF picklist). Extracted here rather than
// left duplicated across both features.
export function StageSelect({ stageOptions, value, onChange, placeholder = 'e.g. Proposal, Negotiation' }) {
  if (!stageOptions?.length) {
    return <Input label="Stage" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
  }
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">Stage</label>
      <Select
        value={value}
        onChange={onChange}
        options={[{ value: '', label: '— No change —' }, ...stageOptions]}
        placeholder="Stage"
        ariaLabel="Stage"
        className="w-full justify-between"
      />
    </div>
  );
}
