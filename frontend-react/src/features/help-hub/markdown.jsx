import React from 'react';
import { stripLeadingEmoji } from './text';

// Tiny **bold**/`code` renderer for release-note items (see
// scripts/migrate-release-notes.mjs for why this convention was picked —
// no markdown library, no dangerouslySetInnerHTML, just the two inline
// styles the original content actually used).
const TOKEN_RE = /(\*\*.+?\*\*|`.+?`)/g;

export function renderInlineMarkdown(text) {
  return text.split(TOKEN_RE).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      // Item bullets carry the same leading-emoji-as-icon holdover as
      // section titles/tags (see text.js) — it just sits inside the
      // **bold** span instead of at the very start of the string.
      return <strong key={i}>{stripLeadingEmoji(part.slice(2, -2))}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

// Plain-text version, for search — strips the markdown tokens entirely.
export function stripMarkdown(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1');
}
