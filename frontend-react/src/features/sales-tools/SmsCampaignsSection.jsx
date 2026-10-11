import { useEffect, useState } from 'react';
import { Send, MessagesSquare, RefreshCw, ExternalLink } from 'lucide-react';
import { Tabs } from '../../components/ui/Tabs';
import { ConversationsService } from '../../services/api';

/**
 * SMS Campaigns — opens Alternate Messenger's own hosted app in a new tab, rather
 * than embedding it: Alternate Messenger exposes no campaign-management REST API,
 * only its own web app, and (confirmed 2026-09-10, live against staging)
 * its full app doesn't recognize the session cookie our backend-issued
 * auth URL sets when loaded as a THIRD-PARTY navigation — same result
 * whether that's an iframe or a genuine top-level redirect through the
 * same URL. It always falls back to Alternate Messenger's own sign-in screen. This
 * looks like a real product limitation (their generic/`audience_manager`
 * CRM auth may only be wired up for a Zoho-specific widget flow, not the
 * full app UI) rather than something fixable from our side — following up
 * with Alternate Messenger support separately.
 *
 * A new tab IS a first-party, top-level navigation for app.alternatecrm.com,
 * so if/when Alternate Messenger's side starts honoring that session there, this
 * starts working with zero changes here — the backend endpoint
 * (GET /api/conversations/embed-url) is unchanged, still per-user
 * authenticated, just opened via window.open instead of an iframe src.
 *
 * Replaces the old floating "Conversations" widget's 1:1-message tab
 * (frontend-react/src/features/messenger-widget/), deliberately disabled
 * org-wide (Control Center → Integrations → Alternate Messenger Conversations) in
 * favor of this — 1:1 messaging stays on the dialer, and Alternate Messenger itself
 * is now the system of record for SMS campaigns + tracking replies.
 */
const SMS_TABS = [
  { key: 'campaigns', label: 'Campaigns', icon: Send, cta: 'Open Campaigns in Alternate Messenger' },
  { key: 'converse-desk', label: 'Converse Desk', icon: MessagesSquare, cta: 'Open Converse Desk in Alternate Messenger' },
];

function useEmbedUrl(key) {
  const [state, setState] = useState({ status: 'loading', url: null, error: null });

  const load = () => {
    setState({ status: 'loading', url: null, error: null });
    ConversationsService.getEmbedUrl(key)
      .then((r) => setState({ status: 'ready', url: r.url, error: null }))
      .catch((e) => setState({ status: 'error', url: null, error: e.response?.data?.detail || e.message }));
  };

  useEffect(load, [key]);

  return { ...state, retry: load };
}

function OpenInAlternateMessenger({ tabKey, cta, Icon }) {
  const { status, url, error, retry } = useEmbedUrl(tabKey);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 min-h-[50vh] rounded-lg border border-slate-200 bg-slate-50">
      {status === 'loading' && <p className="text-sm text-slate-400">Preparing your Alternate Messenger session…</p>}
      {status === 'error' && (
        <div className="flex flex-col items-center gap-2 text-sm text-red-600">
          <span>{error || 'Could not prepare this Alternate Messenger link.'}</span>
          <button type="button" onClick={retry} className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:text-red-800">
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}
      {status === 'ready' && (
        <>
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <Icon size={22} />
          </span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {cta} <ExternalLink size={15} />
          </a>
          <p className="max-w-sm text-center text-xs text-slate-400">
            Opens in a new tab, signed in as you. Alternate Messenger's own login screen may still appear until their side
            supports embedding — you'll only need to sign in there once.
          </p>
        </>
      )}
    </div>
  );
}

export function SmsCampaignsSection() {
  const [active, setActive] = useState(SMS_TABS[0].key);
  const activeTab = SMS_TABS.find((t) => t.key === active);

  return (
    <div className="flex flex-col h-full">
      <div className="mb-3">
        <Tabs tabs={SMS_TABS} active={active} onChange={setActive} />
      </div>
      <p className="text-xs text-slate-500 mb-3">
        {active === 'campaigns' ? 'Create and send SMS campaigns via Alternate Messenger.' : 'Track replies and ongoing SMS conversations via Alternate Messenger.'}
      </p>
      <OpenInAlternateMessenger key={activeTab.key} tabKey={activeTab.key} cta={activeTab.cta} Icon={activeTab.icon} />
    </div>
  );
}
