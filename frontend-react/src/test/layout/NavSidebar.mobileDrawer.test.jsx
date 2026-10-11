import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavSidebar } from '../../layout/NavSidebar';

// RCA 2026-08-26: the sidebar migrated from vanilla JS (which had a real
// mobile layout) to React with no responsive handling at all — a fixed
// 220px column, always in-flow, ate over half of any phone-width viewport
// with no way to collapse it. Below NavHub.css's breakpoint it's now an
// off-canvas drawer instead, toggled from NavTopbar's hamburger button.
describe('NavSidebar mobile drawer', () => {
  it('adds the mobile-open class when mobileNavOpen is true', () => {
    render(<NavSidebar userRole="SDR" mobileNavOpen />);
    expect(document.querySelector('.nh-sidebar--mobile-open')).toBeInTheDocument();
  });

  it('does not add the mobile-open class by default', () => {
    render(<NavSidebar userRole="SDR" />);
    expect(document.querySelector('.nh-sidebar--mobile-open')).not.toBeInTheDocument();
  });

  it('clicking a nav link navigates AND closes the mobile drawer', async () => {
    const onNavigate = vi.fn();
    const onCloseMobileNav = vi.fn();
    const user = userEvent.setup();
    render(<NavSidebar userRole="SDR" mobileNavOpen onNavigate={onNavigate} onCloseMobileNav={onCloseMobileNav} />);

    await user.click(screen.getByText('Leads'));

    expect(onNavigate).toHaveBeenCalledWith('leads');
    expect(onCloseMobileNav).toHaveBeenCalledOnce();
  });

  it('clicking the backdrop closes the mobile drawer without navigating', async () => {
    const onNavigate = vi.fn();
    const onCloseMobileNav = vi.fn();
    const user = userEvent.setup();
    render(<NavSidebar userRole="SDR" mobileNavOpen onNavigate={onNavigate} onCloseMobileNav={onCloseMobileNav} />);

    await user.click(document.querySelector('.nh-mobile-backdrop'));

    expect(onCloseMobileNav).toHaveBeenCalledOnce();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
