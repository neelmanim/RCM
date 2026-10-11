import React from 'react';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from './ui/Table';
import { Pagination } from './ui/Pagination';
import { SearchInput } from './ui/SearchInput';
import { Select } from './ui/Select';
import { Checkbox } from './ui/Checkbox';
import { Button } from './ui/Button';

const PER_PAGE = 8;

/** Plain-words summary of a mailbox selection — what it actually means for sending. */
export function mailboxSummary(list) {
  const domains = new Set(list.map((a) => a.domain)).size;
  const perDay = list.reduce((n, a) => n + (a.daily_limit || 0), 0);
  const count = `${list.length} mailbox${list.length === 1 ? '' : 'es'} on ${domains} domain${domains === 1 ? '' : 's'}`;
  return perDay ? `${count} · up to ${perDay.toLocaleString()} emails/day` : count;
}

/** Instantly mailboxes in a searchable, paginated table, filterable by domain.
 *  Shared by Control Center (which mailboxes cadences may use) and the cadence
 *  step's "Send from" (which of those this step uses), so both look and behave
 *  the same. `selected` is an array of emails; onChange gets the new array. */
export function MailboxPicker({ accounts, selected, onChange }) {
  const [search, setSearch] = React.useState('');
  const [domain, setDomain] = React.useState('');
  const [page, setPage] = React.useState(1);
  const picked = new Set(selected);

  const domains = [...new Set(accounts.map((a) => a.domain))].sort();
  const q = search.trim().toLowerCase();
  const shown = accounts.filter((a) => (!domain || a.domain === domain) && (!q || a.email.toLowerCase().includes(q)));
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const current = Math.min(page, pages);
  const rows = shown.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  const allShown = shown.length > 0 && shown.every((a) => picked.has(a.email));

  const set = (emails, on) => {
    const next = new Set(picked);
    emails.forEach((e) => (on ? next.add(e) : next.delete(e)));
    onChange(accounts.map((a) => a.email).filter((e) => next.has(e)));   // keep the table's order
  };
  const filterBy = (fn) => { fn(); setPage(1); };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={(e) => filterBy(() => setSearch(e.target.value))}
          placeholder="Search mailboxes…" className="flex-1 min-w-[10rem]" aria-label="Search mailboxes" />
        <Select ariaLabel="Domain" className="justify-between" value={domain}
          onChange={(v) => filterBy(() => setDomain(v))}
          options={[{ value: '', label: `All domains (${domains.length})` },
            ...domains.map((d) => ({ value: d, label: `${d} (${accounts.filter((a) => a.domain === d).length})` }))]} />
      </div>
      <Table>
        <TableHead>
          <tr>
            <TableHeader className="w-8">
              <Checkbox checked={allShown} onChange={() => set(shown.map((a) => a.email), !allShown)}
                aria-label={allShown ? 'Unselect all matching mailboxes' : 'Select all matching mailboxes'} />
            </TableHeader>
            <TableHeader>Mailbox</TableHeader>
            <TableHeader>Domain</TableHeader>
            <TableHeader className="text-right">Per day</TableHeader>
          </tr>
        </TableHead>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.email} onClick={() => set([a.email], !picked.has(a.email))} className="cursor-pointer">
              <TableCell>
                <Checkbox checked={picked.has(a.email)} onChange={() => set([a.email], !picked.has(a.email))}
                  onClick={(e) => e.stopPropagation()} aria-label={a.email} />
              </TableCell>
              <TableCell className="text-slate-800">{a.email}</TableCell>
              <TableCell className="text-slate-500">{a.domain}</TableCell>
              <TableCell className="text-right text-slate-500">{a.daily_limit ?? '—'}</TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow><TableCell colSpan={4} className="text-center text-slate-400">No mailboxes match.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      <Pagination page={current} pages={pages} total={shown.length} perPage={PER_PAGE} onChange={setPage} />
      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>{picked.size ? `Selected: ${mailboxSummary(accounts.filter((a) => picked.has(a.email)))}` : 'None selected'}</span>
        {picked.size > 0 && <Button variant="ghost" size="sm" onClick={() => onChange([])}>Clear selection</Button>}
      </div>
    </div>
  );
}
