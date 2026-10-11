import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavSidebar } from '../../layout/NavSidebar';

// 2026-09-16: Dashboard (My Leads/Calling/Meetings Booked), Leaderboard (a
// meetings-booked competition), Leads (a lead pipeline table), and Sales
// Tools (Cadence/Campaigns run against selected leads) are all SDR/AE
// lead-activity concepts that don't exist for a CSM's account-portfolio
// work. A live check showed: CSM landing on an all-zero Dashboard by
// default, an irrelevant Leaderboard, a "0 leads in pipeline" Leads page
// with a guided tour teaching Call Lists/Cadence, and a Sales Tools page
// listing other reps' cadences with nothing of the CSM's own to act on.
// All four are now hidden from CSM; their Inbox nav item is the landing
// view instead (see app.js _parseHash).
describe('NavSidebar CSM gating', () => {
  it('hides Dashboard, Leaderboard, Leads, and Sales Tools from CSM', () => {
    render(<NavSidebar userRole="CSM" />);
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Leaderboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Leads')).not.toBeInTheDocument();
    expect(screen.queryByText('Sales Tools')).not.toBeInTheDocument();
  });

  it('still shows Dashboard, Leaderboard, Leads, and Sales Tools to AE, SDR, Pod Admin, and Super Admin', () => {
    for (const role of ['AE', 'SDR', 'Pod Admin', 'Super Admin']) {
      const { unmount } = render(<NavSidebar userRole={role} />);
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Leaderboard')).toBeInTheDocument();
      expect(screen.getByText('Leads')).toBeInTheDocument();
      expect(screen.getByText('Sales Tools')).toBeInTheDocument();
      unmount();
    }
  });
});
