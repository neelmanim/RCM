import { useState, useEffect } from 'react';
import { EmailCampaignService, EmailTemplateService } from '../../services/api';

/** Loads saved templates once, the first time the compose form opens.
 *  Shared by the Leads Hub bulk-action compose button and the Sales Tools
 *  "New Campaign" flow — same list, two entry points. */
export function useCampaignTemplates(open) {
  const [templates, setTemplates] = useState(null); // null = not yet loaded
  useEffect(() => {
    if (open && templates === null) {
      EmailTemplateService.list().then((r) => setTemplates(r.templates)).catch(() => setTemplates([]));
    }
  }, [open, templates]);
  return templates;
}

/** RichTextEditor's onChange delivers HTML — an empty doc is "<p></p>", not
 *  "", so a plain .trim() check on it is always truthy. Strips tags first so
 *  "is there any real content" means the same thing it did for plain text. */
export const hasContent = (html) => (html || '').replace(/<[^>]*>/g, '').trim().length > 0;

/** ScheduleControls' local `schedule` state -> the API's `schedule` shape.
 *  Only real conversion needed: <input type="datetime-local">'s value has
 *  no timezone info at all — `new Date(...)` parses it as the browser's own
 *  local time, and `.toISOString()` turns that into the absolute UTC
 *  instant the backend actually stores. */
function toScheduleApiPayload(schedule) {
  if (!schedule) return null;
  if (schedule.frequency === 'scheduled_once') {
    if (!schedule.scheduled_send_at) throw new Error('Pick a date and time to schedule this campaign for.');
    return { frequency: 'scheduled_once', scheduled_send_at: new Date(schedule.scheduled_send_at).toISOString() };
  }
  if (schedule.send_hour == null) throw new Error('Pick a send time for this recurring campaign.');
  return { ...schedule };
}

/** Validates, optionally saves a template, then creates the campaign.
 *  Throws with a user-facing message on failure — same two checks
 *  ("Send Email Campaign" used to run separately) now share one place. */
export async function submitCampaign({ leadIds, campaignName, subject, body, saveAsTemplate, templateName, schedule, includeSignature }) {
  if (leadIds.length > 200) {
    throw new Error('Email Campaigns support up to 200 leads at a time — narrow your selection.');
  }
  if (!subject.trim() && !hasContent(body)) {
    throw new Error('Subject or body is required.');
  }
  if (!campaignName.trim()) {
    throw new Error('Campaign name is required.');
  }
  const schedulePayload = toScheduleApiPayload(schedule);
  if (saveAsTemplate && templateName.trim()) {
    await EmailTemplateService.create(templateName.trim(), subject.trim(), body);
  }
  let result;
  try {
    result = await EmailCampaignService.create({ name: campaignName.trim(), subject, body, leadIds, schedule: schedulePayload, includeSignature });
  } catch (err) {
    // Surface the backend's actual validation message (e.g. "must be in the
    // future") instead of axios's generic "Request failed with status 422".
    throw new Error(err.response?.data?.detail || 'Failed to start campaign — please try again.');
  }
  if (schedulePayload) {
    return `Campaign ${schedulePayload.frequency === 'scheduled_once' ? 'scheduled' : 'set up to repeat'}: ${result.queued}/${result.requested} lead(s) queued` +
      (result.skipped.length ? ` — ${result.skipped.length} skipped` : '');
  }
  return `Campaign started: ${result.queued}/${result.requested} lead(s) queued` +
    (result.skipped.length ? ` — ${result.skipped.length} skipped` : '');
}

/** The compose-form state/handlers shared by the two "start a campaign"
 *  entry points — Leads Hub's bulk-action compose button and Sales Tools'
 *  own "New Campaign" flow. Each caller still owns whatever wraps this
 *  (a picker step, an open/closed boolean) and passes it in as `leadIds`/
 *  `open`; `onSuccess` is where a caller's own extra cleanup goes (closing
 *  its modal, refreshing a list) — this hook only resets the fields it owns. */
export function useCampaignComposeForm({ leadIds, open, notify, onSuccess }) {
  const [templateId, setTemplateId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [schedule, setSchedule] = useState(null); // null = send now
  const [includeSignature, setIncludeSignature] = useState(true);
  const [busy, setBusy] = useState(false);
  const templates = useCampaignTemplates(open);

  const reset = () => {
    setTemplateId(''); setCampaignName(''); setSubject(''); setBody('');
    setSaveAsTemplate(false); setTemplateName(''); setSchedule(null); setIncludeSignature(true);
  };

  const handlePickTemplate = (id) => {
    setTemplateId(id);
    const t = templates?.find((t) => t.id === id);
    if (t) {
      setSubject(t.subject);
      setBody(t.body);
      // Prefill from the template's own name, not its subject (which is
      // often merge-field text, e.g. "Hello {{first_name}}...") — every
      // campaign started from the same template used to inherit that
      // identical, unreadable subject as its "name". Only prefills an
      // empty field, so re-picking a template doesn't clobber a name the
      // user already typed.
      if (!campaignName.trim()) setCampaignName(t.name);
    }
  };

  const handleSend = async () => {
    setBusy(true);
    try {
      const msg = await submitCampaign({ leadIds, campaignName, subject, body, saveAsTemplate, templateName, schedule, includeSignature });
      notify(msg);
      reset();
      onSuccess?.();
    } catch (err) {
      notify(err.message || 'Failed to start campaign — please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // The CTA must never say "Send" when nothing sends right now — a
  // scheduled or repeating campaign only saves a plan the scheduler acts
  // on later.
  const confirmLabel = !schedule ? 'Send'
    : schedule.frequency === 'scheduled_once' ? 'Schedule Campaign'
    : 'Save & Repeat';

  return {
    templateId, campaignName, setCampaignName, subject, setSubject, body, setBody,
    saveAsTemplate, setSaveAsTemplate, templateName, setTemplateName,
    schedule, setSchedule, includeSignature, setIncludeSignature,
    templates, handlePickTemplate, handleSend,
    confirmLabel, busy, reset,
  };
}
