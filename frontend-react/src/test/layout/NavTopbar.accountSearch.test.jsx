import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavTopbar } from '../../layout/NavTopbar';

// 2026-09-16: global search only ever covered leads/users — a CSM has
// neither, so there was no way to find their own accounts from the
// topbar. Backend now also returns matching accounts (CSM scoped to their
// own portfolio, admin sees all); this covers the new dropdown group and
// its deep-link into CSM Portal.
describe('NavTopbar — Accounts search group', () => {
  const noop = () => {};

  beforeEach(() => {
    window._globalSearchFn = vi.fn().mockResolvedValue({
      leads: [], users: [],
      accounts: [{ id: 'acc-1', name: 'Wayne Analytics', industry: 'Tech' }],
    });
    window._loadView = vi.fn();
  });

  afterEach(() => {
    delete window._globalSearchFn;
    delete window._loadView;
  });

  it('renders an Accounts group and deep-links a CSM to their own flat Portfolio item on click', async () => {
    const user = userEvent.setup();
    render(<NavTopbar userRole="CSM" onNavigate={noop} onAction={noop} onSearch={noop} />);

    await user.type(screen.getByLabelText('Search'), 'Wayne');
    await waitFor(() => expect(screen.getByText('Accounts')).toBeInTheDocument());
    expect(screen.getByText('Wayne Analytics')).toBeInTheDocument();

    await user.click(screen.getByText('Wayne Analytics'));
    // 2026-09-16: 'csm-portal' no longer exists as a route — a CSM's own
    // Portfolio is now a flat top-level nav item.
    expect(window._loadView).toHaveBeenCalledWith('csm-portfolio', 'acc-1');
  });

  it('deep-links a Super Admin to the merged Pipeline hub on click', async () => {
    const user = userEvent.setup();
    render(<NavTopbar userRole="Super Admin" onNavigate={noop} onAction={noop} onSearch={noop} />);

    await user.type(screen.getByLabelText('Search'), 'Wayne');
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());

    await user.click(screen.getByText('Wayne Analytics'));
    expect(window._loadView).toHaveBeenCalledWith('pipeline-hub', 'acc-1');
  });

  it('does not offer "view all results" (Enter/footer) to a CSM — no leads results page applies', async () => {
    const user = userEvent.setup();
    render(<NavTopbar userRole="CSM" onNavigate={noop} onAction={noop} onSearch={noop} />);

    await user.type(screen.getByLabelText('Search'), 'Wayne');
    await waitFor(() => expect(screen.getByText('Wayne Analytics')).toBeInTheDocument());
    expect(screen.queryByText(/view all results/)).not.toBeInTheDocument();
  });
});
