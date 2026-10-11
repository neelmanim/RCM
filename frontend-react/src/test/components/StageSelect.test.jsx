import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StageSelect } from '../../components/ui/StageSelect';

// Shared by AE Pipeline's "Update deal" and CSM Portal's "Manage opportunity"
// — real dropdown sourced from Salesforce's StageName picklist, free text
// only when Salesforce isn't configured.
const STAGE_OPTIONS = [{ value: 'Negotiation', label: 'Negotiation' }, { value: 'Closed Won', label: 'Closed Won' }];

describe('StageSelect', () => {
  it('falls back to a free-text Input when no stage options are configured', () => {
    render(<StageSelect stageOptions={[]} value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Stage')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stage' })).not.toBeInTheDocument();
  });

  it('renders a real dropdown sourced from stageOptions, not a native <select>', () => {
    const { container } = render(<StageSelect stageOptions={STAGE_OPTIONS} value="Negotiation" onChange={vi.fn()} />);
    expect(container.querySelector('select')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Stage' });
    expect(trigger).toHaveTextContent('Negotiation');
  });

  it('always offers a "No change" option alongside the real stages', async () => {
    const onChange = vi.fn();
    render(<StageSelect stageOptions={STAGE_OPTIONS} value="Negotiation" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Stage' }));
    expect(screen.getByRole('menuitem', { name: '— No change —' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('menuitem', { name: 'Closed Won' }));
    expect(onChange).toHaveBeenCalledWith('Closed Won');
  });
});
