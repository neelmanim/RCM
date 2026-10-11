import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SfFieldMappingCard } from '../../features/control-center/sections/SfFieldMappingCard';
import { SfMappingService, AuditService } from '../../services/api';

vi.mock('../../services/api', () => ({
  SfMappingService: { list: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn(), updateBuiltin: vi.fn(), resetBuiltin: vi.fn() },
  AuditService: { list: vi.fn() },
}));

const b = (key, label, sf, extra = {}) => ({ lead_field: key, label, sf_field: sf, default_sf_field: sf, enabled: true, overridden: false, locked: false, sf_object: 'Lead', ...extra });
const BUILTIN = [b('email', 'Email', 'Email', { locked: true }), b('title', 'Job title', 'Job_Title__c'), b('industry', 'Industry', 'Industry')];
const BASE = { builtin: BUILTIN, available: [{ value: 'vertical', label: 'Vertical' }], custom: [] };
const row = (i, extra = {}) => ({ id: `m${i}`, lead_field: `f${i}`, label: `Field ${String(i).padStart(2, '0')}`, sf_field: `Sf${String(i).padStart(2, '0')}__c`,
  sf_object: 'Lead', sf_type: 'string', verified: true, enabled: true, created_by: 'Asha Admin', created_at: '2026-10-09T09:30:00Z', ...extra });
const MANY = Array.from({ length: 12 }, (_, i) => row(i + 1));

const openAdd = async () => {
  await userEvent.click(screen.getAllByRole('button', { name: /Add Mapping/ })[0]);
  return within(await screen.findByRole('dialog'));
};

