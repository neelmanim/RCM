import React from 'react';
import { Badge } from '../../../components/ui/Badge';
import { InlineSelectCell } from './InlineSelectCell';
import { STATUSES } from '../constants';

const STATUS_OPTIONS = STATUSES.map((s) => ({ value: s, label: s }));

/** Inline-editable status — matches the Attio/Airtable convention: enum
 * fields are dropdowns, autosave on change, no explicit save step. */
export function StatusCell({ status, onChange }) {
  return (
    <InlineSelectCell value={status} onChange={onChange} ariaLabel="Change status" options={STATUS_OPTIONS}>
      <Badge>{status}</Badge>
    </InlineSelectCell>
  );
}
