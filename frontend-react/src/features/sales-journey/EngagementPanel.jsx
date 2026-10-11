import React, { useEffect, useState, useCallback } from 'react';
import { Mail, MessageSquare, UserX, BarChart3 } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { SalesJourneyService } from '../../services/api';
import { labelForNode } from './NodeConfigPanel';
import { toast } from './toast';
import { ReportingSection } from './ReportingSection';

// Why enrollments ended — the v13 stop rules made visible.
const EXIT_LABELS = {
  replied: 'replied', meeting_booked: 'booked a meeting', max_duration: 'reached the time limit',
  suppressed: 'opted out',
};
const EXIT_VARIANT = { replied: 'success', meeting_booked: 'success', max_duration: 'default', suppressed: 'warning' };

const pct = (rate) => `${Math.round((rate || 0) * 100)}%`;

function KpiCard({ icon: Icon, tone, title, stats }) {
  const TONE = {
    indigo: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
    teal: 'bg-teal-50 text-teal-600 ring-teal-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  }[tone];
  return (
    <div className={`flex-1 min-w-[220px] rounded-xl ring-1 p-3 ${TONE}`}>
      <div className="flex items-center gap-1.5 text-xs font-bold mb-2">
        <Icon size={14} /> {title}
      </div>
      <div className="flex items-center gap-4">
        {stats.map(({ label, value, rate }) => (
          <div key={label}>
            <div className="text-lg font-extrabold leading-none">{rate != null ? pct(rate) : value}</div>
            <div className="text-[11px] opacity-80 mt-0.5">{rate != null ? `${label} (${value})` : label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function stepKind(node, activity) {
  if (node) return node.type; // 'email' | 'sms' | 'whatsapp' | 'task'
  return activity?.channel === 'task' ? 'task' : activity?.channel || 'email';
}

// v10.9.9 — cadence emails had zero open/click/reply visibility. This panel
// is the overall + per-step engagement summary; it lives alongside
// FailedEnrollmentsPanel (health) rather than replacing it — different
// question (is it working well vs. is it stuck).
//
// v13.1.5 redesign: email/SMS/manual steps used to render as two
// disconnected raw tables with inconsistent columns, and a manual email/SMS
// step's actual send (open/click/reply, or delivered/reply) was invisible
// — it only ever showed the parked/completed/missed counters, even though
// the approved send writes a normal LeadEmailActivity/SmsLog row exactly
// like an automated send does. Every step now renders as ONE row, merging
// whichever of engagement/sms_engagement/step_activity have data for that
// node id, so a manual step shows both "2 parked, 1 done, 1 missed" AND its
// real open/delivered/reply rate instead of just one half of the picture.
export function EngagementPanel({ journeyId, nodes }) {
  const [engagement, setEngagement] = useState(null);
  const [smsEngagement, setSmsEngagement] = useState(null);
  const [stepActivity, setStepActivity] = useState({});
  const [exitReasons, setExitReasons] = useState({});
  const [total, setTotal] = useState(0);
  const [optedOut, setOptedOut] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const stats = await SalesJourneyService.getStats(journeyId);
      setEngagement(stats.engagement || null);
      setSmsEngagement(stats.sms_engagement || null);
      setStepActivity(stats.step_activity || {});
      setExitReasons(stats.exit_reasons || {});
      setTotal(stats.total || 0);
      setOptedOut(stats.opted_out || null);
    } catch {
      toast('Failed to load engagement stats.', 'error');
    } finally {
      setLoading(false);
    }
  }, [journeyId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return null;
  const hasEmail = engagement && engagement.overall.sent > 0;
  const hasSms = smsEngagement && smsEngagement.overall.sent > 0;
  const exits = Object.entries(exitReasons).filter(([r]) => EXIT_LABELS[r]);
  const hasOptOutData = total > 0 && optedOut != null;

  // One row per node id — union of every source that mentions it, so a
  // manual step's email/SMS send data and its parked/done/missed counters
  // land on the same line instead of two disconnected tables.
  const nodeIds = new Set([
    ...Object.keys(engagement?.by_step || {}),
    ...Object.keys(smsEngagement?.by_step || {}),
    ...Object.keys(stepActivity),
  ]);
  if (!hasEmail && !hasSms && nodeIds.size === 0 && exits.length === 0) return null;

  const stepRows = [...nodeIds].map((nodeId) => {
    const node = nodes.find((n) => n.id === nodeId);
    const emailStats = engagement?.by_step?.[nodeId];
    const smsStats = smsEngagement?.by_step?.[nodeId];
    const activity = stepActivity[nodeId];
    const kind = stepKind(node, activity);
    const sent = activity?.sent ?? emailStats?.sent ?? smsStats?.sent ?? 0;
    const isTaskLike = kind === 'task' || activity?.is_manual;
    return {
      nodeId, node, kind,
      label: node ? labelForNode(node, nodes) : nodeId,
      sent,
      openRate: emailStats?.open_rate,
      clickRate: emailStats?.click_rate,
      deliveredRate: smsStats?.delivery_rate,
      replyRate: emailStats?.reply_rate ?? smsStats?.reply_rate,
      done: isTaskLike ? activity?.completed ?? 0 : null,
      missed: isTaskLike ? activity?.missed ?? 0 : null,
      skipped: activity?.skipped ?? 0,
      variants: emailStats?.by_variant,
      outcomes: activity?.outcomes,
      outcomeLabels: node?.data?.outcomes,
    };
  }).sort((a, b) => a.label.localeCompare(b.label));

  const showTable = stepRows.length > 0;

  return (
    <ReportingSection icon={BarChart3} title="Engagement">
      {(hasEmail || hasSms || hasOptOutData) && (
        <div className="flex flex-wrap gap-3 mb-4">
          {hasEmail && (
            <KpiCard icon={Mail} tone="indigo" title={`Email · ${engagement.overall.sent} sent`} stats={[
              { label: 'opened', value: engagement.overall.opened, rate: engagement.overall.open_rate },
              { label: 'clicked', value: engagement.overall.clicked, rate: engagement.overall.click_rate },
              { label: 'replied', value: engagement.overall.replied, rate: engagement.overall.reply_rate },
            ]} />
          )}
          {hasSms && (
            <KpiCard icon={MessageSquare} tone="teal" title={`SMS / WhatsApp · ${smsEngagement.overall.sent} sent`} stats={[
              { label: 'delivered', value: smsEngagement.overall.delivered, rate: smsEngagement.overall.delivery_rate },
              { label: 'replied', value: smsEngagement.overall.replied, rate: smsEngagement.overall.reply_rate },
            ]} />
          )}
          {hasOptOutData && (
            <KpiCard icon={UserX} tone="amber" title={`Opted out · of ${total} enrolled`} stats={[
              { label: 'opted out', value: optedOut.count, rate: optedOut.rate },
            ]} />
          )}
        </div>
      )}

      {showTable && (
        <div className="overflow-x-auto rounded-lg border border-slate-100">
          <table className="text-xs w-full">
            <thead>
              <tr className="text-slate-400 text-left bg-slate-50">
                <th className="font-semibold pl-3 pr-3 py-2">Step</th>
                <th className="font-semibold pr-3 py-2">Sent</th>
                <th className="font-semibold pr-3 py-2">Open %</th>
                <th className="font-semibold pr-3 py-2">Click %</th>
                <th className="font-semibold pr-3 py-2">Delivered %</th>
                <th className="font-semibold pr-3 py-2">Reply %</th>
                <th className="font-semibold pr-3 py-2">Done</th>
                <th className="font-semibold pr-3 py-2">Missed</th>
                <th className="font-semibold pr-3 py-2">Skipped</th>
              </tr>
            </thead>
            <tbody>
              {stepRows.map((row) => (
                <React.Fragment key={row.nodeId}>
                  <tr className="border-t border-slate-100">
                    <td className="pl-3 pr-3 py-1.5 text-slate-700 font-medium">{row.label}</td>
                    {/* A call step only creates a reminder Task for the rep: "sent" is not calls placed. */}
                    {row.kind === 'call'
                      ? <td className="pr-3 py-1.5" title="Reminder tasks created for the rep — not calls placed">{row.sent} <span className="text-slate-400">tasks created</span></td>
                      : <td className="pr-3 py-1.5">{row.sent}</td>}
                    <td className="pr-3 py-1.5">{row.openRate != null ? pct(row.openRate) : '—'}</td>
                    <td className="pr-3 py-1.5">{row.clickRate != null ? pct(row.clickRate) : '—'}</td>
                    <td className="pr-3 py-1.5">{row.deliveredRate != null ? pct(row.deliveredRate) : '—'}</td>
                    <td className="pr-3 py-1.5">{row.replyRate != null ? pct(row.replyRate) : '—'}</td>
                    <td className="pr-3 py-1.5">{row.done ?? '—'}</td>
                    <td className="pr-3 py-1.5">{row.missed ?? '—'}</td>
                    <td className="pr-3 py-1.5">{row.skipped || '—'}</td>
                  </tr>
                  {row.variants && Object.entries(row.variants)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([variantKey, v]) => (
                      <tr key={variantKey} className="text-slate-400 border-t border-slate-50">
                        <td className="pl-6 pr-3 py-1">↳ Variant {variantKey}</td>
                        <td className="pr-3 py-1">{v.sent}</td>
                        <td className="pr-3 py-1">{pct(v.open_rate)}</td>
                        <td className="pr-3 py-1">{pct(v.click_rate)}</td>
                        <td className="pr-3 py-1">—</td>
                        <td className="pr-3 py-1">{pct(v.reply_rate)}</td>
                        <td className="pr-3 py-1" colSpan={3} />
                      </tr>
                    ))}
                  {row.outcomes && Object.entries(row.outcomes).map(([key, count]) => (
                    <tr key={key} className="text-slate-400 border-t border-slate-50">
                      <td className="pl-6 py-1" colSpan={9}>
                        ↳ {(row.outcomeLabels || []).find((o) => o.key === key)?.label || key}: {count}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {exits.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500 mr-1">Ended early:</span>
          {exits.map(([r, n]) => (
            <Badge key={r} variant={EXIT_VARIANT[r] || 'default'}>{n} {EXIT_LABELS[r]}</Badge>
          ))}
        </div>
      )}
    </ReportingSection>
  );
}
