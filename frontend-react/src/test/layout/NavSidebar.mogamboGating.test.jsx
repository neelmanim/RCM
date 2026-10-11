import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NavSidebar, MOGAMBO_KEY } from '../../layout/NavSidebar';

const LOCKDOWN_EMAIL = 'neelmani.mishra@screen-magic.com';

// 2026-09-28: "Pipeline & CSM" was previously visible to the lockdown email
// by default; now it must be hidden from that account too, and only reveal
// itself for a #mogambo hash visit (app.js sets MOGAMBO_KEY in
// sessionStorage before NavSidebar ever mounts).
describe('NavSidebar mogambo gating', () => {
  afterEach(() => {
    sessionStorage.removeItem(MOGAMBO_KEY);
    cleanup();
  });

  it('hides Pipeline & CSM from Super Admin, even the lockdown email, with no unlock flag', () => {
    render(<NavSidebar userRole="Super Admin" userEmail={LOCKDOWN_EMAIL} />);
    expect(screen.queryByText('Pipeline & CSM')).not.toBeInTheDocument();
  });

  it('shows Pipeline & CSM once unlocked, but only for the lockdown email', () => {
    sessionStorage.setItem(MOGAMBO_KEY, '1');
    render(<NavSidebar userRole="Super Admin" userEmail={LOCKDOWN_EMAIL} />);
    expect(screen.getByText('Pipeline & CSM')).toBeInTheDocument();
  });

  it('ignores a stray unlock flag for any other account', () => {
    sessionStorage.setItem(MOGAMBO_KEY, '1');
    render(<NavSidebar userRole="Super Admin" userEmail="someone.else@screen-magic.com" />);
    expect(screen.queryByText('Pipeline & CSM')).not.toBeInTheDocument();
  });
});
