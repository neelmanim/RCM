import { describe, it, expect } from 'vitest';
import releases from '../../features/help-hub/data/releases.json';

const KNOWN_BADGE_VARIANTS = new Set([
  'default', 'primary', 'success', 'warning', 'danger', 'info',
  'purple', 'emerald', 'indigo', 'teal', 'rose',
]);

describe('releases.json', () => {
  it('has at least the 159 entries migrated from the classic changelog', () => {
    // Floor, not exact equality — this file grows every release.
    expect(releases.length).toBeGreaterThanOrEqual(159);
  });

  it('every entry has a non-empty version, date, and either items or a summary', () => {
    // A "minor" entry (see AGENT_PROTOCOL.md's family-grouping convention,
    // go-forward only) uses `summary` (a one-liner) instead of `items[]`.
    for (const entry of releases) {
      expect(entry.version, JSON.stringify(entry)).toBeTruthy();
      expect(entry.date, JSON.stringify(entry)).toBeTruthy();
      const hasItems = Array.isArray(entry.items) && entry.items.length > 0;
      const hasSummary = typeof entry.summary === 'string' && entry.summary.length > 0;
      expect(hasItems || hasSummary, JSON.stringify(entry)).toBe(true);
    }
  });

  it('a "minor" entry has a family and no items array; a family-grouped "major" entry has items', () => {
    for (const entry of releases) {
      if (entry.kind === 'minor') {
        expect(entry.family, JSON.stringify(entry)).toBeTruthy();
        expect(typeof entry.summary, JSON.stringify(entry)).toBe('string');
      }
      if (entry.family && entry.kind !== 'minor') {
        expect(Array.isArray(entry.items) && entry.items.length > 0, JSON.stringify(entry)).toBe(true);
      }
    }
  });

  it('every tag uses a real Badge.jsx variant', () => {
    // A "minor" entry renders via MinorEntryLine, which never reads `tags` —
    // omitting the field entirely is the correct shape for that kind, not a gap.
    for (const entry of releases) {
      for (const tag of entry.tags ?? []) {
        expect(KNOWN_BADGE_VARIANTS.has(tag.variant), `entry ${entry.version} tag "${tag.label}" has unknown variant "${tag.variant}"`).toBe(true);
      }
    }
  });
});
