import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavTopbar } from '../../layout/NavTopbar';

vi.mock('../../features/aircall-everywhere/useAircallEverywhere', () => ({
  useAircallEverywhere: () => ({ status: 'ineligible', callActive: false }),
  OPT_OUT_KEY: 'aircall_everywhere_pref',
  CONTAINER_ID: 'aircall-everywhere-mount',
}));

// RCA 2026-08-26: pairs with NavSidebar.mobileDrawer.test.jsx — this button
// is the only way to open the mobile drawer (hidden entirely on desktop via
// NavHub.css, but always rendered so it's togglable below the breakpoint).
describe('NavTopbar mobile nav toggle', () => {
  const noop = () => {};

  it('clicking the menu button calls onToggleMobileNav', async () => {
    const onToggleMobileNav = vi.fn();
    const user = userEvent.setup();
    render(<NavTopbar onNavigate={noop} onAction={noop} onSearch={noop} onToggleMobileNav={onToggleMobileNav} />);

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(onToggleMobileNav).toHaveBeenCalledOnce();
  });

  it('reflects mobileNavOpen in its accessible label and aria-expanded', () => {
    render(<NavTopbar onNavigate={noop} onAction={noop} onSearch={noop} mobileNavOpen />);
    const btn = screen.getByRole('button', { name: 'Close navigation menu' });
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });
});