describe('SfFieldMappingCard', () => {
  beforeEach(() => { vi.clearAllMocks(); SfMappingService.list.mockResolvedValue(BASE); });

  it('starts empty, and Add with nothing filled in just reminds you what is needed', async () => {
    render(<SfFieldMappingCard />);
    await waitFor(() => expect(screen.getByText('No extra fields yet')).toBeInTheDocument());
    const dialog = await openAdd();
    expect(dialog.getByText('Lead')).toBeInTheDocument();                           // the object is named in the dialog
    await userEvent.click(dialog.getByRole('button', { name: 'Add Mapping' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Choose a Alternate CRM field and type its Salesforce API name.');
    expect(SfMappingService.add).not.toHaveBeenCalled();
  });

  it('a refused mapping shows the server\'s reason (naming the object) inside the dialog only, and it goes away', async () => {
    SfMappingService.add.mockRejectedValue({ response: { data: { detail: 'The Salesforce Lead object has no field called mahesh__c.' } } });
    render(<SfFieldMappingCard />);
    await waitFor(() => expect(screen.getByText('No extra fields yet')).toBeInTheDocument());
    let dialog = await openAdd();
    await userEvent.click(dialog.getByLabelText('Alternate CRM field'));
    await userEvent.click(await screen.findByText('Vertical'));
    const api = dialog.getByLabelText('Salesforce API name');
    await userEvent.type(api, 'mahesh__c');
    await userEvent.click(dialog.getByRole('button', { name: 'Add Mapping' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Lead object has no field called mahesh__c');
    expect(SfMappingService.add).toHaveBeenCalledWith('vertical', 'mahesh__c');

    await userEvent.type(api, 'x');                                                   // editing clears the message
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument();

    await userEvent.click(dialog.getByRole('button', { name: 'Add Mapping' }));       // fail again, then close and reopen
    await dialog.findByRole('alert');
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();                      // nothing left behind on the card
    dialog = await openAdd();
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
    expect(dialog.getByLabelText('Salesforce API name')).toHaveValue('');
  });

  it('lists mappings with their object and check status, 8 to a page, searchable and sortable', async () => {
    SfMappingService.list.mockResolvedValue({ ...BASE, custom: MANY });
    render(<SfFieldMappingCard />);
    expect(await screen.findByText('Field 01')).toBeInTheDocument();
    expect(screen.getByText('12 mappings')).toBeInTheDocument();
    expect(screen.getAllByText('Checked in Salesforce')).toHaveLength(8);
    expect(screen.queryByText('Field 09')).not.toBeInTheDocument();                   // page 2

    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByText('Field 09')).toBeInTheDocument();
    expect(screen.queryByText('Field 01')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Search mappings…'), 'sf11');           // search matches the Salesforce name, back to page 1
    expect(await screen.findByText('Field 11')).toBeInTheDocument();
    expect(screen.getByText('1 mapping')).toBeInTheDocument();
    expect(screen.queryByText('Field 09')).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Search mappings…'));
    await userEvent.type(screen.getByLabelText('Search mappings…'), 'zzz');
    expect(await screen.findByText(/No mapping matches "zzz"/)).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Search mappings…'));
    await userEvent.click(screen.getByRole('button', { name: /Salesforce Field/ }));    // sort ascending, then descending
    await userEvent.click(screen.getByRole('button', { name: /Salesforce Field/ }));
    const firstRow = screen.getAllByRole('row')[1];
    expect(within(firstRow).getByText('Field 12')).toBeInTheDocument();
  });

  it('edits a mapping: the dialog is prefilled, the change is sent, and a refusal is shown in the dialog', async () => {
    SfMappingService.list.mockResolvedValue({ ...BASE, custom: [row(1)] });
    SfMappingService.update.mockRejectedValueOnce({ response: { data: { detail: 'Nope__c on the Lead object is read-only in Salesforce.' } } }).mockResolvedValue({});
    render(<SfFieldMappingCard />);
    await userEvent.click(await screen.findByLabelText('Edit Field 01'));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Edit Salesforce Field Mapping')).toBeInTheDocument();
    const api = dialog.getByLabelText('Salesforce API name');
    expect(api).toHaveValue('Sf01__c');
    await userEvent.clear(api);
    await userEvent.type(api, 'Nope__c');
    await userEvent.click(dialog.getByRole('button', { name: 'Save Mapping' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('read-only in Salesforce');
    expect(SfMappingService.update).toHaveBeenCalledWith('m1', { lead_field: 'f1', sf_field: 'Nope__c' });

    await userEvent.clear(api);
    await userEvent.type(api, 'Budget__c');
    await userEvent.click(dialog.getByRole('button', { name: 'Save Mapping' }));
    await waitFor(() => expect(SfMappingService.update).toHaveBeenLastCalledWith('m1', { lead_field: 'f1', sf_field: 'Budget__c' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('switches a mapping off and removes it after confirming', async () => {
    SfMappingService.list.mockResolvedValue({ ...BASE, custom: [row(1)] });
    SfMappingService.update.mockResolvedValue({});
    SfMappingService.remove.mockResolvedValue({ ok: true });
    render(<SfFieldMappingCard />);
    await screen.findByText('Field 01');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Send Field 01' }));
    await waitFor(() => expect(SfMappingService.update).toHaveBeenCalledWith('m1', { enabled: false }));
    await userEvent.click(screen.getByLabelText('Remove Field 01'));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(SfMappingService.remove).toHaveBeenCalledWith('m1'));
  });

  it('says who added each mapping and when', async () => {
    SfMappingService.list.mockResolvedValue({ ...BASE, custom: [row(1)] });
    render(<SfFieldMappingCard />);
    await screen.findByText('Field 01');
    expect(screen.getByText('Asha Admin')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Added/ })).toBeInTheDocument();
  });

  // ── built-in mappings: all but the required ones can be edited or switched off ─────────────────────────────────
  const openBuiltin = async () => { await userEvent.click(await screen.findByRole('button', { name: /3 built-in fields \(1 required/ })); };

  it('built-in fields: required ones are locked, the rest can be edited or switched off', async () => {
    render(<SfFieldMappingCard />);
    await openBuiltin();
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit Email')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Send Email' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Edit Job title')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search built-in fields…'), 'industry');
    expect(screen.queryByText('Job title')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Edit Industry')).toBeInTheDocument();
  });

  it('editing a built-in sends the new Salesforce name; a refusal stays in the dialog and goes away when typing', async () => {
    SfMappingService.updateBuiltin.mockRejectedValueOnce({ response: { data: { detail: 'The Salesforce Lead object has no field called Nope__c.' } } });
    SfMappingService.updateBuiltin.mockResolvedValueOnce({});
    render(<SfFieldMappingCard />);
    await openBuiltin();
    await userEvent.click(screen.getByLabelText('Edit Job title'));
    const dialog = within(await screen.findByRole('dialog'));
    const input = dialog.getByLabelText('Salesforce API name');
    expect(input).toHaveValue('Job_Title__c');
    expect(dialog.getByText(/default is Job_Title__c/)).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'Nope__c');
    await userEvent.click(dialog.getByRole('button', { name: 'Save Mapping' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Lead object has no field called Nope__c');
    await userEvent.type(input, 'x');
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'Title');
    await userEvent.click(dialog.getByRole('button', { name: 'Save Mapping' }));
    await waitFor(() => expect(SfMappingService.updateBuiltin).toHaveBeenLastCalledWith('title', { sf_field: 'Title' }));
  });

  it('switching a built-in OFF asks first; switching it back ON does not', async () => {
    SfMappingService.updateBuiltin.mockResolvedValue({});
    render(<SfFieldMappingCard />);
    await openBuiltin();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Send Industry' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/will no longer be sent to Industry on the Salesforce Lead object/)).toBeInTheDocument();
    expect(SfMappingService.updateBuiltin).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(SfMappingService.updateBuiltin).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Send Industry' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Stop Sending' }));
    await waitFor(() => expect(SfMappingService.updateBuiltin).toHaveBeenCalledWith('industry', { enabled: false }));
  });

  it('an edited built-in shows its default and who changed it, and can be reset', async () => {
    SfMappingService.list.mockResolvedValue({ ...BASE, builtin: [b('title', 'Job title', 'Title', { default_sf_field: 'Job_Title__c', overridden: true, changed_by: 'asha@x.com', changed_at: '2026-10-09T09:30:00Z' })] });
    SfMappingService.resetBuiltin.mockResolvedValue({});
    render(<SfFieldMappingCard />);
    await userEvent.click(await screen.findByRole('button', { name: /1 built-in fields/ }));
    expect(screen.getByText(/default is Job_Title__c · changed by asha@x.com/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Reset Job title to default'));
    await waitFor(() => expect(SfMappingService.resetBuiltin).toHaveBeenCalledWith('title'));
  });

  it('History opens the permanent record of who added, changed or removed a mapping', async () => {
    AuditService.list.mockResolvedValue({ items: [{ id: 'e1', at: '2026-10-09T09:30:00Z', actor_name: 'Asha Admin', actor_email: 'asha@x.com', actor_role: 'Super Admin',
      category: 'sf_mapping', action: 'REMOVED', summary: 'Removed mapping: Vertical → Vertical__c', detail: {} }], total: 1, page: 1, pages: 1, per_page: 10 });
    render(<SfFieldMappingCard />);
    await userEvent.click(await screen.findByRole('button', { name: /History/ }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByText('Removed mapping: Vertical → Vertical__c')).toBeInTheDocument();
    expect(dialog.getByText('Asha Admin')).toBeInTheDocument();
    expect(AuditService.list).toHaveBeenCalledWith(expect.objectContaining({ category: 'sf_mapping' }));
  });
});
