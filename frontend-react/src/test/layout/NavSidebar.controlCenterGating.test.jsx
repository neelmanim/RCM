import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavSidebar } from '../../layout/NavSidebar';

const UPDATE_SEEN_KEY = 'alternate:control-center-2026-09-parity-seen';

// Control Center is an additive surface. Gated to a single owner email
// originally, widened to all Super Admins 2026-09-04, and to Pod Admins in
// v12.2 — with the sections themselves individually role-gated so a Pod
// Admin only gets Team & Access (control-center/constants.js SECTION_TABS).
// See .claude/skills/settings-architecture/skill.md.
describe('NavSidebar Control Center gating', () => {
  it('shows Control Center to any Super Admin', () => {
    render(<NavSidebar userRole="Super Admin" />);
    expect(screen.getByText('Control Center')).toBeInTheDocument();
  });

  it('shows Control Center to a Pod Admin (Team & Access only, gated inside)', () => {
    render(<NavSidebar userRole="Pod Admin" />);
    expect(screen.getByText('Control Center')).toBeInTheDocument();
  });

  it('hides Control Center from an AE', () => {
    render(<NavSidebar userRole="AE" />);
    expect(screen.queryByText('Control Center')).not.toBeInTheDocument();
  });

  it('hides Control Center from an SDR', () => {
    render(<NavSidebar userRole="SDR" />);
    expect(screen.queryByText('Control Center')).not.toBeInTheDocument();
  });

  it('hides Control Center when no role is passed at all', () => {
    render(<NavSidebar />);
    expect(screen.queryByText('Control Center')).not.toBeInTheDocument();
  });
});

describe('NavSidebar Control Center "Updated" hint', () => {
  beforeEach(() => localStorage.removeItem(UPDATE_SEEN_KEY));

  it('shows the badge to a Super Admin who has not visited since the update', () => {
    render(<NavSidebar userRole="Super Admin" />);
    expect(screen.getByText('Updated')).toBeInTheDocument();
  });

  it('clears the badge and marks it seen once Control Center is clicked', async () => {
    const user = userEvent.setup();
    render(<NavSidebar userRole="Super Admin" />);
    await user.click(screen.getByText('Control Center'));
    expect(screen.queryByText('Updated')).not.toBeInTheDocument();
    expect(localStorage.getItem(UPDATE_SEEN_KEY)).toBe('1');
  });

  it('does not show the badge on a later visit once already seen', () => {
    localStorage.setItem(UPDATE_SEEN_KEY, '1');
    render(<NavSidebar userRole="Super Admin" />);
    expect(screen.queryByText('Updated')).not.toBeInTheDocument();
  });
});
