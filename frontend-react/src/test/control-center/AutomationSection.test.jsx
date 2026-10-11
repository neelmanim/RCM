import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AutomationSection } from '../../features/control-center/sections/AutomationSection';
import { SettingsService, SalesJourneyService } from '../../services/api';

vi.mock('../../services/api', () => ({
  SettingsService: {
    getSyncSettings: vi.fn(),
    patchSyncSettings: vi.fn(),
  },
  SalesJourneyService: {
    list: vi.fn(),
    get: vi.fn(),
  },
}));

const baseSettings = {
  llm_provider: 'groq',
  llm_model: 'llama-3.3-70b-versatile',
  llm_api_key: 'gsk_xxxx',
  research_prompt: '',
};

describe('AutomationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SettingsService.getSyncSettings.mockResolvedValue(baseSettings);
    SalesJourneyService.list.mockResolvedValue([]);
  });

  it('loads AI settings and renders the configured provider', async () => {
    render(<AutomationSection />);
    await waitFor(() => expect(SettingsService.getSyncSettings).toHaveBeenCalled());
    expect(await screen.findByText('AI Research Configuration')).toBeInTheDocument();
    expect(await screen.findByText('Research Prompt Editor')).toBeInTheDocument();
  });

  // RCA 2026-09-03: Research Gate + Bulk Research Pre-Population cards were
  // removed from this section per user request (legacy settings.js keeps
  // both working — only these Control Center cards are gone) and Call
  // Outcomes Configuration moved to IntegrationsSection's CRM Settings tab.
  // None of the three should render here any more.
  it('no longer renders Research Gate, Bulk Research, or Call Outcomes', async () => {
    render(<AutomationSection />);
    await waitFor(() => expect(SettingsService.getSyncSettings).toHaveBeenCalled());
    expect(screen.queryByText('Research Gate')).not.toBeInTheDocument();
    expect(screen.queryByText('Bulk Research Pre-Population')).not.toBeInTheDocument();
    expect(screen.queryByText('Call Outcomes Configuration')).not.toBeInTheDocument();
  });

  it('shows an empty state for Send Windows when there are no cadences', async () => {
    render(<AutomationSection />);
    expect(await screen.findByText('No cadences yet')).toBeInTheDocument();
  });

  // RCA 2026-09-24: unlike IntegrationsSection, this section never refetched
  // after a save — the "Configured" hint kept showing the pre-save API key
  // state until a hard refresh. patchSyncSettings resolving must trigger a
  // second getSyncSettings call so the parent's settings (and hasKey) update.
  it('refetches settings after saving the AI API key, so the Configured hint updates', async () => {
    SettingsService.patchSyncSettings.mockResolvedValue({});
    render(<AutomationSection />);
    await waitFor(() => expect(SettingsService.getSyncSettings).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'gsk_new_key' } });
    fireEvent.click(screen.getByText('Save AI Settings'));

    await waitFor(() => expect(SettingsService.getSyncSettings).toHaveBeenCalledTimes(2));
  });

  it('refetches settings after saving the research prompt', async () => {
    SettingsService.patchSyncSettings.mockResolvedValue({});
    render(<AutomationSection />);
    await waitFor(() => expect(SettingsService.getSyncSettings).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Save Prompt'));

    await waitFor(() => expect(SettingsService.getSyncSettings).toHaveBeenCalledTimes(2));
  });
});
