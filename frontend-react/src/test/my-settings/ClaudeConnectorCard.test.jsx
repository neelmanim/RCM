import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClaudeConnectorCard } from '../../features/my-settings/ClaudeConnectorCard';
import { ClaudeConnectorService } from '../../services/api';

vi.mock('../../services/api', () => ({
  ClaudeConnectorService: { listKeys: vi.fn(), createKey: vi.fn(), revokeKey: vi.fn() },
}));
vi.mock('../../features/my-settings/toast', () => ({ toast: vi.fn() }));

const existing = { id: 'k1', name: 'Laptop', key_prefix: 'lsk_abcd1234', created_at: '2026-10-06T09:00:00Z', last_used_at: null };

describe('ClaudeConnectorCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ClaudeConnectorService.listKeys.mockResolvedValue({ available: true, keys: [existing], connector_url: 'https://api.example.com/mcp', write_enabled: false });
  });

  it('shows the connector URL, read-only status, and existing keys by prefix only', async () => {
    render(<ClaudeConnectorCard />);
    expect(await screen.findByText('https://api.example.com/mcp')).toBeInTheDocument();
    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(screen.getByText('Laptop')).toBeInTheDocument();
    expect(screen.getByText(/lsk_abcd1234…/)).toBeInTheDocument();
  });

  it('creating a key shows it once, with a copy-now warning, until dismissed', async () => {
    const user = userEvent.setup();
    ClaudeConnectorService.createKey.mockResolvedValue({ id: 'k2', name: 'Desk', key: 'lsk_SECRET_VALUE', key_prefix: 'lsk_SECRET_V' });
    render(<ClaudeConnectorCard />);
    await user.type(await screen.findByLabelText('New key name'), 'Desk');
    await user.click(screen.getByRole('button', { name: /Create key/ }));
    expect(ClaudeConnectorService.createKey).toHaveBeenCalledWith('Desk');
    expect(await screen.findByText('lsk_SECRET_VALUE')).toBeInTheDocument();
    expect(screen.getByText(/won't be able to see it again/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: "I've copied it" }));
    expect(screen.queryByText('lsk_SECRET_VALUE')).not.toBeInTheDocument();
  });

  it('revoking asks for confirmation first, then revokes and refreshes', async () => {
    const user = userEvent.setup();
    ClaudeConnectorService.revokeKey.mockResolvedValue({ ok: true });
    render(<ClaudeConnectorCard />);
    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    expect(ClaudeConnectorService.revokeKey).not.toHaveBeenCalled();
    expect(screen.getByText(/will stop working immediately/)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Revoke' });
    await user.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(ClaudeConnectorService.revokeKey).toHaveBeenCalledWith('k1'));
    expect(ClaudeConnectorService.listKeys).toHaveBeenCalledTimes(2);
  });

  it('renders nothing at all for someone the connector is not open to (no "not allowed" message)', async () => {
    ClaudeConnectorService.listKeys.mockResolvedValue({ available: false, keys: [], connector_url: '', write_enabled: false });
    const { container } = render(<ClaudeConnectorCard />);
    await waitFor(() => expect(ClaudeConnectorService.listKeys).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('tells you exactly what to fill in on Claude\'s "Add custom connector" dialog', async () => {
    render(<ClaudeConnectorCard />);
    expect(await screen.findByText(/leave both empty/)).toBeInTheDocument();
    expect(screen.getByText('Remote MCP server URL:')).toBeInTheDocument();
  });

  it('a load failure shows the reason instead of a blank card', async () => {
    ClaudeConnectorService.listKeys.mockRejectedValue({ response: { data: { detail: 'Session expired' } } });
    render(<ClaudeConnectorCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Session expired');
  });
});
