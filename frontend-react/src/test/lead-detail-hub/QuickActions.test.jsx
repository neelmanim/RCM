import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickActions } from '../../features/lead-detail-hub/rail/QuickActions';

describe('QuickActions — Message button (RCA 2026-09-28: legacy has a Message action, React had none)', () => {
  it('is hidden when the account has no SMS/WhatsApp channel enabled (canMessage=false)', () => {
    render(<QuickActions canModify={true} canMessage={false} onMessage={vi.fn()} />);
    expect(screen.queryByText('Message')).not.toBeInTheDocument();
  });

  it('is shown and wired to onMessage when the account has a channel enabled', async () => {
    const onMessage = vi.fn();
    render(<QuickActions canModify={true} canMessage={true} onMessage={onMessage} />);
    await userEvent.click(screen.getByText('Message'));
    expect(onMessage).toHaveBeenCalled();
  });

  it('stays hidden for a read-only viewer even if canMessage is true', () => {
    render(<QuickActions canModify={false} canMessage={true} onMessage={vi.fn()} />);
    expect(screen.queryByText('Message')).not.toBeInTheDocument();
  });
});

describe('QuickActions — Wrong number', () => {
  const show = (props) => render(<QuickActions canModify={true} hasPhone={true} phoneInvalid={false} {...props} />);

  it('is offered next to Call and wired to onWrongNumber', async () => {
    const onWrongNumber = vi.fn();
    show({ onWrongNumber });
    await userEvent.click(screen.getByRole('button', { name: /Wrong number/ }));
    expect(onWrongNumber).toHaveBeenCalled();
  });

  it('is hidden for a read-only viewer, a lead with no phone, and an already-flagged phone', () => {
    const { unmount } = show({ canModify: false });
    expect(screen.queryByText('Wrong number')).not.toBeInTheDocument();
    unmount();
    const second = show({ hasPhone: false });
    expect(screen.queryByText('Wrong number')).not.toBeInTheDocument();
    second.unmount();
    show({ phoneInvalid: true });
    expect(screen.queryByText('Wrong number')).not.toBeInTheDocument();
  });
});

vi.mock('../../services/api', () => ({
  SalesJourneyService: { list: vi.fn().mockResolvedValue([
    { id: 'j1', name: 'Demo Cadence', status: 'active' },
    { id: 'j2', name: 'Old draft', status: 'draft' },
  ]) },
}));

describe('QuickActions — Enroll in Cadence (v13.7.0: was Leads-list bulk only)', () => {
  it('lists live cadences only and hands the picked one to onEnroll', async () => {
    const onEnroll = vi.fn();
    render(<QuickActions canModify={true} onEnroll={onEnroll} />);
    await userEvent.click(screen.getByRole('button', { name: /Enroll in Cadence/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Demo Cadence' }));
    expect(screen.queryByText('Old draft')).not.toBeInTheDocument();
    expect(onEnroll).toHaveBeenCalledWith(expect.objectContaining({ id: 'j1' }));
  });

  it('is not offered to a read-only viewer', () => {
    render(<QuickActions canModify={false} onEnroll={vi.fn()} />);
    expect(screen.queryByText('Enroll in Cadence')).not.toBeInTheDocument();
  });
});
