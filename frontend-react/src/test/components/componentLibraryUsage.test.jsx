import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Mechanical enforcement for the `components/ui/` convention, which
 * AGENT_PROTOCOL §19/§19.1 documents and which has now failed twice: AE
 * Pipeline and CSM Portal (v12.4.0) hand-rolled a raw `<select>` and four
 * `<input type="date">` fields that `Select`/`DatePicker` already covered, and
 * `StageSelect.jsx` — a component-library file added BY a review finding about
 * duplication — was itself rendering a raw `<select>`.
 *
 * §19.1 proposed an ESLint `no-restricted-syntax` rule for this. That would not
 * have worked: `npm run lint` already reports 147 pre-existing errors and is
 * wired into neither a hook nor CI, so a 148th finding enforces nothing. This
 * runs in the suite that is actually green and actually gates work, and follows
 * the source-scanning guard in hub-entry.test.jsx, which is this repo's one
 * proven mechanism for a convention a reviewer keeps missing.
 *
 * Bare `<button>` is deliberately NOT checked. There are ~130 in features/ and
 * plenty are legitimate (icon buttons, tab triggers, table-cell affordances);
 * a rule that has to exempt most of its own matches is not a rule.
 */
describe('features/ use the shared component library', () => {
  const FEATURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'features');

  /** Pre-existing violations, frozen so new surfaces can't add to the pile.
   *  Not an endorsement — each is a real one to migrate to `Select`. Delete
   *  the entry when you fix the file; never add one to make a test pass. */
  const LEGACY_SELECT = new Set([
    'activity-monitor/components/FilterBar.jsx',
    'control-center/sections/data/SandboxRefreshCard.jsx',
    'messenger-widget/components/MessengerWidgetRoot.jsx',
    'messenger-widget/components/MessageTab.jsx',
    'power-dialer-hub/components/CurrentCallCard.jsx',
    'sales-tools/CampaignsSection.jsx',
  ]);

  function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name))
        : e.name.endsWith('.jsx') ? [join(dir, e.name)] : []
    );
  }

  // POSIX-style keys so the allowlist reads the same on any platform.
  const files = walk(FEATURES).map((f) => relative(FEATURES, f).split(sep).join('/'));

  it('finds the feature components', () => {
    // Guards the walk, not the count — adding a feature should not fail this.
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(files.filter((f) => !LEGACY_SELECT.has(f)))(
    '%s renders no raw <select> — use components/ui/Select',
    (file) => {
      expect(readFileSync(join(FEATURES, file), 'utf8')).not.toMatch(/<select[\s>]/);
    },
  );

  it.each(files)('%s renders no raw <input type="date"> — use components/ui/DatePicker', (file) => {
    const src = readFileSync(join(FEATURES, file), 'utf8');
    expect(src).not.toMatch(/type=["']date["']/);
  });

  it('every allowlisted legacy file still exists and still has the violation', () => {
    // A stale allowlist silently stops guarding. If one of these was fixed or
    // renamed, drop it from LEGACY_SELECT rather than leaving a dead exemption.
    for (const file of LEGACY_SELECT) {
      expect(files, `${file} is allowlisted but no longer exists`).toContain(file);
      expect(readFileSync(join(FEATURES, file), 'utf8'), `${file} no longer has a raw <select> — remove it from LEGACY_SELECT`).toMatch(/<select[\s>]/);
    }
  });
});
