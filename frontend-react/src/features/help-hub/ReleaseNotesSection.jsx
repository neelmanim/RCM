import React from 'react';
import { Badge } from '../../components/ui/Badge';
import { renderInlineMarkdown } from './markdown';
import { stripLeadingEmoji } from './text';

// Groups consecutive entries that share a `family` (e.g. "10.7") under one
// header — additive, go-forward-only support (see AGENT_PROTOCOL.md's
// release-notes section): entries authored before this existed have no
// `family` field and render exactly as they always have, ungrouped.
function groupByFamily(releases) {
  const groups = [];
  for (const entry of releases) {
    const last = groups[groups.length - 1];
    if (entry.family && last?.family === entry.family) {
      last.entries.push(entry);
    } else {
      groups.push({ family: entry.family, entries: [entry] });
    }
  }
  return groups;
}

const FullEntry = ({ entry }) => (
  <div className="border border-slate-200 rounded-lg p-4 mb-2.5 bg-slate-50/50">
    <div className="flex items-start justify-between gap-3 mb-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">{entry.version}</strong>
        {entry.tags.map((tag, j) => (
          <Badge key={j} variant={tag.variant}>{stripLeadingEmoji(tag.label)}</Badge>
        ))}
      </div>
      <span className="text-xs text-slate-400 whitespace-nowrap">{entry.date}</span>
    </div>
    {entry.title && (
      <div className="text-sm font-semibold text-blue-700 mb-1.5">{entry.title}</div>
    )}
    <ul className="pl-4 text-sm space-y-1 list-disc marker:text-slate-300">
      {entry.items.map((item, k) => (
        <li key={k}>{renderInlineMarkdown(item)}</li>
      ))}
    </ul>
  </div>
);

// A "minor" entry (patch release within an already-covered family) gets a
// single line instead of the full card — see groupByFamily's docblock.
const MinorEntryLine = ({ entry }) => (
  <div className="flex items-start justify-between gap-3 py-1.5 pl-3 border-l-2 border-slate-200 text-sm">
    <div className="flex flex-wrap items-center gap-1.5">
      <strong className="text-slate-600">{entry.version}</strong>
      <span className="text-slate-500">{renderInlineMarkdown(entry.summary)}</span>
    </div>
    <span className="text-xs text-slate-400 whitespace-nowrap shrink-0">{entry.date}</span>
  </div>
);

/**
 * Renders releases.json, optionally filtered down to a matching subset
 * (see SearchBar / HelpHub — a search hit is matched per-entry, not just
 * "the What's New section matched", so this can render a 1-entry list).
 */
export const ReleaseNotesSection = ({ releases }) => (
  <div>
    <p className="mb-3 text-sm text-slate-500">
      Track all production updates and new features. Most recent first.
    </p>
    {groupByFamily(releases).map((group, gi) => (
      group.family ? (
        <div key={gi} className="mb-3">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1.5 pl-1">v{group.family}</div>
          {group.entries.map((entry, i) => (
            entry.kind === 'minor'
              ? <MinorEntryLine key={i} entry={entry} />
              : <FullEntry key={i} entry={entry} />
          ))}
        </div>
      ) : (
        group.entries.map((entry, i) => <FullEntry key={i} entry={entry} />)
      )
    ))}
  </div>
);
