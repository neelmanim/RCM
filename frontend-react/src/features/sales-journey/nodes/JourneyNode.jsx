import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Zap, Mail, Clock, GitBranch, Phone, MessageSquareText, MessageCircle } from 'lucide-react';
import { NODE_LABELS } from '../nodeDefaults';

const ICONS = { trigger: Zap, email: Mail, wait: Clock, condition: GitBranch, call: Phone, sms: MessageSquareText, whatsapp: MessageCircle };
// A pale full-card background tint (bg-amber-50 vs bg-blue-50, etc.) reads as
// nearly the same card at a glance — a colored header band is a much more
// visible way to tell 5 node types apart on a canvas full of small cards.
// Also used for the MiniMap's nodeColor so the overview matches the canvas.
export const NODE_ACCENT = {
  trigger:   { border: 'border-amber-400',   header: 'bg-amber-100 text-amber-800',   hex: '#fbbf24' },
  email:     { border: 'border-blue-400',    header: 'bg-blue-100 text-blue-800',     hex: '#60a5fa' },
  wait:      { border: 'border-slate-400',   header: 'bg-slate-200 text-slate-700',   hex: '#94a3b8' },
  condition: { border: 'border-purple-400',  header: 'bg-purple-100 text-purple-800', hex: '#c084fc' },
  call:      { border: 'border-emerald-400', header: 'bg-emerald-100 text-emerald-800', hex: '#34d399' },
  sms:       { border: 'border-teal-400',    header: 'bg-teal-100 text-teal-800',      hex: '#2dd4bf' },
  whatsapp:  { border: 'border-green-400',   header: 'bg-green-100 text-green-800',    hex: '#4ade80' },
};
// Shape follows standard flowchart notation, not an arbitrary look: trigger
// is the terminator (pill/oval — whole card), condition is the decision
// (diamond icon badge — the card itself stays rectangular so its summary
// text doesn't get clipped by a diamond outline), and the action steps stay
// rectangular but each gets a distinct border style so three cards with
// different colors don't still read as "the same box" at a glance.
const NODE_SHAPE = {
  trigger: 'rounded-full',
  email: 'rounded-lg border-solid',
  wait: 'rounded-lg border-dashed',
  condition: 'rounded-lg border-solid',
  call: 'rounded-lg border-double border-[6px]',
  whatsapp: 'rounded-lg border-dotted border-[3px]',
  // sms omitted — same 'rounded-lg border-solid' as the `|| NODE_SHAPE.email` fallback below.
};

function summaryFor(type, data) {
  switch (type) {
    case 'trigger':
      if (data.event === 'status_changed') return `Status → ${data.to_status || '…'}`;
      if (data.event === 'email_received') return 'Email received';
      return data.event || 'No event set';
    case 'email':
      if (data.variants?.length) return `A/B test — ${data.variants.length} variants`;
      return data.subject?.trim() || 'No subject yet';
    case 'wait':
      return `Wait ${data.duration_hours ?? 0}h`;
    case 'condition':
      return `${data.timeout_hours ?? 0}h timeout`;
    case 'call':
      return data.title?.trim() || 'Call reminder';
    case 'sms':
      return data.message?.trim() || 'No message yet';
    case 'whatsapp':
      return data.template_name || 'No template selected';
    default:
      return '';
  }
}

// One component for all node types (registered multiple times in the
// nodeTypes map) — they're structurally identical (icon + title + one-line
// summary + validation indicator), a separate file per type would just be
// the same card several times with a different icon/color.
export function JourneyNode({ type, data, selected }) {
  const Icon = ICONS[type] || Zap;
  const errors = data.__errors || [];
  const accent = NODE_ACCENT[type] || NODE_ACCENT.wait;
  const shape = NODE_SHAPE[type] || NODE_SHAPE.email;
  return (
    <div
      className={`min-w-[180px] border-2 shadow-sm bg-white overflow-hidden
        ${shape} ${accent.border}
        ${selected ? 'ring-2 ring-blue-500' : ''}
        ${errors.length > 0 ? '!border-red-400' : ''}`}
    >
      {type !== 'trigger' && <Handle type="target" position={Position.Top} />}
      <div className={`flex items-center gap-2 px-3 py-1.5 ${accent.header} ${type === 'trigger' ? 'justify-center' : ''}`}>
        {type === 'condition' ? (
          // Decision-node icon badge rotated into a diamond — the classic
          // flowchart symbol for a branch — without clipping the card body
          // (and its text) into a diamond outline too.
          <span className="shrink-0 grid place-items-center w-5 h-5 rotate-45 bg-white/40 rounded-[3px]">
            <Icon size={11} className="-rotate-45" />
          </span>
        ) : (
          <Icon size={14} className="shrink-0" />
        )}
        <span className="text-xs font-bold">{NODE_LABELS[type] || type}</span>
      </div>
      <div className={type === 'trigger' ? 'px-5 py-2 text-center' : 'px-3 py-2'}>
        <div className="text-xs text-slate-500 truncate max-w-[160px] mx-auto">{summaryFor(type, data)}</div>
        {errors.length > 0 && (
          <div className="text-[10px] text-red-600 mt-1">{errors.length} issue{errors.length > 1 ? 's' : ''}</div>
        )}
      </div>
      {type !== 'condition' && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}
