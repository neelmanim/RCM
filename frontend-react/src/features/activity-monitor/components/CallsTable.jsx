import React, { useState } from 'react';
import { Phone, Headset, Send as SendIcon, ClipboardList, ArrowUpRight, ArrowDownLeft, Play, Pause, Download, AlertTriangle } from 'lucide-react';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../../components/ui/Table';
import { SortableTableHeader } from '../../../components/ui/SortableTableHeader';
import { IconButton } from '../../../components/ui/IconButton';
import { Badge } from '../../../components/ui/Badge';
import { timeAgo, fmtDuration } from '../lib/format';
import { CallsExpandRow } from './CallsExpandRow';
import { EmptyState } from './EmptyState';

// Icon paired next to the Badge (not inside it, and never emoji) — matches
// this app's only existing icon+label convention (ContactCard.jsx,
// JourneyNode.jsx). Aircall is a company, not an airplane — Headset fits
// what it actually is (a calling/telephony provider).
const PROVIDER_BADGE = {
  messenger: ['indigo', Phone, 'Alternate Messenger'],
  aircall: ['purple', Headset, 'Aircall'],
  klenty: ['teal', SendIcon, 'Klenty'],
  manual: ['default', ClipboardList, 'Manual'],
};

function ProviderBadge({ provider }) {
  if (!provider) return <span className="text-slate-400">—</span>;
  const [variant, Icon, label] = PROVIDER_BADGE[provider.toLowerCase()] || ['default', null, provider];
  return (
    <span className="inline-flex items-center gap-1.5">
      {Icon && <Icon size={13} className="text-slate-400" />}
      <Badge variant={variant}>{label}</Badge>
    </span>
  );
}

export function DirectionBadge({ direction }) {
  if (!direction) return <span className="text-slate-400">—</span>;
  if (direction === 'outbound') {
    return <span className="inline-flex items-center gap-1"><ArrowUpRight size={13} className="text-slate-400" /><Badge variant="teal">Out</Badge></span>;
  }
  if (direction === 'inbound') {
    return <span className="inline-flex items-center gap-1"><ArrowDownLeft size={13} className="text-slate-400" /><Badge variant="info">In</Badge></span>;
  }
  return <Badge>{direction}</Badge>;
}

const OUTCOME_VARIANT = {
  Interested: 'success', 'Meeting Scheduled': 'success', 'Meeting Confirmed': 'success',
  'No Answer': 'default', 'Left Voicemail': 'default',
  'Call Back Later': 'warning',
  'Not Interested': 'danger', 'Not the Right Person': 'danger', Disqualified: 'danger',
};

function OutcomeBadge({ outcome }) {
  if (!outcome) return <span className="text-slate-400">—</span>;
  return <Badge variant={OUTCOME_VARIANT[outcome] || 'default'}>{outcome}</Badge>;
}

function StatusBadge({ status }) {
  if (!status) return <span className="text-slate-400">—</span>;
  const su = status.toUpperCase();
  const variant = su.includes('FAIL') ? 'danger'
    : (su.includes('ENDED') || su.includes('ANSWERED')) ? 'success'
    : su.includes('START') ? 'info' : 'default';
  return <Badge variant={variant}>{su.replace('CALL_', '')}</Badge>;
}

export const COLUMNS = ['Time', 'SDR', 'Lead', 'Provider', 'Direction', 'Duration', 'Outcome', 'Status', 'Recording'];

/** Calls tab — column-for-column parity with the legacy call_monitor.js table
 * (recording play/download, failed-call error banner, expandable transcript
 * panel). `onPlayingChange` bubbles up so the Hub can pause auto-refresh
 * while a recording plays, same guard the legacy page has. */
const SORT_KEYS = { Time: 'time', Duration: 'duration', Outcome: null, Status: 'status', Direction: 'direction', Provider: 'provider' };

export function CallsTable({ items, onOpenLead, onPlayingChange, sort, onSort }) {
  const [expandedId, setExpandedId] = useState(null);
  const [playingId, setPlayingId] = useState(null);

  const setPlaying = (id) => {
    setPlayingId(id);
    onPlayingChange?.(id != null);
  };

  if (!items.length) {
    return <EmptyState title="No calls found" />;
  }

  return (
    <Table>
      <TableHead>
        <TableRow>{COLUMNS.map((h) => {
          const sortKey = SORT_KEYS[h];
          return sortKey && sort && onSort
            ? <SortableTableHeader key={h} label={h} sortKey={sortKey} sort={sort} onSort={onSort} />
            : <TableHeader key={h}>{h}</TableHeader>;
        })}</TableRow>
      </TableHead>
      <TableBody>
        {items.map((c) => {
          const isFailed = !!c.status?.toUpperCase().includes('FAIL');
          const isExpanded = expandedId === c.id;
          return (
            <React.Fragment key={c.id}>
              <TableRow className={isFailed ? 'bg-red-50/40' : ''} onClick={() => setExpandedId(isExpanded ? null : c.id)}>
                <TableCell title={c.started_at || c.created_at || ''}>{timeAgo(c.started_at || c.created_at)}</TableCell>
                <TableCell>{c.sdr_name || <span className="text-slate-400">Unknown</span>}</TableCell>
                <TableCell className="whitespace-normal">
                  {c.lead_name ? (
                    <>
                      <div className="font-semibold text-slate-800">{c.lead_name}</div>
                      {c.lead_company && <div className="text-xs text-slate-400">{c.lead_company}</div>}
                    </>
                  ) : <span className="text-slate-400">{c.phone_number || '—'}</span>}
                </TableCell>
                <TableCell><ProviderBadge provider={c.provider} /></TableCell>
                <TableCell><DirectionBadge direction={c.direction} /></TableCell>
                <TableCell>{fmtDuration(c.duration)}</TableCell>
                <TableCell><OutcomeBadge outcome={c.outcome} /></TableCell>
                <TableCell><StatusBadge status={c.status} /></TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {c.recording_url ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50"
                        onClick={() => { if (!isExpanded) setExpandedId(c.id); setPlaying(playingId === c.id ? null : c.id); }}
                      >
                        {playingId === c.id ? <Pause size={12} /> : <Play size={12} />}
                        {playingId === c.id ? 'Pause' : 'Play'}
                      </button>
                      <IconButton as="a" href={c.recording_url} download target="_blank" rel="noreferrer" title="Download recording">
                        <Download size={14} />
                      </IconButton>
                    </div>
                  ) : <span className="text-slate-400">—</span>}
                </TableCell>
              </TableRow>
              {isFailed && c.error_detail && (
                <tr>
                  <TableCell colSpan={9} className="bg-red-50 text-red-700 text-xs font-semibold whitespace-normal">
                    <span className="inline-flex items-center gap-1.5"><AlertTriangle size={13} className="shrink-0" />{c.error_detail}</span>
                  </TableCell>
                </tr>
              )}
              {isExpanded && (
                <tr>
                  {/* whitespace-normal: TableCell defaults to whitespace-nowrap unless
                      overridden — without this, long transcripts/notes render as one
                      unbroken line and blow out the table width (the SS1/SS2 bug). */}
                  <TableCell colSpan={9} className="bg-slate-50 whitespace-normal">
                    <CallsExpandRow
                      call={c}
                      isPlaying={playingId === c.id}
                      onAudioEnded={() => setPlaying(null)}
                      onOpenLead={onOpenLead}
                      onCollapse={() => setExpandedId(null)}
                    />
                  </TableCell>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
