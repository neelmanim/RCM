import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavTopbar } from '../../layout/NavTopbar';

// NavTopbar calls useAircallEverywhere() itself to decide whether the legacy
// manual Dial button should still show (see NavTopbar.jsx's
// aircallEverywhereActive gate). Mocking the hook directly — rather than its
// DialerService/SDK internals, already covered by useAircallEverywhere's own
// test file — isolates exactly the gating logic this test exists for.
let mockStatus = 'ineligible';
vi.mock('../../features/aircall-everywhere/useAircallEverywhere', () => ({
  useAircallEverywhere: () => ({ status: mockStatus, callActive: false }),
  OPT_OUT_KEY: 'aircall_everywhere_pref',
  CONTAINER_ID: 'aircall-everywhere-mount',
}));

describe('NavTopbar — Aircall Everywhere / legacy Dial button gating', () => {
  const noop = () => {};

  it('shows the manual Dial button for a RCM/ineligible SDR (their only way to dial an ad-hoc number)', () => {
    mockStatus = 'ineligible';
    render(<NavTopbar onNavigate={noop} onAction={noop} onSearch={noop} />);
    expect(document.getElementById('nh-manual-dial-btn')).toBeInTheDocument();
  });

  it.each(['loading', 'ready', 'notready'])('hides the manual Dial button while Aircall Everywhere is active (status=%s)', (status) => {
    mockStatus = status;
    render(<NavTopbar onNavigate={noop} onAction={noop} onSearch={noop} />);
    expect(document.getElementById('nh-manual-dial-btn')).not.toBeInTheDocument();
  });

  it.each(['opted_out', 'error'])('shows the manual Dial button again once %s (no other way to dial an ad-hoc number)', (status) => {
    mockStatus = status;
    render(<NavTopbar onNavigate={noop} onAction={noop} onSearch={noop} />);
    expect(document.getElementById('nh-manual-dial-btn')).toBeInTheDocument();
  });
});
