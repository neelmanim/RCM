import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CampaignsSection } from '../../features/sales-tools/CampaignsSection';
import { EmailTemplateService, EmailCampaignService } from '../../services/api';

vi.mock('../../services/api', () => ({
  EmailTemplateService: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  EmailCampaignService: {
    list: vi.fn().mockResolvedValue({ campaigns: [], total: 0, pages: 1 }),
    get: vi.fn().mockResolvedValue({}),
  },
  LeadsService: { getLeads: vi.fn().mockResolvedValue({ leads: [], total: 0, pages: 1 }) },
  AssignmentsService: {
    getSdrs: vi.fn().mockResolvedValue([]),
    getUploadLogs: vi.fn().mockResolvedValue({ logs: [] }),
  },
}));

// can_edit/created_by_name mirror what GET /api/email-templates actually
// returns since v12.2. Before that the list returned neither, so the UI
// offered everyone an Edit button that only failed on save — while Delete
// was correctly refused. That inconsistency is what these cover.
const MINE = {
  id: 't1', name: 'My Intro', subject: 'Hi there', body: '<p>Hello</p>',
  created_by: 'me', created_by_name: 'Me', can_edit: true,
};
const THEIRS = {
  id: 't2', name: 'Ravi Intro', subject: 'Hey', body: '<p>Yo</p>',
  created_by: 'ravi', created_by_name: 'Ravi Kumar', can_edit: false,
};

const openTemplatesTab = async () => {
  render(<CampaignsSection userRole="Pod Admin" />);
  await userEvent.click(screen.getByText('Templates'));
  await waitFor(() => expect(EmailTemplateService.list).toHaveBeenCalled());
};

describe('TemplatesList — ownership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers Edit and Delete on a template you own', async () => {
    EmailTemplateService.list.mockResolvedValue({ templates: [MINE] });
    await openTemplatesTab();

    expect(screen.getByLabelText('Edit template')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete template')).toBeInTheDocument();
  });

  it("offers neither Edit nor Delete on someone else's, and attributes it to them", async () => {
    EmailTemplateService.list.mockResolvedValue({ templates: [THEIRS] });
    await openTemplatesTab();

    expect(screen.queryByLabelText('Edit template')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete template')).not.toBeInTheDocument();
    // Duplicate instead — shows the content and can never 403.
    expect(screen.getByLabelText('Duplicate template')).toBeInTheDocument();
    expect(screen.getByText('by Ravi Kumar')).toBeInTheDocument();
  });

  it('duplicating loads it as a new draft rather than editing in place', async () => {
    EmailTemplateService.list.mockResolvedValue({ templates: [THEIRS] });
    await openTemplatesTab();

    await userEvent.click(screen.getByLabelText('Duplicate template'));
    expect(screen.getByDisplayValue('Copy of Ravi Intro')).toBeInTheDocument();
    // Still in create mode — the button must not say "Update".
    expect(screen.getByRole('button', { name: 'Save Template' })).toBeInTheDocument();
  });

  it('confirms before deleting, since templates are shared team-wide', async () => {
    EmailTemplateService.list.mockResolvedValue({ templates: [MINE] });
    EmailTemplateService.delete.mockResolvedValue({});
    await openTemplatesTab();

    await userEvent.click(screen.getByLabelText('Delete template'));
    // Previously a single unguarded click deleted it for the whole team.
    expect(EmailTemplateService.delete).not.toHaveBeenCalled();
    expect(screen.getByText(/removes it for everyone/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(EmailTemplateService.delete).toHaveBeenCalledWith('t1'));
  });

  it('cancelling the confirm leaves the template alone', async () => {
    EmailTemplateService.list.mockResolvedValue({ templates: [MINE] });
    await openTemplatesTab();

    await userEvent.click(screen.getByLabelText('Delete template'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(EmailTemplateService.delete).not.toHaveBeenCalled();
  });

  it('gives the template editor merge-field chips instead of making you type tokens', async () => {
    EmailTemplateService.list.mockResolvedValue({ templates: [] });
    await openTemplatesTab();

    expect(screen.getByText('{{first_name}}')).toBeInTheDocument();
    expect(screen.getByText('{{company}}')).toBeInTheDocument();
  });
});
