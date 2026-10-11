import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { NavSidebar } from '../../layout/NavSidebar';

// v13.7.0 (product owner, 2026-10-06): every role sees My Tasks — reversing
// 2026-09-16's Super Admin exclusion. A Super Admin who owns leads gets
// cadence approvals and had nowhere to find them.
describe('NavSidebar My Tasks', () => {
  it('shows My Tasks to every role, Super Admin included', () => {
    for (const role of ['Super Admin', 'AE', 'CSM', 'SDR', 'Pod Admin']) {
      const { unmount } = render(<NavSidebar userRole={role} />);
      expect(screen.getByText('My Tasks')).toBeInTheDocument();
      unmount();
    }
  });

  it('badges My Tasks with the approvals the bell reports', () => {
    render(<NavSidebar userRole="SDR" />);
    expect(screen.queryByTitle(/approvals waiting/)).not.toBeInTheDocument();
    act(() => { window.dispatchEvent(new CustomEvent('alternate:task-counts', { detail: { approvals: 3 } })); });
    expect(screen.getByTitle('3 approvals waiting for you')).toHaveTextContent('3');
    act(() => { window.dispatchEvent(new CustomEvent('alternate:task-counts', { detail: { approvals: 0 } })); });
    expect(screen.queryByTitle(/approvals waiting/)).not.toBeInTheDocument();
  });
});
