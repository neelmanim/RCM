import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DigestTab } from '../../features/csm-portal/DigestTab';
import { CsmPortalService } from '../../services/api';

vi.mock('../../services/api', () => ({
  CsmPortalService: { getDigest: vi.fn() },
}));

const DIGEST = {
  total_accounts: 12, critical_count: 2, at_risk_count: 3, renewals_due_soon_count: 4,
  renewals_due_soon_label: 'Closing within 30 days (or overdue)', playbook_executions_this_week: 5,
  estimated_minutes_saved: 75, estimate_label: 'Estimated — 5 playbook execution(s) this week × 15 assumed minutes each',
};

describe('DigestTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders every summary tile and the time-saved card', async () => {
    CsmPortalService.getDigest.mockResolvedValue(DIGEST);
    render(<DigestTab />);

    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());
    expect(screen.getByText('Total accounts')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('At Risk')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Renewals due soon')).toBeInTheDocument();
    expect(screen.getByText('75 min')).toBeInTheDocument();
    expect(screen.getByText(DIGEST.estimate_label)).toBeInTheDocument();
    // Never claims to be a real measurement.
    expect(screen.getByText(/An estimate, not a measurement/)).toBeInTheDocument();
  });

  it('shows an error message instead of a blank screen on load failure', async () => {
    CsmPortalService.getDigest.mockRejectedValue(new Error('down'));
    render(<DigestTab />);
    await waitFor(() => expect(screen.getByText('Failed to load the digest.')).toBeInTheDocument());
  });
});
