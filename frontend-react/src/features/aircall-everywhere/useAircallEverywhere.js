import { useEffect, useRef, useState } from 'react';
import AircallWorkspaceModule from 'aircall-everywhere';
import { DialerService } from '../../services/api';

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
            onLogin: () => { if (!cancelled) setStatus('ready'); },
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
          workspace.on('outgoing_call', () => { if (!cancelled) setCallActive(true); });
          workspace.on('incoming_call', () => { if (!cancelled) setCallActive(true); });
          workspace.on('call_ended', () => { if (!cancelled) setCallActive(false); });
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
