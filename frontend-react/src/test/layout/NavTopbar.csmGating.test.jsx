import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavTopbar } from '../../layout/NavTopbar';

// 2026-09-16: live check showed a CSM's topbar offering "New Lead" — a
// lead-creation action that has nowhere sensible to go in a CSM's
// account-based workflow (CSM works accounts, not leads). Calling stays
// available to every role, including CSM — explicit product direction:
// "calling functionality should be available for all the users no
// restriction on that" (an ad-hoc call, e.g. calling a champion contact
// directly, is a normal CSM action). The search box's placeholder also
// claimed to search "leads, phone, SDRs" — a CSM has no leads, so it only
// ever finds their own accounts (see NavTopbar.accountSearch.test.jsx).
describe('NavTopbar — CSM gating', () => {
  const noop = () => {};

  it('hides New Lead but keeps Dial for a CSM', () => {
    render(<NavTopbar userRole="CSM" onNavigate={noop} onAction={noop} onSearch={noop} />);
    expect(document.getElementById('nh-manual-dial-btn')).toBeInTheDocument();
    expect(document.getElementById('nh-new-lead-btn')).not.toBeInTheDocument();
  });

  it('shows an honest search placeholder for a CSM', () => {
    render(<NavTopbar userRole="CSM" onNavigate={noop} onAction={noop} onSearch={noop} />);
    expect(screen.getByPlaceholderText('Search accounts...')).toBeInTheDocument();
  });

  it('keeps Dial and New Lead for an SDR', () => {
    render(<NavTopbar userRole="SDR" onNavigate={noop} onAction={noop} onSearch={noop} />);
    expect(document.getElementById('nh-manual-dial-btn')).toBeInTheDocument();
    expect(document.getElementById('nh-new-lead-btn')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search leads, phone, SDRs...')).toBeInTheDocument();
  });
});
