import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { DataSection } from '../../features/control-center/sections/DataSection';
import { SandboxService, UploadService, PodsService, AdminService } from '../../services/api';

vi.mock('../../services/api', () => ({
  SandboxService: {
    getEnv: vi.fn(),
    getTokenStatus: vi.fn(),
    getConnection: vi.fn(),
  },
  UploadService: {
    previewCsv: vi.fn(),
    uploadSheet: vi.fn(),
    previewGSheet: vi.fn(),
    importGSheet: vi.fn(),
    getLogs: vi.fn(),
    getBatchDetail: vi.fn(),
    rollback: vi.fn(),
  },
  PodsService: { getAll: vi.fn() },
  AdminService: { getUsers: vi.fn() },
}));

describe('DataSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PodsService.getAll.mockResolvedValue([]);
    AdminService.getUsers.mockResolvedValue([]);
    UploadService.getLogs.mockResolvedValue({ logs: [], total: 0, page: 1, pages: 1, summary: {} });
  });

  it('shows the production token panel when the environment is production', async () => {
    SandboxService.getEnv.mockResolvedValue({ is_staging: false, environment: 'production', self_test_enabled: false });
    SandboxService.getTokenStatus.mockResolvedValue({ configured: false });

    render(<DataSection />);

    await waitFor(() => expect(screen.getByText('Production')).toBeInTheDocument());
    expect(screen.getByText('Generate Sandbox Token')).toBeInTheDocument();
    await waitFor(() => expect(
      screen.getByText('No sandbox token configured. Generate one to allow staging access.')
    ).toBeInTheDocument());
  });

  it('shows the staging connection panel when the environment is staging', async () => {
    SandboxService.getEnv.mockResolvedValue({ is_staging: true, environment: 'staging', self_test_enabled: false });
    SandboxService.getConnection.mockResolvedValue({ connected: false });

    render(<DataSection />);

    await waitFor(() => expect(screen.getByText('Staging')).toBeInTheDocument());
    // StagingPanel fetches its own connection status independently of the
    // env badge above — wait for that second async render too.
    await waitFor(() => expect(screen.getByText('Connect to Production')).toBeInTheDocument());
  });

  it('renders the Upload Center with the CSV and Google Sheets tabs', async () => {
    SandboxService.getEnv.mockResolvedValue({ is_staging: false, environment: 'production', self_test_enabled: false });
    SandboxService.getTokenStatus.mockResolvedValue({ configured: false });

    render(<DataSection />);

    await waitFor(() => expect(screen.getByText('Upload Center')).toBeInTheDocument());
    expect(screen.getByText('Upload File')).toBeInTheDocument();
    expect(screen.getByText('Drag & drop your file here')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Google Sheets'));
    expect(screen.getByText('Google Sheets URL')).toBeInTheDocument();
  });
});
