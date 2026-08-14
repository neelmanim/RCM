#!/usr/bin/env node
// ============================================================================
// migrate-release-notes.mjs — ONE-TIME migration tool, not shipped code.
// ============================================================================
// Converts the 159 hardcoded `.release-entry` HTML blocks in
// frontend/js/views/user_guide.js into structured data:
//   frontend-react/src/features/help-hub/data/releases.json
//
// The HTML shape turned out to have more variation than expected (some
// entries have a title line, some have multiple tags, some have none,
// formatting changed over the file's lifetime) — this uses a real DOM
// (jsdom) rather than regex to parse each entry robustly.
//
// Safety: every entry is round-trip verified (original plaintext vs.
// reconstructed-from-JSON plaintext, whitespace/case-insensitive) before
// the script writes anything. Any mismatch is reported and the script
// exits non-zero without writing releases.json.
//
// Usage: cd frontend-react && node scripts/migrate-release-notes.mjs
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SOURCE = join(ROOT, 'frontend/js/views/user_guide.js');
const OUT = join(ROOT, 'frontend-react/src/features/help-hub/data/releases.json');

const src = readFileSync(SOURCE, 'utf8');

// ── 1. Extract the What's New section's template-literal HTML chunk ─────────
const marker = "What\\'s New — Release Notes"; // raw source has an escaped apostrophe (JS string literal)
const markerIdx = src.indexOf(marker);
if (markerIdx === -1) throw new Error(`Marker "${marker}" not found in ${SOURCE}`);

const contentKeyIdx = src.indexOf('content: `', markerIdx);
if (contentKeyIdx === -1) throw new Error('Could not find `content: \\`` after the What\'s New marker');
const htmlStart = contentKeyIdx + 'content: `'.length;
const htmlEnd = src.indexOf('`', htmlStart);
if (htmlEnd === -1) throw new Error('Could not find closing backtick for the What\'s New content template literal');

const html = src.slice(htmlStart, htmlEnd);

// ── 2. Parse with a real DOM ──────────────────────────────────────────────
const dom = new JSDOM(`<div id="root">${html}</div>`);
const entries = [...dom.window.document.querySelectorAll('.release-entry')];

console.log(`Found ${entries.length} .release-entry blocks in the source file.`);

// ── 3. Tag-label -> Badge variant (semantic, not color-preserving — the
// original file used ~40 distinct one-off hex colors with no consistent
// meaning; Badge.jsx's existing variant tokens are a cleaner, smaller set) ──
const VARIANT_RULES = [
  [/\b(bug|fix|hotfix|critical|urgent|rca|p1)\b/i, 'danger'],
  [/\b(new|feature)\b/i, 'indigo'],
  [/\b(hardening|security|stability|reliability)\b/i, 'warning'],
  [/\b(backend)\b/i, 'info'],
  [/\b(frontend|ui|ux)\b/i, 'purple'],
  [/\b(perf|performance)\b/i, 'danger'],
];
function variantFor(label) {
  for (const [re, variant] of VARIANT_RULES) {
    if (re.test(label)) return variant;
  }
  return 'default';
}

// Both single-underscore and single-asterisk em conventions collide with
// content that already contains those characters literally (underscored
// identifiers like "ids_only" in prose, literal "*emphasis*" or "***" runs
// in a couple of entries) — a naive regex can't tell markdown syntax from
// a literal character that happens to match. <em> appears only 4 times
// across all 159 entries, so it's simplest and safest to just unwrap it
// to plain text rather than invent a delimiter scheme for it.
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function toMarkdown(innerHTML) {
  return decodeEntities(
    innerHTML
      .replace(/<strong[^>]*>(.*?)<\/strong>/gs, '**$1**')
      .replace(/<em[^>]*>(.*?)<\/em>/gs, '$1')
      .replace(/<code[^>]*>(.*?)<\/code>/gs, '`$1`')
  ).trim();
}

// Reverse of toMarkdown — used only for the round-trip verification below,
// to reconstruct comparable plaintext from the JSON we're about to write.
function markdownToPlaintext(md) {
  return md
    .replace(/\*\*(.*?)\*\*/gs, '$1')
    .replace(/`(.*?)`/gs, '$1');
}

// ── 5. Extract each entry ────────────────────────────────────────────────
const releases = [];
const failures = [];

for (const [i, entry] of entries.entries()) {
  const headerRow = entry.children[0]; // div: [version+tags container, date span]
  const versionTagsDiv = headerRow.children[0];
  const dateSpan = headerRow.children[1];

  const version = versionTagsDiv.querySelector('strong')?.textContent?.trim();
  const dateText = dateSpan?.textContent?.trim();
  const tagSpans = [...versionTagsDiv.querySelectorAll('span')];
  const tags = tagSpans.map(s => {
    const label = s.textContent.trim();
    return { label, variant: variantFor(label) };
  });

  // Optional title div: present when entry has 3 top-level children
  // (header row, title div, <ul>) instead of 2 (header row, <ul>).
  let title = null;
  let ul;
  if (entry.children.length === 3) {
    title = entry.children[1].textContent.trim();
    ul = entry.children[2];
  } else {
    ul = entry.children[1];
  }

  const items = [...ul.querySelectorAll(':scope > li')].map(li => toMarkdown(li.innerHTML));

  if (!version || !dateText || items.length === 0) {
    failures.push({ index: i, reason: 'missing version/date/items', outerHTML: entry.outerHTML.slice(0, 200) });
    continue;
  }

  releases.push({ version, date: dateText, tags, title, items });
}

// ── 6. Round-trip verification ───────────────────────────────────────────
// Re-derive plaintext from each parsed release object and compare against
// that same entry's original <li> textContent.
function normalize(s) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

let mismatches = 0;
let checked = 0;
for (const entry of entries) {
  const ul = entry.querySelector('ul');
  if (!ul) continue;
  const originalItems = [...ul.querySelectorAll(':scope > li')].map(li => normalize(li.textContent));
  const version = entry.querySelector('strong')?.textContent?.trim();
  const match = releases.find(r => r.version === version && r.items.length === originalItems.length);
  if (!match) {
    mismatches++;
    console.error(`✗ Could not find a parsed match for entry with version "${version}"`);
    continue;
  }
  const reconstructed = match.items.map(it => normalize(markdownToPlaintext(it)));
  for (let i = 0; i < originalItems.length; i++) {
    if (originalItems[i] !== reconstructed[i]) {
      mismatches++;
      console.error(`✗ Mismatch on "${version}" item ${i}:`);
      console.error(`    original:      ${originalItems[i]}`);
      console.error(`    reconstructed: ${reconstructed[i]}`);
    }
  }
  checked++;
}

console.log(`\nParsed:      ${releases.length}`);
console.log(`Failed:      ${failures.length}`);
console.log(`Checked:     ${checked} entries' items against their reconstruction`);
console.log(`Mismatches:  ${mismatches}`);

if (failures.length > 0) {
  console.error('\nFAILED entries (not written):');
  for (const f of failures) console.error(`  [${f.index}] ${f.reason}: ${f.outerHTML}`);
}

if (releases.length !== entries.length || mismatches > 0 || failures.length > 0) {
  console.error(`\n✗ Migration verification FAILED — expected ${entries.length} clean entries, got ${releases.length} parsed / ${mismatches} mismatches / ${failures.length} failures.`);
  console.error('Not writing releases.json. Fix the parser or the source data and re-run.');
  process.exit(1);
}

// ── 7. Write ──────────────────────────────────────────────────────────────
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(releases, null, 2) + '\n');
console.log(`\n✓ Wrote ${releases.length} entries to ${OUT}`);
