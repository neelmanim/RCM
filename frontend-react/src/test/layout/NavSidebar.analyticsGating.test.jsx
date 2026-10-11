import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavSidebar } from '../../layout/NavSidebar';

// Regression test for a real bug: v11.5.15 widened Analytics Hub to SDRs
// (backend require_admin_or_ae + _effective_ae_sdr), but this separate
// role list -- the one that actually controls the live sidebar -- was
// left without 'SDR', so the nav link never appeared for the role the
// feature was built for. Same shape as the PodsHub gap in
// NavSidebar.podsGating.test.jsx.
describe('NavSidebar Analytics Hub gating', () => {
  it('shows Analytics Hub to SDRs', () => {
    render(<NavSidebar userRole="SDR" />);
    expect(screen.getByText('Analytics Hub')).toBeInTheDocument();
  });

  it('shows Analytics Hub to AEs', () => {
    render(<NavSidebar userRole="AE" />);
    expect(screen.getByText('Analytics Hub')).toBeInTheDocument();
  });

  it('shows Analytics Hub to Pod Admins and Super Admins', () => {
    render(<NavSidebar userRole="Pod Admin" />);
    expect(screen.getByText('Analytics Hub')).toBeInTheDocument();
    render(<NavSidebar userRole="Super Admin" />);
    expect(screen.getAllByText('Analytics Hub').length).toBeGreaterThan(0);
  });
});
