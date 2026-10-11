import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MailboxPicker, mailboxSummary } from '../../components/MailboxPicker';

const POOL = Array.from({ length: 12 }, (_, i) => ({
  email: `m${i}@${i < 9 ? 'big.com' : 'small.io'}`, domain: i < 9 ? 'big.com' : 'small.io', daily_limit: 30,
}));

function Harness({ initial = [] }) {
  const [sel, setSel] = React.useState(initial);
  return <MailboxPicker accounts={POOL} selected={sel} onChange={setSel} />;
}

describe('MailboxPicker', () => {
  it('pages 8 at a time, searches, and filters by domain', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText('Showing 1–8 of 12')).toBeInTheDocument();
    expect(screen.queryByText('m9@small.io')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('m9@small.io')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search mailboxes'), 'm1');
    expect(screen.getByText('m1@big.com')).toBeInTheDocument();
    expect(screen.getByText('m10@small.io')).toBeInTheDocument();
    expect(screen.queryByText('m2@big.com')).not.toBeInTheDocument();
  });

  it('"select all" picks every mailbox matching the filter, across pages', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MailboxPicker accounts={POOL} selected={[]} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Domain' }));
    await user.click(screen.getByRole('menuitem', { name: 'big.com (9)' }));
    await user.click(screen.getByLabelText('Select all matching mailboxes'));
    expect(onChange).toHaveBeenLastCalledWith(POOL.slice(0, 9).map((a) => a.email));
  });

  it('clicking a row toggles it and the summary says what that means', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['m0@big.com']} />);
    expect(screen.getByText('Selected: 1 mailbox on 1 domain · up to 30 emails/day')).toBeInTheDocument();
    await user.click(screen.getByText('m1@big.com'));
    expect(screen.getByText('Selected: 2 mailboxes on 1 domain · up to 60 emails/day')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText('None selected')).toBeInTheDocument();
  });

  it('summary handles missing daily limits', () => {
    expect(mailboxSummary([{ email: 'x@a.com', domain: 'a.com' }])).toBe('1 mailbox on 1 domain');
  });
});
