import React from 'react';
import { PhoneCall } from 'lucide-react';
import { Button } from '../../../components/ui/Button';

export function NextBestAction({ action, onExecute, canModify = true }) {
  if (!action) return null;

  return (
    <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <p className="text-[10px] font-bold text-purple-500 uppercase tracking-wider mb-1">Next Action</p>
        <p className="text-lg font-extrabold text-slate-900 m-0">{action.label}</p>
        {action.reason && <p className="text-sm text-slate-500 mt-0.5">{action.reason}</p>}
      </div>
      {/* Mirrors legacy's _canModify gate — these buttons mutate lead state,
          so a read-only viewer (e.g. Pod Admin on another pod's lead) must
          not see them, same as every per-status banner in lead_detail.js. */}
      {canModify && (action.ctaLabel || action.secondary) && (
        <div className="flex items-center gap-2">
          {action.secondary && (
            <Button variant="outline" onClick={() => onExecute?.(action.secondary.ctaKind)}>
              {action.secondary.label}
            </Button>
          )}
          {action.ctaLabel && (
            <Button variant="primary" onClick={() => onExecute?.(action.ctaKind)}>
              {action.ctaKind === 'call' && <PhoneCall size={16} />}
              {action.ctaLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
