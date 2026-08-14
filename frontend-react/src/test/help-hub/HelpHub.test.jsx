import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HelpHub } from '../../features/help-hub/HelpHub';
import { SECTIONS } from '../../features/help-hub/data/sections';
import { stripLeadingEmoji } from '../../features/help-hub/text';
import { APP_VERSION } from '../../generated/version';

describe('HelpHub', () => {
  it('renders the header and all SDR-visible sections collapsed by default', () => {
    render(<HelpHub userRole="SDR" />);
    expect(screen.getByText('Help & User Guide')).toBeInTheDocument();
    expect(screen.getByText('SDR', { selector: 'strong' })).toBeInTheDocument();

    const sdrSections = SECTIONS.filter(s => s.roles.includes('sdr'));
    for (const s of sdrSections) {
      expect(screen.getByText(stripLeadingEmoji(s.title))).toBeInTheDocument();
    }
    // Admin-only content must not leak into the SDR view
    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
  });

  it('has no Kanban Board section — decommissioned', () => {
    expect(SECTIONS.some(s => s.title.includes('Kanban'))).toBe(false);
    render(<HelpHub userRole="Super Admin" />);
    expect(screen.queryByText(/Kanban/)).not.toBeInTheDocument();
  });

  it('shows admin-only sections for Super Admin', () => {
    render(<HelpHub userRole="Super Admin" />);
    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
    expect(screen.getByText('POD Management')).toBeInTheDocument();
  });

  it('section titles render without their old leading emoji (lucide icon is the only icon now)', () => {
    render(<HelpHub userRole="Super Admin" />);
    expect(screen.queryByText('🚀 Getting Started')).not.toBeInTheDocument();
    expect(screen.getByText('Getting Started')).toBeInTheDocument();
  });

  it('release notes are pinned first, before every other section', () => {
    render(<HelpHub userRole="Super Admin" />);
    const headers = screen.getAllByRole('button').map(b => b.textContent);
    const releaseNotesIdx = headers.findIndex(t => t.includes("What's New"));
    const gettingStartedIdx = headers.findIndex(t => t.includes('Getting Started'));
    expect(releaseNotesIdx).toBeGreaterThanOrEqual(0);
    expect(releaseNotesIdx).toBeLessThan(gettingStartedIdx);
  });

  it('expands a section on click and collapses it again', () => {
    render(<HelpHub userRole="Super Admin" />);
    const header = screen.getByText('Getting Started');
    expect(screen.queryByText('Logging In')).not.toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.getByText('Logging In')).toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.queryByText('Logging In')).not.toBeInTheDocument();
  });

  it('renders the role name into section content via the (role, roleName) function', () => {
    render(<HelpHub userRole="Pod Admin" />);
    fireEvent.click(screen.getByText('Getting Started'));
    expect(screen.getByText('Your Role: Pod Admin')).toBeInTheDocument();
  });

  it('search filters sections and auto-expands matches', () => {
    render(<HelpHub userRole="Super Admin" />);
    const search = screen.getByPlaceholderText('Search the guide...');

    fireEvent.change(search, { target: { value: 'leaderboard' } });
    expect(screen.getByText('Leaderboard & SDR Performance')).toBeInTheDocument();
    expect(screen.queryByText('Getting Started')).not.toBeInTheDocument();
  });

  it('search matches a single release-note entry, not just the whole section', () => {
    render(<HelpHub userRole="Super Admin" />);
    const search = screen.getByPlaceholderText('Search the guide...');
    fireEvent.change(search, { target: { value: 'kanban board load faster' } });
    expect(screen.getByText("What's New — Release Notes")).toBeInTheDocument();
    expect(screen.getAllByText(/v10\.6\.37/).length).toBeGreaterThan(0);
    // A version with no matching text shouldn't render
    expect(screen.queryByText('v10.6.36')).not.toBeInTheDocument();
  });

  it('search does not crash on a "minor" release entry (has summary, no tags/items)', () => {
    render(<HelpHub userRole="Super Admin" />);
    fireEvent.change(screen.getByPlaceholderText('Search the guide...'), {
      target: { value: 'squeezed for no reason' }, // unique text from v10.9.1's summary
    });
    expect(screen.getAllByText(/v10\.9\.1/).length).toBeGreaterThan(0);
  });

  it('shows a no-results message for a query matching nothing', () => {
    render(<HelpHub userRole="SDR" />);
    fireEvent.change(screen.getByPlaceholderText('Search the guide...'), {
      target: { value: 'zzzznonexistentquery' },
    });
    expect(screen.getByText(/No results for/)).toBeInTheDocument();
  });

  it('renders the footer with the real app version', () => {
    render(<HelpHub userRole="SDR" />);
    expect(screen.getByText(new RegExp(`v${APP_VERSION}`))).toBeInTheDocument();
  });

  it('paginates release notes with a Load more button, not shown while searching', () => {
    render(<HelpHub userRole="Super Admin" />);
    fireEvent.click(screen.getByText("What's New — Release Notes"));
    expect(screen.getByText(/Load more/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search the guide...'), {
      target: { value: 'kanban board load faster' },
    });
    expect(screen.queryByText(/Load more/)).not.toBeInTheDocument();
  });
});
