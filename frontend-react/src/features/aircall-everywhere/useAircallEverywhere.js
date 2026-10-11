import { useEffect, useRef, useState } from 'react';
import AircallWorkspaceModule from 'aircall-everywhere';
import { DialerService, AdminService } from '../../services/api';

// Neither Aircall's webhook payload nor the Aircall Everywhere SDK exposes any
// audio-quality signal (no MOS/jitter/packet-loss/hangup-cause-for-connected-
// calls anywhere — confirmed by reading the SDK's real event catalogue and a
// week of raw webhook payloads). The SDR's own network condition during the
// call is the only automatic proxy available client-side, and it is only a
// proxy — a degraded reading doesn't prove bad audio, and a clean reading
// doesn't rule it out. Flagged into the existing error-log/dialer category so
// an admin can eyeball whether reports cluster with real network dips,
// without a new dashboard.
function flagPossibleNetworkIssue(connectionAtStart, connectionAtEnd) {
  const isDegraded = (c) =>
    c && (c.rtt > 400 || c.downlink < 1.5 || ['slow-2g', '2g', '3g'].includes(c.effectiveType));
  if (!isDegraded(connectionAtStart) && !isDegraded(connectionAtEnd)) return;
  AdminService.reportError({
    severity: 'warning',
    category: 'dialer',
    feature: 'Aircall Everywhere',
    title: 'Degraded network detected during an Aircall call',
    description: 'Network Information API showed a degraded connection at call start and/or end. This is a proxy for the SDR\'s network, not a confirmed audio-quality measurement — cross-check against call quality complaints before acting.',
    context_json: JSON.stringify({ connectionAtStart, connectionAtEnd }),
  }).catch(() => {}); // best-effort — never blocks the call UI
}

function sampleConnection() {
  const c = typeof navigator !== 'undefined' && navigator.connection;
  if (!c) return null; // Network Information API unsupported (e.g. Safari) — no signal, no error
  return { effectiveType: c.effectiveType, downlink: c.downlink, rtt: c.rtt };
}

// aircall-everywhere@2.0.6's own CJS build double-wraps its default export
// ({ __esModule: true, default: <class> } instead of the class itself) —
// confirmed via `require('aircall-everywhere')` and reproduced through a real
// esbuild bundle (same tool Vite uses), not just observed in the browser.
// esbuild's CJS interop doesn't unwrap this automatically, so `new
// AircallWorkspaceModule(...)` throws "is not a constructor" — unwrap
// defensively rather than trust the bundler here.
const AircallWorkspace = AircallWorkspaceModule.default || AircallWorkspaceModule;

// V48: Aircall Everywhere — embeds Aircall's own Workspace app in the browser
// so an SDR can be logged in there instead of the Desktop app. That's this
// hook's ENTIRE job: construct the SDK and track login status for the
// widget's UI. It does not drive calls — confirmed live (2026-08-11) that the
// existing, completely unmodified bridge-mode flow (POST /users/{id}/calls,
// unchanged in handleCallAction/dialer_service.py) already rings whichever
// device the agent is currently logged into. Once an SDR logs in here instead
// of the Desktop app, their existing Call button just works, automatically,
// with zero code path change — the SDK's dial_number command was an
// unnecessary, never-actually-needed mechanism (an earlier version of this
// hook drove calls through it directly; removed after live testing showed
// the REST flow already handles it and dial_number only pre-fills a number
// for a human to click Call on inside the iframe, not what was needed here).
export const OPT_OUT_KEY = 'aircall_everywhere_pref';
export const CONTAINER_ID = 'aircall-everywhere-mount';

export function useAircallEverywhere() {
  // idle -> checking eligibility | ineligible -> not shown at all (not aircall,
  // flag off, or SDR opted out) | loading -> constructing the SDK | ready -> logged
  // in, existing Call button will ring here | notready -> loaded but logged out
  // | error -> SDK failed to load
  const [status, setStatusReact] = useState('idle');
  const statusRef = useRef('idle');
  // Whether a call is currently ringing/connected on this device. The panel
  // hosting the embed must stay reachable while this is true — mute/hold/
  // hangup only exist inside Aircall's own UI (never had a CRM-side hangup
  // button for Aircall, bridge mode or otherwise: the Desktop app's window
  // was always the only place to hang up, just permanently reachable via
  // cmd-tab). Collapsing this panel by default is only safe when there's
  // nothing in it that needs reaching.
  const [callActive, setCallActive] = useState(false);

  function setStatus(next) {
    statusRef.current = next;
    setStatusReact(next);
  }

  useEffect(() => {
    let cancelled = false;

    DialerService.getStatus()
      .then((s) => {
        if (cancelled) return;
        const eligible = s.active && s.provider === 'aircall' && s.aircall_everywhere_enabled;
        if (!eligible) {
          setStatus('ineligible'); // not applicable at all — nothing to show, nothing to undo
          return;
        }
        if (localStorage.getItem(OPT_OUT_KEY) === 'bridge_only') {
          setStatus('opted_out'); // applicable, but this SDR turned it off — show a way back in
          return;
        }

        setStatus('loading');
        try {
          const workspace = new AircallWorkspace({
            domToLoadWorkspace: `#${CONTAINER_ID}`,
            onLogin: () => {
              if (cancelled) return;
              setStatus('ready');
              // RCA 2026-08-18: the org-wide flag has no idea which SDRs
              // actually log in here vs. stay Desktop-only — this is the
              // only server-side signal of real per-SDR adoption. Best-effort,
              // never blocks the UI on failure.
              DialerService.recordEverywhereLogin().catch(() => {});
            },
            onLogout: () => { if (!cancelled) setStatus('notready'); },
            // 'big' (666x376, fixed) — matches Aircall's own official demo
            // (aircall.github.io/aircall-everywhere, demo_v2). Confirmed live
            // (2026-08-11) in the sandbox that mute/hold/hangup only respond
            // to clicks under this exact config — 'small' + a forced
            // container height left them rendered but unresponsive.
            size: 'big',
          });
          // Not driving calls with these (see docblock above) — only tracking
          // whether one is live, so the UI knows to stay reachable.
          let connectionAtStart = null;
          const onCallStart = () => {
            if (cancelled) return;
            setCallActive(true);
            connectionAtStart = sampleConnection();
          };
          workspace.on('outgoing_call', onCallStart);
          workspace.on('incoming_call', onCallStart);
          workspace.on('call_ended', () => {
            if (cancelled) return;
            setCallActive(false);
            flagPossibleNetworkIssue(connectionAtStart, sampleConnection());
            connectionAtStart = null;
          });
        } catch (e) {
          console.error('[AircallEverywhere] SDK construction failed:', e);
          setStatus('error');
        }
      })
      .catch(() => setStatus('ineligible'));

    return () => { cancelled = true; };
  }, []);

  return { status, callActive };
}
