import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavSidebar } from '../../layout/NavSidebar';

// Regression test for a real bug: PodsHub (v11.5.7) was built specifically
// for Pod Admins to see their own team's Team Roster, but the nav link's
// role gate here was left at ['Super Admin'] — the feature shipped to
// staging with the exact role it was built for unable to reach it. The
// backend (GET /pods) already scoped correctly; only this list was wrong.
describe('NavSidebar POD Management gating', () => {
  it('shows POD Management to Pod Admins', () => {
    render(<NavSidebar userRole="Pod Admin" />);
    expect(screen.getByText('POD Management')).toBeInTheDocument();
  });

  it('shows POD Management to Super Admins', () => {
    render(<NavSidebar userRole="Super Admin" />);
    expect(screen.getByText('POD Management')).toBeInTheDocument();
  });

  it('hides POD Management from SDRs', () => {
    render(<NavSidebar userRole="SDR" />);
    expect(screen.queryByText('POD Management')).not.toBeInTheDocument();
  });
});
