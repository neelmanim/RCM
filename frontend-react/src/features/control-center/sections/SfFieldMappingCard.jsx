import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, ChevronDown, ChevronRight, Lock, History, RotateCcw } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Switch } from '../../../components/ui/Switch';
import { Select } from '../../../components/ui/Select';
import { SearchInput } from '../../../components/ui/SearchInput';
import { Pagination } from '../../../components/ui/Pagination';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../components/ui/Table';
import { SortableTableHeader } from '../../../components/ui/SortableTableHeader';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonCard } from '../../../components/ui/Skeleton';
import { ConfirmDialog, Modal } from '../../../components/ui/Modal';
import { useTableView } from '../../../utils/useTableView';
import { SfMappingService } from '../../../services/api';
import { toast, errorText } from '../notify';
import { Banner } from './Banner';
import { AuditLogPanel, formatWhen } from './AuditLogPanel';

const CUSTOM_SEARCH = ['label', 'lead_field', 'sf_field'];
const BUILTIN_SEARCH = ['label', 'lead_field', 'sf_field'];
const OBJECT = 'Lead';             // the Salesforce object every mapping here writes to

const TableToolbar = ({ view, placeholder, noun }) => (
  <div className="flex items-center justify-between gap-3 mb-3">
    <SearchInput className="w-72" placeholder={placeholder} value={view.query} onChange={(e) => view.setQuery(e.target.value)} aria-label={placeholder} />
    <span className="text-xs text-slate-500">{view.total} {noun}{view.total === 1 ? '' : 's'}</span>
  </div>
);

