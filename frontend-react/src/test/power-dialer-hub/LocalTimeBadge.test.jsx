import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocalTimeBadge } from '../../features/power-dialer-hub/components/LocalTimeBadge';

describe('LocalTimeBadge', () => {
  afterEach(() => vi.useRealTimers());

  it('renders nothing for a falsy/non-string phone (getPhoneTimezone returns null)', () => {
    const { container } = render(<LocalTimeBadge phone="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the local time for a US number, marked business-hours at a daytime instant', () => {
    // 2026-08-10T15:00:00Z -> 11:00 AM Eastern (EDT, UTC-4 in August)
    vi.useFakeTimers().setSystemTime(new Date('2026-08-10T15:00:00Z'));
    render(<LocalTimeBadge phone="+12125550100" />);
    expect(screen.getByText(/11:00 AM/)).toBeInTheDocument();
    expect(screen.getByTitle(/Business hours/)).toBeInTheDocument();
  });

  it('flags an off-hours instant for the same number', () => {
    // 2026-08-10T09:00:00Z -> 5:00 AM Eastern — well outside business hours
    vi.useFakeTimers().setSystemTime(new Date('2026-08-10T09:00:00Z'));
    render(<LocalTimeBadge phone="+12125550100" />);
    expect(screen.getByTitle(/Outside office hours/)).toBeInTheDocument();
  });

  it('defaults bare 10-digit numbers to India (IST), matching phone_timezone.js', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-08-10T09:00:00Z')); // 2:30 PM IST
    render(<LocalTimeBadge phone="9876543210" />);
    expect(screen.getByText(/02:30 PM/)).toBeInTheDocument();
  });
});
