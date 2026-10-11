/**
 * ChangelogDigestCard.jsx
 *
 * A single on/off switch for the weekly "What Shipped This Week" email —
 * deliberately NOT the general Report Builder. Feedback: that flow asked a
 * page's worth of questions (scope, schedule, recipients, sender, CSV) for
 * content that doesn't need most of them — the release digest is a pure
 * date-range lookup against release notes, org-wide, same recipients every
 * time (every current CRM user, resolved fresh at send time — see
 * report_service.execute_report). So this is just the toggle; no fields.
 */
import React, { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { Card, CardContent } from '../../../components/ui/Card';
import { Switch } from '../../../components/ui/Switch';
import { AnalyticsService } from '../../../services/api';

export const ChangelogDigestCard = () => {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    AnalyticsService.getChangelogDigestStatus()
      .then((d) => setEnabled(!!d.enabled))
      .finally(() => setLoading(false));
  }, []);

  const toggle = async () => {
    if (loading || saving) return;
    const next = !enabled;
    setSaving(true);
    setError('');
    try {
      await AnalyticsService.setChangelogDigestEnabled(next);
      setEnabled(next);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to update.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex items-start gap-4 py-4">
        <span className="p-2 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
          <Megaphone size={18} />
        </span>
        <div className="flex-1">
          <Switch
            checked={enabled}
            onChange={toggle}
            label="Weekly Changelog Digest"
            hint={'Sends "What Shipped This Week" every Monday to everyone with a CRM login here — no setup needed, new teammates are included automatically. Off by default.'}
          />
          {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
};
