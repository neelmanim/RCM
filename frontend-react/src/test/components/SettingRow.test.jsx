import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingRow } from '../../components/ui/SettingRow';
import { Switch } from '../../components/ui/Switch';

describe('SettingRow', () => {
  it('shows the label, description and control, and announces a status', () => {
    render(<SettingRow label="Two-way sync" description="Pulls changes back" control={<Switch checked={false} onChange={() => {}} ariaLabel="Two-way sync" />} status="Saving…" />);
    expect(screen.getByText('Two-way sync')).toBeInTheDocument();
    expect(screen.getByText('Pulls changes back')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Two-way sync' })).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
  });
  it('renders no status region when there is nothing to say', () => {
    render(<SettingRow label="x" control={<span />} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