// Extra Alternate CRM -> Salesforce fields, set here instead of in code. The table is the page; adding and editing happen in a dialog.
export function SfFieldMappingCard() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [dialog, setDialog] = useState(null);          // null | { mode: 'add' } | { mode: 'edit', row }
  const [leadField, setLeadField] = useState('');
  const [sfField, setSfField] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [showBuiltin, setShowBuiltin] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editBuiltin, setEditBuiltin] = useState(null);   // a built-in row being re-pointed
  const [builtinSf, setBuiltinSf] = useState('');
  const [stopping, setStopping] = useState(null);         // a built-in row about to be switched off

  const load = useCallback(async () => {
    try { setData(await SfMappingService.list()); setLoadError(''); }
    catch { setLoadError('Could not load the field mapping.'); setData((d) => d || { custom: [], builtin: [], available: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const custom = useTableView(data?.custom || [], { searchKeys: CUSTOM_SEARCH });
  const builtin = useTableView(data?.builtin || [], { searchKeys: BUILTIN_SEARCH, pageSize: 10 });

  const openDialog = (next) => {
    setLeadField(next.row?.lead_field || '');
    setSfField(next.row?.sf_field || '');
    setError('');
    setDialog(next);
  };
  const closeDialog = () => { setDialog(null); setError(''); };
  // A refusal reads for a while, then goes; it also clears as soon as the person edits a field.
  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => setError(''), 12000);
    return () => clearTimeout(t);
  }, [error]);

  // Changes made from the table (switch, remove) report by toast; the dialog keeps its own inline error.
  const act = async (fn, done) => {
    setBusy(true);
    try { await fn(); await load(); toast(done); return true; }
    catch (e) { toast(errorText(e), 'error'); return false; }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (!leadField || !sfField.trim()) { setError('Choose a Alternate CRM field and type its Salesforce API name.'); return; }
    setBusy(true);
    setError('');
    try {
      if (dialog.mode === 'edit') await SfMappingService.update(dialog.row.id, { lead_field: leadField, sf_field: sfField });
      else await SfMappingService.add(leadField, sfField);
      await load();
      toast(dialog.mode === 'edit' ? 'Mapping updated' : 'Mapping added');
      closeDialog();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <SkeletonCard />;
  const fieldOptions = [
    { value: '', label: 'Choose a field' },
    ...(dialog?.mode === 'edit' ? [{ value: dialog.row.lead_field, label: dialog.row.label }] : []),
    ...data.available,
  ];
  const picked = fieldOptions.find((o) => o.value === leadField && o.value);

  return (
    <Card data-tour="cc-sf-mapping">
      <CardHeader
        title="Salesforce Field Mapping"
        subtitle={`Extra Alternate CRM fields sent to the Salesforce ${OBJECT} object on every lead create and update.`}
        actions={(
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowHistory(true)}><History size={14} /> History</Button>
            <Button size="sm" onClick={() => openDialog({ mode: 'add' })}><Plus size={14} /> Add Mapping</Button>
          </div>
        )}
      />
      <CardContent className="space-y-4">
        <Banner text={loadError} tone="error" />

        {data.custom.length ? (
          <div>
            <TableToolbar view={custom} placeholder="Search mappings…" noun="mapping" />
            {custom.total ? (
              <Table>
                <TableHead>
                  <TableRow>
                    <SortableTableHeader label="Alternate CRM Field" sortKey="label" sort={custom.sort} onSort={custom.toggleSort} />
                    <SortableTableHeader label="Salesforce Field" sortKey="sf_field" sort={custom.sort} onSort={custom.toggleSort} />
                    <TableHeader>Object</TableHeader>
                    <SortableTableHeader label="Added" sortKey="created_at" sort={custom.sort} onSort={custom.toggleSort} />
                    <SortableTableHeader label="Status" sortKey="verified" sort={custom.sort} onSort={custom.toggleSort} />
                    <SortableTableHeader label="Sending" sortKey="enabled" sort={custom.sort} onSort={custom.toggleSort} />
                    <TableHeader><span className="sr-only">Actions</span></TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {custom.shown.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-semibold text-slate-700">{m.label}</TableCell>
                      <TableCell><code className="text-xs">{m.sf_field}</code></TableCell>
                      <TableCell>{m.sf_object || OBJECT}</TableCell>
                      <TableCell>
                        <div className="text-sm text-slate-700">{m.created_by || '—'}</div>
                        <div className="text-xs text-slate-400">{formatWhen(m.created_at)}</div>
                      </TableCell>
                      <TableCell>
                        {m.verified
                          ? <Badge variant="success">Checked in Salesforce</Badge>
                          : <Badge variant="warning" title="Salesforce was not connected when this was saved">Not checked</Badge>}
                      </TableCell>
                      <TableCell>
                        <Switch checked={m.enabled} ariaLabel={`Send ${m.label}`} disabled={busy}
                          onChange={(e) => act(() => SfMappingService.update(m.id, { enabled: e.target.checked }), 'Saved')} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" aria-label={`Edit ${m.label}`} onClick={() => openDialog({ mode: 'edit', row: m })}><Pencil size={14} /></Button>
                          <Button size="sm" variant="ghost" aria-label={`Remove ${m.label}`} onClick={() => setRemoving(m)}><Trash2 size={14} /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState title="No matches" message={`No mapping matches "${custom.query}".`} />
            )}
            {custom.total > custom.pageSize && (
              <Pagination page={custom.page} pages={custom.pages} total={custom.total} perPage={custom.pageSize} onChange={custom.setPage} />
            )}
          </div>
        ) : (
          <EmptyState
            title="No extra fields yet"
            message="Only Alternate CRM's built-in fields go to Salesforce. Use Add Mapping to send one more — no code change needed."
          />
        )}

        <p className="text-xs text-slate-500">
          Empty values are never sent, so a blank never overwrites Salesforce. If Salesforce refuses one field, that field is skipped
          and the rest of the lead still saves.
        </p>

        <div>
          <Button size="sm" variant="ghost" onClick={() => setShowBuiltin((v) => !v)} aria-expanded={showBuiltin}>
            {showBuiltin ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {data.builtin.length} built-in fields ({data.builtin.filter((b) => b.locked).length} required, the rest editable)
          </Button>
          {showBuiltin && (
            <div className="mt-3">
              <TableToolbar view={builtin} placeholder="Search built-in fields…" noun="field" />
              <Table>
                <TableHead>
                  <TableRow>
                    <SortableTableHeader label="Alternate CRM Field" sortKey="label" sort={builtin.sort} onSort={builtin.toggleSort} />
                    <SortableTableHeader label="Salesforce Field" sortKey="sf_field" sort={builtin.sort} onSort={builtin.toggleSort} />
                    <TableHeader>Object</TableHeader>
                    <TableHeader>Sending</TableHeader>
                    <TableHeader><span className="sr-only">Actions</span></TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {builtin.shown.map((b) => (
                    <TableRow key={b.lead_field}>
                      <TableCell className="font-semibold text-slate-700">{b.label}</TableCell>
                      <TableCell>
                        <code className="text-xs">{b.sf_field}</code>
                        {b.overridden && <div className="text-xs text-slate-400">Alternate CRM's default is {b.default_sf_field}{b.changed_by ? ` · changed by ${b.changed_by}` : ''}{b.changed_at ? `, ${formatWhen(b.changed_at)}` : ''}</div>}
                      </TableCell>
                      <TableCell>{b.sf_object || OBJECT}</TableCell>
                      <TableCell>
                        {b.locked
                          ? <Badge variant="default" title="Alternate CRM needs this one to identify the lead and keep its status in step"><Lock size={11} className="inline -mt-0.5" /> Required</Badge>
                          : (
                            <Switch checked={b.enabled} ariaLabel={`Send ${b.label}`} disabled={busy}
                              onChange={(e) => (e.target.checked
                                ? act(() => SfMappingService.updateBuiltin(b.lead_field, { enabled: true }), 'Saved')
                                : setStopping(b))} />
                          )}
                      </TableCell>
                      <TableCell>
                        {!b.locked && (
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="ghost" aria-label={`Edit ${b.label}`} onClick={() => { setEditBuiltin(b); setBuiltinSf(b.sf_field); setError(''); }}><Pencil size={14} /></Button>
                            {b.overridden && <Button size="sm" variant="ghost" aria-label={`Reset ${b.label} to default`} disabled={busy} onClick={() => act(() => SfMappingService.resetBuiltin(b.lead_field), 'Back to Alternate CRM\'s default')}><RotateCcw size={14} /></Button>}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {builtin.total > builtin.pageSize && (
                <Pagination page={builtin.page} pages={builtin.pages} total={builtin.total} perPage={builtin.pageSize} onChange={builtin.setPage} />
              )}
            </div>
          )}
        </div>
      </CardContent>

      {/* Same dialog (and footer buttons) as every other confirmation on this page; the form is its body. */}
      <ConfirmDialog
        open={!!dialog}
        onClose={closeDialog}
        title={dialog?.mode === 'edit' ? 'Edit Salesforce Field Mapping' : 'Add a Salesforce Field Mapping'}
        confirmLabel={dialog?.mode === 'edit' ? 'Save Mapping' : 'Add Mapping'}
        loading={busy}
        onConfirm={submit}
      >
        <div className="space-y-4">
          <div>
            <span className="block text-sm font-medium text-slate-700 mb-1">Salesforce object</span>
            <p className="text-sm text-slate-800">{OBJECT}</p>
          </div>
          <div>
            <span className="block text-sm font-medium text-slate-700 mb-1">Alternate CRM field</span>
            <Select value={leadField} onChange={(v) => { setLeadField(v); setError(''); }} ariaLabel="Alternate CRM field" searchable className="w-full justify-between" options={fieldOptions} />
          </div>
          <Input label="Salesforce API name" placeholder="Budget__c" value={sfField}
            onChange={(e) => { setSfField(e.target.value); setError(''); }}
            hint={`The field's API name on the Salesforce ${OBJECT} object — custom fields end in __c.`} containerClassName="!mb-0" />
          {picked && sfField.trim() && (
            <p className="text-xs text-slate-500">{picked.label} will be sent to <code>{OBJECT}.{sfField.trim()}</code>.</p>
          )}
          <Banner text={error} tone="error" />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove this mapping?"
        message={removing ? `${removing.label} will stop going to ${removing.sf_field}. Values already in Salesforce stay as they are.` : ''}
        confirmLabel="Remove"
        confirmVariant="danger"
        onConfirm={async () => { const m = removing; setRemoving(null); await act(() => SfMappingService.remove(m.id), 'Mapping removed'); }}
      />

      <ConfirmDialog
        open={!!editBuiltin}
        onClose={() => { setEditBuiltin(null); setError(''); }}
        title="Edit Built-in Mapping"
        confirmLabel="Save Mapping"
        loading={busy}
        onConfirm={async () => {
          if (!builtinSf.trim()) { setError('Type the Salesforce API name.'); return; }
          setBusy(true);
          setError('');
          try {
            await SfMappingService.updateBuiltin(editBuiltin.lead_field, { sf_field: builtinSf });
            await load();
            toast('Mapping updated');
            setEditBuiltin(null);
          } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
        }}
      >
        {editBuiltin && (
          <div className="space-y-4">
            <div>
              <span className="block text-sm font-medium text-slate-700 mb-1">Salesforce object</span>
              <p className="text-sm text-slate-800">{OBJECT}</p>
            </div>
            <div>
              <span className="block text-sm font-medium text-slate-700 mb-1">Alternate CRM field</span>
              <p className="text-sm text-slate-800">{editBuiltin.label}</p>
            </div>
            <Input label="Salesforce API name" value={builtinSf} onChange={(e) => { setBuiltinSf(e.target.value); setError(''); }}
              hint={`Alternate CRM's default is ${editBuiltin.default_sf_field}. The field must exist on the Salesforce ${OBJECT} object.`} containerClassName="!mb-0" />
            <Banner text={error} tone="error" />
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!stopping}
        onClose={() => setStopping(null)}
        title="Stop sending this field?"
        message={stopping ? `${stopping.label} will no longer be sent to ${stopping.sf_field} on the Salesforce ${OBJECT} object when a lead is created or updated. Values already in Salesforce stay as they are.` : ''}
        confirmLabel="Stop Sending"
        confirmVariant="danger"
        onConfirm={async () => { const b = stopping; setStopping(null); await act(() => SfMappingService.updateBuiltin(b.lead_field, { enabled: false }), 'Saved'); }}
      />

      <Modal open={showHistory} onClose={() => setShowHistory(false)} title="Mapping History" maxWidth="max-w-3xl">
        <p className="text-sm text-slate-500 mb-3">Who added, changed or removed a mapping, and when. Kept permanently.</p>
        <AuditLogPanel category="sf_mapping" searchLabel="Search by person or field…" emptyMessage="No mapping has been added or changed yet." pageSize={10} />
      </Modal>
    </Card>
  );
}
