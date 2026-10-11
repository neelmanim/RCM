import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from '../../components/ui/Select';

// Promoted from leads-hub's retired InlineSelectCell (RCA 2026-08-24: a bare
// native <select> overlaid invisibly on the trigger — unstyled, no search,
// ran off the viewport with 20+ options) into the shared component library
// so every picker in the app — filters, inline-editable cells, and every
// native <select> standardized onto it — shares one implementation.

const OPTIONS = [
  { value: '', label: 'Unassigned' },
  { value: 'u1', label: 'Ananya Bains' },
  { value: 'u2', label: 'Ruthvik Majety' },
  { value: 'u3', label: 'Tanya Batra' },
];

function renderSearchableCell(props = {}) {
  const onChange = vi.fn();
  render(
    <Select value="u1" onChange={onChange} ariaLabel="Reassign lead" options={OPTIONS} searchable {...props}>
      <span>Ananya Bains</span>
    </Select>
  );
  return { onChange };
}

describe('Select — searchable popover (custom trigger)', () => {
  it('opens on trigger click and shows all options with the current one checked', async () => {
    renderSearchableCell();
    await userEvent.click(screen.getByRole('button', { name: 'Reassign lead' }));
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByRole('option', { name: /Ananya Bains/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Ruthvik Majety' })).toBeTruthy();
  });

  it('filters options by the search box and hides non-matches', async () => {
    renderSearchableCell();
    await userEvent.click(screen.getByRole('button', { name: 'Reassign lead' }));
    await userEvent.type(screen.getByPlaceholderText('Search…'), 'ruth');
    expect(screen.getByRole('option', { name: 'Ruthvik Majety' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Tanya Batra' })).toBeNull();
  });

  it('shows "No matches" when the search excludes every option', async () => {
    renderSearchableCell();
    await userEvent.click(screen.getByRole('button', { name: 'Reassign lead' }));
    await userEvent.type(screen.getByPlaceholderText('Search…'), 'zzz-no-such-name');
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('calls onChange with the picked value and closes the popover', async () => {
    const { onChange } = renderSearchableCell();
    await userEvent.click(screen.getByRole('button', { name: 'Reassign lead' }));
    await userEvent.click(screen.getByRole('option', { name: 'Ruthvik Majety' }));
    expect(onChange).toHaveBeenCalledWith('u2');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Escape closes the popover without calling onChange', async () => {
    const { onChange } = renderSearchableCell();
    await userEvent.click(screen.getByRole('button', { name: 'Reassign lead' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Enter commits the highlighted (first filtered) option', async () => {
    const { onChange } = renderSearchableCell();
    await userEvent.click(screen.getByRole('button', { name: 'Reassign lead' }));
    await userEvent.type(screen.getByPlaceholderText('Search…'), 'tanya');
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('u3');
  });
});

describe('Select — non-searchable dropdown menu (default TriggerPill)', () => {
  // The trigger's accessible name is the static placeholder (aria-label),
  // not the current selection — matches the original FilterSelect this was
  // promoted from (a screen-reader user hears "what this picks", a sighted
  // user reads the live value off the trigger's visible text). Assert the
  // visible label via textContent, and find the trigger by its stable name.
  it('renders the current value as the trigger label and lists every option on open', async () => {
    const onChange = vi.fn();
    render(<Select value="u2" onChange={onChange} placeholder="Assignee" options={OPTIONS} />);
    const trigger = screen.getByRole('button', { name: 'Assignee' });
    expect(trigger).toHaveTextContent('Ruthvik Majety');
    await userEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: /Tanya Batra/ })).toBeTruthy();
  });

  it('falls back to the placeholder when nothing matches the current value', () => {
    render(<Select value="does-not-exist" onChange={vi.fn()} placeholder="Assignee" options={OPTIONS} />);
    expect(screen.getByRole('button', { name: 'Assignee' })).toHaveTextContent('Assignee');
  });

  it('calls onChange with the picked value on selection', async () => {
    const onChange = vi.fn();
    render(<Select value="u1" onChange={onChange} placeholder="Assignee" options={OPTIONS} />);
    await userEvent.click(screen.getByRole('button', { name: 'Assignee' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Tanya Batra/ }));
    expect(onChange).toHaveBeenCalledWith('u3');
  });
});

describe('Select — long values', () => {
  it('shortens a long selected value inside its box (truncate, full text on hover) instead of spilling', () => {
    const long = 'Himanshu Prasad (himanshu.prasad@screen-magic.com)';
    render(<Select value="a" onChange={() => {}} options={[{ value: 'a', label: long }]} />);
    const span = screen.getByText(long);
    expect(span.className).toMatch(/truncate/);
    expect(span.className).toMatch(/min-w-0/);
    expect(span).toHaveAttribute('title', long);
  });
});

