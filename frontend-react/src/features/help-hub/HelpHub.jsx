import React, { useState, useMemo } from 'react';
import { BookOpen, Compass } from 'lucide-react';
import { Section } from './Section';
import { SearchBar } from './SearchBar';
import { ReleaseNotesSection } from './ReleaseNotesSection';
import { GuidedToursSection } from './GuidedToursSection';
import { toursFor } from './data/tours';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { SECTIONS } from './data/sections';
import releases from './data/releases.json';
import { SECTION_ICONS_BY_TITLE, RELEASE_NOTES_ICON } from './icons';
import { stripMarkdown } from './markdown';
import { stripLeadingEmoji } from './text';
import { APP_VERSION, BRAND_TAGLINE } from '../../generated/version';

const RELEASE_NOTES_ID = 'release-notes';
const TOURS_ID = 'guided-tours';
const RELEASES_PAGE_SIZE = 15;

function roleBucketFor(userRole) {
  if (userRole === 'Super Admin' || userRole === 'Admin') return 'super_admin';
  if (userRole === 'Pod Admin') return 'pod_admin';
  if (userRole === 'AE') return 'ae';
  if (userRole === 'CSM') return 'csm';
  return 'sdr';
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export const HelpHub = ({ userRole = 'SDR' }) => {
  const role = roleBucketFor(userRole);
  const roleName = userRole;

  const [query, setQuery] = useState('');
  const [openIds, setOpenIds] = useState(() => new Set());
  const [visibleCount, setVisibleCount] = useState(RELEASES_PAGE_SIZE);

  const visibleSections = useMemo(
    () => SECTIONS.filter(s => s.roles.includes(role)),
    [role],
  );

  // Precompute each section's flat searchable text once per role — content
  // is static per role, so there's no reason to re-strip HTML on every
  // keystroke (the classic guide re-read live DOM textContent on every
  // input event; this is the same substring-match semantics, computed once).
  const searchableSections = useMemo(
    () => visibleSections.map(s => ({
      ...s,
      icon: SECTION_ICONS_BY_TITLE[s.title] || BookOpen,
      searchText: (s.title + ' ' + stripHtml(s.content(role, roleName))).toLowerCase(),
    })),
    [visibleSections, role, roleName],
  );

  const q = query.trim().toLowerCase();

  const matchedSections = q
    ? searchableSections.filter(s => s.searchText.includes(q))
    : searchableSections;

  // Release notes: match per-entry, not per-section — a search for e.g.
  // "recording" should land directly on the one matching release, not just
  // confirm the whole (159-entry) What's New section contains a hit.
  const matchedReleases = q
    ? releases.filter(r => {
        // A "minor" entry (see AGENT_PROTOCOL.md's family-grouping convention)
        // has neither `tags` nor `items` — it has `summary` instead.
        const hay = [
          r.version,
          r.date,
          r.title || '',
          r.summary || '',
          ...(r.tags || []).map(t => t.label),
          ...(r.items || []).map(stripMarkdown),
        ].join(' ').toLowerCase();
        return hay.includes(q);
      })
    : releases;

  const releaseNotesMatch = !q || matchedReleases.length > 0;

  // Pagination only applies when browsing (not searching) — a real search
  // hit should never be hidden behind "Load more".
  const pagedReleases = q ? matchedReleases : matchedReleases.slice(0, visibleCount);
  const hasMoreReleases = !q && visibleCount < matchedReleases.length;

  const isOpen = (id) => (q ? true : openIds.has(id));
  const toggle = (id) => {
    if (q) return; // while searching, matches stay expanded; manual toggle is a no-op
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const latestRelease = releases[0];

  return (
    <div className="helphub max-w-3xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex items-center gap-3 sm:gap-4 mb-6">
        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20 shrink-0">
          <BookOpen size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800 m-0">Help & User Guide</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Everything you need to know about Alternate CRM · Showing guide for <strong className="text-slate-700">{roleName}</strong>
          </p>
        </div>
      </div>

      <SearchBar value={query} onChange={setQuery} />

      <div>
        {/* Release notes pinned first — the most time-sensitive content,
            not buried after 19 other sections. */}
        {releaseNotesMatch && (
          <Section
            title="What's New — Release Notes"
            Icon={RELEASE_NOTES_ICON}
            open={isOpen(RELEASE_NOTES_ID)}
            onToggle={() => toggle(RELEASE_NOTES_ID)}
          >
            <ReleaseNotesSection releases={pagedReleases} />
            {hasMoreReleases && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisibleCount(c => c + RELEASES_PAGE_SIZE)}
                className="w-full mt-2 text-blue-600"
              >
                Load more ({matchedReleases.length - visibleCount} more)
              </Button>
            )}
          </Section>
        )}

        {(!q || 'guided tours show me around walkthrough'.includes(q) || toursFor(userRole).some((t) => t.title.toLowerCase().includes(q))) && (
          <Section title="Guided tours" Icon={Compass} open={isOpen(TOURS_ID)} onToggle={() => toggle(TOURS_ID)}>
            <GuidedToursSection role={userRole} />
          </Section>
        )}

        {matchedSections.map(s => (
          <Section key={s.id} title={stripLeadingEmoji(s.title)} Icon={s.icon} open={isOpen(s.id)} onToggle={() => toggle(s.id)}>
            <div dangerouslySetInnerHTML={{ __html: s.content(role, roleName) }} />
          </Section>
        ))}

        {q && matchedSections.length === 0 && !releaseNotesMatch && (
          <EmptyState message={`No results for "${query}".`} />
        )}
      </div>

      <div className="text-center py-8 text-xs text-slate-400">
        {BRAND_TAGLINE} · v{APP_VERSION} · Last updated {latestRelease?.date}
      </div>
    </div>
  );
};
