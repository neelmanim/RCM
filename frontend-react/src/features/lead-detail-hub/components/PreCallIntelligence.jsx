import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, RefreshCw, Copy, Check } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { SkeletonText } from '../../../components/ui/Skeleton';
import { RESEARCH_STATUS, hasEnoughIdentityToResearch } from '../lib/deriveResearchStatus';

const FIELD_LABELS = [
  ['research_company', 'Company pulse'],
  ['research_hypothesis', 'Why they may need us'],
  ['research_opening', 'Opening line'],
  ['research_personalization', 'Key talking points'],
  ['research_hook', 'Likely objections'],
  ['research_contact', 'Persona signal'],
];

const HEAT_STYLE = {
  hot:  { emoji: '🔥', variant: 'danger' },
  warm: { emoji: '♨️', variant: 'warning' },
  cold: { emoji: '🧊', variant: 'info' },
};

function HeatBadge({ heat }) {
  const style = HEAT_STYLE[heat];
  if (!style) return null;
  return <Badge variant={style.variant}>{style.emoji} {heat.toUpperCase()}</Badge>;
}

function CopyOpeningLineButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-slate-400 hover:text-slate-600"
      title="Copy opening line"
    >
      {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
    </button>
  );
}

export function PreCallIntelligence({ lead, status, canModify, onResearch, onRegenerate }) {
  // Auto-trigger-once if the lead has enough identity but zero research yet —
  // ports the legacy anti-429-storm guard: one attempt per lead, debounced,
  // never silently re-fires on rerender/rapid prev-next.
  const triggeredForLeadRef = useRef(null);
  useEffect(() => {
    if (!lead) return;
    if (status !== RESEARCH_STATUS.NOT_AVAILABLE) return;
    if (!hasEnoughIdentityToResearch(lead)) return;
    if (triggeredForLeadRef.current === lead.id) return;
    triggeredForLeadRef.current = lead.id;
    const timer = setTimeout(() => onResearch?.(false), 400);
    return () => clearTimeout(timer);
  }, [lead, status, onResearch]);

  if (!lead) return null;

  return (
    <Card>
      <CardHeader
        title="Pre-Call Intelligence"
        actions={(
          <div className="flex items-center gap-2">
            <HeatBadge heat={lead.research_heat} />
            {canModify && status !== RESEARCH_STATUS.RESEARCHING && (
              <Button size="sm" variant="ghost" onClick={() => (onRegenerate ? onRegenerate() : onResearch?.(true))}>
                <RefreshCw size={14} /> Regenerate
              </Button>
            )}
          </div>
        )}
      />
      <CardContent>
        {status === RESEARCH_STATUS.RESEARCHING && (
          <div>
            <p className="text-sm text-slate-500 mb-3 flex items-center gap-2">
              <Sparkles size={14} className="text-purple-400" /> Researching…
            </p>
            <SkeletonText lines={4} />
          </div>
        )}

        {status === RESEARCH_STATUS.FAILED && (
          <div className="text-sm">
            <p className="text-red-600 font-semibold mb-2">Research failed.</p>
            {canModify && (
              <Button size="sm" variant="outline" onClick={() => onResearch?.(true)}>Try Again</Button>
            )}
          </div>
        )}

        {status === RESEARCH_STATUS.NOT_AVAILABLE && (
          <p className="text-sm text-slate-400 italic">
            {hasEnoughIdentityToResearch(lead)
              ? 'Preparing research…'
              : 'Add company or title details to enable research.'}
          </p>
        )}

        {status === RESEARCH_STATUS.LIMITED && (
          <div className="text-sm">
            <p className="text-slate-600 mb-2">Limited information available.</p>
            <p className="text-slate-400 mb-3">We don't have enough research to confidently personalize this call.</p>
            {canModify && (
              <Button size="sm" variant="outline" onClick={() => onResearch?.(true)}>Research Lead</Button>
            )}
          </div>
        )}

        {(status === RESEARCH_STATUS.READY || status === RESEARCH_STATUS.LIMITED) && (
          <dl className="grid grid-cols-1 gap-3 text-sm mt-3">
            {FIELD_LABELS.filter(([field]) => lead[field]).map(([field, label]) => (
              <div key={field}>
                <dt className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  {label}
                  {field === 'research_opening' && <CopyOpeningLineButton text={lead[field]} />}
                </dt>
                <dd className="text-slate-700 m-0">{lead[field]}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
