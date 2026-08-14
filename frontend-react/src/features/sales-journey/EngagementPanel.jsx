import React, { useEffect, useState, useCallback } from 'react';
import { Mail, MousePointerClick, MessageSquareReply } from 'lucide-react';
import { SalesJourneyService } from '../../services/api';
import { labelForNode } from './NodeConfigPanel';
import { toast } from './toast';

function Rate({ icon: Icon, label, value, rate }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-600">
      <Icon size={13} className="text-slate-400" />
      <span className="font-semibold text-slate-800">{value}</span>
      <span>{label}</span>
      <span className="text-slate-400">({Math.round(rate * 100)}%)</span>
    </div>
  );
}

// v10.9.9 — cadence emails had zero open/click/reply visibility. This panel
// is the overall + per-step engagement summary; it lives alongside
// FailedEnrollmentsPanel (health) rather than replacing it — different
// question (is it working well vs. is it stuck).
export function EngagementPanel({ journeyId, nodes }) {
  const [engagement, setEngagement] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const stats = await SalesJourneyService.getStats(journeyId);
      setEngagement(stats.engagement || null);
    } catch (err) {
      toast('Failed to load engagement stats.', 'error');
    } finally {
      setLoading(false);
    }
  }, [journeyId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return null;
  if (!engagement || engagement.overall.sent === 0) return null;

  const stepRows = Object.entries(engagement.by_step)
    .map(([nodeId, stats]) => {
      const node = nodes.find((n) => n.id === nodeId);
      return { nodeId, label: node ? labelForNode(node, nodes) : nodeId, stats };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="border-t border-slate-200 px-4 py-3 shrink-0">
      <div className="text-xs font-bold text-slate-500 mb-2">Engagement</div>
      <div className="flex items-center gap-4 mb-2">
        <Rate icon={Mail} label="opened" value={engagement.overall.opened} rate={engagement.overall.open_rate} />
        <Rate icon={MousePointerClick} label="clicked" value={engagement.overall.clicked} rate={engagement.overall.click_rate} />
        <Rate icon={MessageSquareReply} label="replied" value={engagement.overall.replied} rate={engagement.overall.reply_rate} />
        <span className="text-xs text-slate-400">{engagement.overall.sent} sent total</span>
      </div>
      {(stepRows.length > 1 || stepRows.some((r) => r.stats.by_variant)) && (
        <div className="overflow-x-auto">
          <table className="text-xs w-full">
            <thead>
              <tr className="text-slate-400 text-left">
                <th className="font-normal pr-3 py-1">Step</th>
                <th className="font-normal pr-3 py-1">Sent</th>
                <th className="font-normal pr-3 py-1">Open %</th>
                <th className="font-normal pr-3 py-1">Click %</th>
                <th className="font-normal py-1">Reply %</th>
              </tr>
            </thead>
            <tbody>
              {stepRows.map(({ nodeId, label, stats }) => (
                <React.Fragment key={nodeId}>
                  <tr className="border-t border-slate-100">
                    <td className="pr-3 py-1 text-slate-700">{label}</td>
                    <td className="pr-3 py-1">{stats.sent}</td>
                    <td className="pr-3 py-1">{Math.round(stats.open_rate * 100)}%</td>
                    <td className="pr-3 py-1">{Math.round(stats.click_rate * 100)}%</td>
                    <td className="py-1">{Math.round(stats.reply_rate * 100)}%</td>
                  </tr>
                  {stats.by_variant && Object.entries(stats.by_variant)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([variantKey, vstats]) => (
                      <tr key={variantKey} className="text-slate-400">
                        <td className="pr-3 py-0.5 pl-3">↳ Variant {variantKey}</td>
                        <td className="pr-3 py-0.5">{vstats.sent}</td>
                        <td className="pr-3 py-0.5">{Math.round(vstats.open_rate * 100)}%</td>
                        <td className="pr-3 py-0.5">{Math.round(vstats.click_rate * 100)}%</td>
                        <td className="py-0.5">{Math.round(vstats.reply_rate * 100)}%</td>
                      </tr>
                    ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
