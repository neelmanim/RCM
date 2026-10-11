import React, { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { Badge } from '../../../components/ui/Badge';
import { Skeleton, SkeletonCard } from '../../../components/ui/Skeleton';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { SettingsService, SalesJourneyService } from '../../../services/api';
import { SendWindowSettings } from '../../sales-journey/SendWindowSettings';

// Phase 3 (Control Center): AI Research config + Sales Cadence send-window
// settings. Ported from frontend/js/views/settings.js's `ai` tab (~346-532,
// markup only) + frontend/js/views/settings_ai_dialer.js (the actual bind
// logic — despite its name this file, not settings.js, wires up the AI
// panel: llm-provider-select etc. at lines 46-112, the prompt editor at
// 114-222). SendWindowSettings.jsx is embedded unmodified (Sales Cadence
// send windows aren't global — a cadence is picked below, then that
// journey's own settings render as-is).
//
// 2026-09-03: Research Gate and Bulk Research Pre-Population cards removed
// from THIS page per user request — legacy settings.js/settings_ai_dialer.js
// keep both working exactly as before (require_research_before_calling still
// enforced, bulk job endpoint untouched); only the Control Center controls
// are gone. Call Outcomes Configuration moved to the new CRM Settings tab
// inside Integrations, alongside the Salesforce sync-direction toggle it
// naturally belongs with — see IntegrationsSection.jsx's CrmSettingsCard.

export function AutomationSection() {
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const loadSettings = () =>
    SettingsService.getSyncSettings()
      .then((data) => setSettings(data))
      .catch(() => { setLoadError('Settings could not be loaded — showing defaults.'); setSettings({}); });

  useEffect(() => {
    loadSettings();
  }, []);

  return (
    <div className="space-y-6 max-w-3xl">
      {loadError && (
        <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {loadError}
        </div>
      )}
      {settings === null ? <SkeletonCard /> : <AiResearchCard settings={settings} onSaved={loadSettings} />}
      {settings === null ? <SkeletonCard /> : <PromptEditorCard settings={settings} onSaved={loadSettings} />}
      <SendWindowsCard />
    </div>
  );
}

// ── Card 1: LLM Provider Config — settings_ai_dialer.js:46-112 ─────────────
const PROVIDER_OPTIONS = [
  { value: 'groq', label: 'Groq (Free — Llama 3.3 70B)' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'openai', label: 'OpenAI' },
];

function AiResearchCard({ settings, onSaved }) {
  const [provider, setProvider] = useState(settings.llm_provider || 'groq');
  const [model, setModel] = useState(settings.llm_model || '');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const hasKey = !!settings.llm_api_key;

  const handleSave = async () => {
    setSaving(true);
    setStatus('');
    try {
      const payload = { llm_provider: provider, llm_model: model || 'llama-3.3-70b-versatile' };
      if (apiKey.trim()) payload.llm_api_key = apiKey.trim();
      await SettingsService.patchSyncSettings(payload);
      setApiKey('');
      setStatus('Saved!');
      onSaved?.();
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setStatus(err.response?.data?.detail || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="AI Research Configuration"
        subtitle="Auto-runs on every lead in Research or Calling status"
      />
      <CardContent>
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">Provider</label>
          <Select
            className="w-full justify-between"
            ariaLabel="LLM Provider"
            value={provider}
            onChange={setProvider}
            options={PROVIDER_OPTIONS}
          />
          <p className="text-xs text-slate-400 mt-1">
            Groq offers a generous free tier. Get your key at{' '}
            <a href="https://console.groq.com" target="_blank" rel="noreferrer" className="text-purple-600">
              console.groq.com
            </a>
          </p>
        </div>
        <Input
          label="API Key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasKey ? 'Configured — leave blank to keep' : 'gsk_xxxxxxxxxxxxxxxx'}
          hint={hasKey ? 'A key is already configured.' : undefined}
        />
        <Input
          label="Model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="llama-3.3-70b-versatile"
          hint="Default: llama-3.3-70b-versatile (recommended for Groq)"
        />
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save AI Settings'}</Button>
          <span className="text-xs text-slate-500">{status}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Card 2: Research Prompt Editor — settings_ai_dialer.js:114-222 ─────────
const DEFAULT_PROMPT = `You are an expert SDR (Sales Development Representative) researcher. Given the following lead information, research this company and contact to help prepare for a sales call.

Lead Information:
{lead_context}

Based on the available information, generate a research brief. Return ONLY a valid JSON object with these exact keys:

{
  "research_company": "One clear sentence about what this company does and their value proposition",
  "research_industry": "Pick exactly ONE from: SaaS, Healthcare, Finance, Retail, Manufacturing, Real Estate, Education, Other",
  "research_company_size": "Pick exactly ONE from: 1–50, 51–200, 201–1000, 1000+",
  "research_services": "Key products or services they offer (keep under 100 chars)",
  "research_geo": "Geographic regions they operate in or serve",
  "research_timezone": "Pick exactly ONE from: IST, EST, PST, GMT, CST, AEST, Other",
  "research_hook": "A compelling, personalized opening line for a cold call to this contact (reference something specific about their company or role)",
  "research_hypothesis": "2-3 sentences: Why this contact would benefit from a CRM/lead enrichment solution. What pain points might they have?",
  "research_personalization": "One specific observation about this person or company that shows you've done your homework",
  "research_contact": "Role context: Is this person a decision maker? What's their likely influence in buying decisions?",
  "research_channels": "Pick likely engagement channels, comma-separated from: Website Chat, WhatsApp, Social Media, Phone/Calling, In-Person, Email, Chatbot"
}

IMPORTANT: Return ONLY the JSON object, no markdown, no explanation, no code fences.`;

function PromptEditorCard({ settings, onSaved }) {
  const [value, setValue] = useState(settings.research_prompt || '');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [status, setStatus] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const isCustom = !!value.trim();

  const save = async () => {
    setSaving(true);
    setStatus('');
    try {
      await SettingsService.patchSyncSettings({ research_prompt: value.trim() });
      setStatus('Prompt saved!');
      onSaved?.();
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setStatus(err.response?.data?.detail || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setResetting(true);
    setStatus('');
    try {
      await SettingsService.patchSyncSettings({ research_prompt: '' });
      setValue('');
      setStatus('Reset to default!');
      onSaved?.();
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setStatus(err.response?.data?.detail || 'Reset failed');
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Research Prompt Editor"
        subtitle="Customise the system prompt sent to the AI for every research run"
        actions={<Badge variant={isCustom ? 'purple' : 'default'}>{isCustom ? 'Custom' : 'Default'}</Badge>}
      />
      <CardContent>
        <div className="mb-3 p-3 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-900 flex flex-wrap items-center gap-2">
          <span className="font-semibold">Available placeholder:</span>
          <code className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{'{lead_context}'}</code>
          <span className="text-slate-500">
            ← Injects contact + company data. Required for the AI to know who it&apos;s researching.
          </span>
        </div>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Leave empty to use the default prompt. Use {lead_context} to include lead data."
          rows={10}
          spellCheck={false}
          className="w-full p-3 rounded-lg border border-slate-200 text-xs font-mono leading-relaxed resize-y outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        />
        <div className="text-xs text-slate-400 text-right mt-1">{value.length} chars</div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Prompt'}</Button>
          <Button size="sm" variant="outline" onClick={() => setConfirmReset(true)} disabled={resetting}>
            {resetting ? 'Resetting…' : 'Reset to Default'}
          </Button>
          <span className="text-xs text-slate-500 ml-auto">{status}</span>
        </div>

        <ConfirmDialog
          open={confirmReset}
          onClose={() => setConfirmReset(false)}
          title="Reset to the built-in default prompt?"
          message="Your custom prompt will be deleted."
          confirmLabel="Reset"
          confirmVariant="danger"
          onConfirm={reset}
          loading={resetting}
        />
        <details className="mt-4">
          <summary className="text-xs font-semibold text-purple-700 cursor-pointer select-none">
            View default prompt template
          </summary>
          <pre className="mt-2 p-3 bg-purple-50 border border-purple-100 rounded-lg text-xs text-purple-900 leading-relaxed whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
            {DEFAULT_PROMPT}
          </pre>
        </details>
        <div className="mt-4 p-3 rounded-lg bg-purple-50 border border-purple-100 text-xs text-purple-800 leading-relaxed">
          <div className="font-semibold mb-1">How it works</div>
          <ul className="list-disc pl-4 space-y-1">
            <li>AI research runs automatically when an SDR opens a lead in Research or Calling status</li>
            <li>Gap-fill logic only populates empty fields — existing data is never overwritten</li>
            <li>Research is cached per company — all contacts from the same company share the result</li>
            <li>Custom prompt overrides the default — leave empty to restore the built-in template</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Send Windows — embeds sales-journey/SendWindowSettings.jsx as-is ──────
// Not a global setting: a send window belongs to one sales cadence
// (SendWindowSettings takes journeyId/journey/onSaved, same as its existing
// JourneyBuilder.jsx usage). This card just adds a cadence picker so it's
// reachable from Control Center without rebuilding the component.
function SendWindowsCard() {
  const [journeys, setJourneys] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [journey, setJourney] = useState(null);
  const [journeyLoading, setJourneyLoading] = useState(false);

  useEffect(() => {
    SalesJourneyService.list()
      .then(setJourneys)
      .catch(() => { setError('Failed to load cadences.'); setJourneys([]); });
  }, []);

  const handleSelect = async (id) => {
    setSelectedId(id);
    setJourney(null);
    if (!id) return;
    setJourneyLoading(true);
    try {
      setJourney(await SalesJourneyService.get(id));
    } catch {
      setError('Failed to load this cadence.');
    } finally {
      setJourneyLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Send Windows" subtitle="Restrict when a sales cadence's automated email/SMS steps are allowed to send" />
      <CardContent>
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        {journeys === null ? (
          <Skeleton className="h-9 w-full" />
        ) : journeys.length === 0 ? (
          <EmptyState icon={Bot} title="No cadences yet" message="Create a sales cadence first, then configure its send window here." />
        ) : (
          <>
            <div className="mb-3">
              <label className="block text-sm font-medium text-slate-700 mb-1">Cadence</label>
              <Select
                className="w-full justify-between"
                ariaLabel="Cadence"
                value={selectedId}
                onChange={handleSelect}
                options={journeys.map((j) => ({ value: j.id, label: j.name }))}
                placeholder="Choose a cadence…"
                searchable={journeys.length > 20}
              />
            </div>
            {journeyLoading && <Skeleton className="h-9 w-40" />}
            {journey && !journeyLoading && (
              <SendWindowSettings journeyId={selectedId} journey={journey} onSaved={setJourney} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
