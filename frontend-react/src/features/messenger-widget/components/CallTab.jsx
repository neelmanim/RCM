import React, { useEffect, useState } from 'react';
import { Phone, Mic, MicOff, Pause, Play, PhoneOff } from 'lucide-react';
import { AlternateMessenger } from '../engine/dialerEngine';
import { widgetUiStore } from '../engine/widgetUiStore';
import { DialerService, CallsService } from '../../../services/api';
import { toast } from '../engine/toast';
import { Avatar } from '../../../components/ui/Avatar';
import { Spinner } from '../../../components/ui/Spinner';

function useElapsed(startTime, active) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active || !startTime) return; // not connected yet — render shows "Ringing…" instead, elapsed is never read
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startTime) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, startTime]);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function ModeSelector({ leadName, phone, onPick, onCancel }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-5 text-center">
      <Avatar name={leadName} size={56} background="rgba(255,255,255,0.1)" />
      <div className="text-sm font-semibold text-white/85">{leadName || 'Unknown'}</div>
      <div className="text-xs text-white/50">{phone}</div>
      <button
        type="button"
        onClick={() => onPick('bridge')}
        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left"
      >
        <span className="text-lg">📞</span>
        <span>
          <div className="text-sm font-semibold text-white/90">Phone Bridge</div>
          <div className="text-[11px] text-white/45">Rings your registered phone first</div>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onPick('browser')}
        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left"
      >
        <span className="text-lg">🎧</span>
        <span>
          <div className="text-sm font-semibold text-white/90">Browser Call</div>
          <div className="text-[11px] text-white/45">Talk directly from this tab</div>
        </span>
      </button>
      <button type="button" onClick={onCancel} className="text-xs text-white/40 hover:text-white/70 mt-1">
        Cancel
      </button>
    </div>
  );
}

/** RCA 2026-07-22 (ported from app.js's _showForceClearBanner): shown when
 * starting a call fails because the backend thinks one is already active —
 * a zombie DB record left over when AlternateMessenger.hangup() silently
 * swallowed a 502 from /calls/disconnect. Scoped to the manual-dial path
 * only; the lead-detail 📞 flow goes through app.js's own handleCallAction,
 * which already has this same detection (now correctly targeting whichever
 * engine owns window.AlternateMessengerDialer). */
function ForceClearBanner({ activeCallData, onCleared, onDismiss }) {
  const [clearing, setClearing] = useState(false);
  return (
    <div className="mx-4 mt-3 px-3 py-2.5 rounded-lg bg-indigo-500/15 border border-indigo-400/30 text-xs text-white/85 flex flex-col gap-2">
      <span>⚠️ A previous call is still active in the system. If your last call already ended, click Force Clear to unblock your dialer.</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={clearing}
          onClick={async () => {
            setClearing(true);
            try {
              if (activeCallData?.call_id) await CallsService.forceEnd(activeCallData.call_id);
              AlternateMessenger.destroy();
              toast('Cleared. You can now make a new call.', 'success', 5000);
              onCleared();
            } catch (err) {
              toast(`Force clear failed: ${err.message}`, 'warning', 5000);
              setClearing(false);
            }
          }}
          className="px-3 py-1 rounded-lg bg-white/15 hover:bg-white/25 font-semibold disabled:opacity-50"
        >
          {clearing ? 'Clearing…' : 'Force Clear'}
        </button>
        <button type="button" onClick={onDismiss} className="text-white/40 hover:text-white/70">Dismiss</button>
      </div>
    </div>
  );
}

function ManualDialForm({ onDial, onCancel }) {
  const [phone, setPhone] = useState('');
  return (
    <div className="flex flex-col gap-3 p-5">
      <label className="text-xs font-semibold uppercase tracking-wide text-white/40">Dial a number</label>
      <input
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="+1 555 123 4567"
        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/90 text-sm outline-none focus:border-focus-ring"
      />
      <button
        type="button"
        disabled={!phone.trim()}
        onClick={() => onDial(phone.trim(), 'bridge')}
        className="w-full px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40 text-sm font-semibold text-white/90"
      >
        📞 Phone Bridge
      </button>
      <button
        type="button"
        disabled={!phone.trim()}
        onClick={() => onDial(phone.trim(), 'browser')}
        className="w-full px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40 text-sm font-semibold text-white/90"
      >
        🎧 Browser Call
      </button>
      <button type="button" onClick={onCancel} className="text-xs text-white/40 hover:text-white/70">
        Cancel
      </button>
    </div>
  );
}

function IdleWithLead({ leadId, leadName, phone }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-5 text-center">
      <Avatar name={leadName} size={56} background="rgba(255,255,255,0.1)" />
      <div className="text-sm font-semibold text-white/85">{leadName || 'Unknown'}</div>
      <div className="text-xs text-white/50">{phone}</div>
      <div className="text-[11px] text-white/35">Ready to call</div>
      <button
        type="button"
        onClick={() => window._openCallModal?.(leadId, leadName || '', phone, window._currentLead || {})}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-semibold text-white/90"
      >
        <Phone size={15} /> Dial {leadName || 'Lead'}
      </button>
    </div>
  );
}

function GenericIdle() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center text-white/45">
      <Phone size={32} className="opacity-40" />
      <div className="text-sm font-semibold text-white/70 mt-1">Ready to call</div>
      <div className="text-xs max-w-[220px]">Open a lead and click the 📞 Call button to start a call.</div>
    </div>
  );
}

function Connecting({ leadName }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center text-white/70">
      <Spinner size={32} tone="light" />
      <div className="text-sm font-semibold">Connecting{leadName ? ` to ${leadName}` : ''}…</div>
    </div>
  );
}

function ActiveCall({ ctx }) {
  const elapsed = useElapsed(ctx.startTime, ctx.connected);
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-5 text-center">
      <Avatar name={ctx.leadName} size={56} background="rgba(255,255,255,0.1)" />
      <div className="text-sm font-semibold text-white/85">{ctx.leadName || 'Unknown'}</div>
      <div className="text-xs text-white/50">{ctx.phone}</div>
      <div className="text-sm font-mono text-emerald-400">
        {ctx.connected ? elapsed : 'Ringing…'}
      </div>
      <div className="flex items-center gap-3 mt-2">
        <button
          type="button"
          onClick={() => AlternateMessenger.mute()}
          aria-label={ctx.muted ? 'Unmute' : 'Mute'}
          className={`w-11 h-11 rounded-full flex items-center justify-center border border-white/10 ${ctx.muted ? 'bg-red-500/20 text-red-300' : 'bg-white/5 text-white/80 hover:bg-white/10'}`}
        >
          {ctx.muted ? <MicOff size={17} /> : <Mic size={17} />}
        </button>
        <button
          type="button"
          onClick={() => AlternateMessenger.hold()}
          aria-label={ctx.held ? 'Resume' : 'Hold'}
          className={`w-11 h-11 rounded-full flex items-center justify-center border border-white/10 ${ctx.held ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-white/80 hover:bg-white/10'}`}
        >
          {ctx.held ? <Play size={17} /> : <Pause size={17} />}
        </button>
        <button
          type="button"
          onClick={() => AlternateMessenger.hangup()}
          aria-label="End call"
          className="w-11 h-11 rounded-full flex items-center justify-center bg-red-600 hover:bg-red-700 text-white"
        >
          <PhoneOff size={17} />
        </button>
      </div>
    </div>
  );
}

export function CallTab({ dialerSnapshot, ui }) {
  const { state, ctx } = dialerSnapshot;
  const [dialError, setDialError] = useState(null);
  const [zombieCall, setZombieCall] = useState(null);

  // RCA 2026-08-25 (live): a pending mode-selection always wins over the
  // dialer engine's own state. app.js only calls openForCall() after its own
  // guards (isActive()/_callInFlight/getMyActiveCall) already concluded no
  // real call is in progress — so reaching here with pendingCallCtx set
  // while the engine still reports ACTIVE/ENDING/INITIATING means the
  // engine's state is stale (the same class of desync the
  // ParticipantDisconnected fix targeted, via a different path), not a real
  // call to protect. Rendering ActiveCall/Connecting instead of
  // ModeSelector in that case hid the mode buttons entirely — the SDR had
  // nothing to click, and openForCall()'s promise timed out after 45s
  // ("Dialer did not respond") even though the widget visibly "popped up".
  if (ui.pendingCallCtx) {
    return (
      <ModeSelector
        leadName={ui.pendingCallCtx.leadName}
        phone={ui.pendingCallCtx.phone}
        onPick={(mode) => widgetUiStore.resolvePendingMode(mode)}
        onCancel={() => widgetUiStore.resolvePendingMode(null)}
      />
    );
  }

  if (state === 'ACTIVE') return <ActiveCall ctx={ctx} />;
  if (state === 'ENDING') return <Connecting leadName={ctx.leadName} />;
  if (state === 'INITIATING') return <Connecting leadName={ctx.leadName} />;

  if (ui.manualDialActive) {
    return (
      <div className="flex-1 flex flex-col">
        {zombieCall && (
          <ForceClearBanner
            activeCallData={zombieCall}
            onCleared={() => setZombieCall(null)}
            onDismiss={() => setZombieCall(null)}
          />
        )}
        {dialError && !zombieCall && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
            {dialError}
          </div>
        )}
        <div className="flex-1 flex flex-col justify-center">
        <ManualDialForm
          onDial={async (phone, callMode) => {
            setDialError(null);
            setZombieCall(null);
            try {
              AlternateMessenger.setInitiating();
              const result = await DialerService.startCall(null, phone, callMode);
              widgetUiStore.resolvePendingManualDial({ phone, callMode });
              if (result?.provider === 'messenger') {
                await AlternateMessenger.activate(result, '', phone, callMode);
              }
            } catch (err) {
              const message = err?.response?.data?.detail || err.message || 'Could not start call';
              AlternateMessenger.destroy();
              // Ghost call auto-heal (ported from app.js's handleCallAction): the
              // backend applies staleness thresholds and may have already healed
              // it by the time we check — only show Force Clear if it's still live.
              if (message.toLowerCase().includes('active call')) {
                try {
                  const activeData = await CallsService.getMyActive();
                  if (!activeData?.active) {
                    toast('Cleared a stuck call. Please try calling again.', 'success', 5000);
                  } else {
                    setZombieCall(activeData);
                  }
                  return;
                } catch { /* fall through to the generic error below */ }
              }
              setDialError(message);
            }
          }}
          onCancel={() => widgetUiStore.resolvePendingManualDial(null)}
        />
        </div>
      </div>
    );
  }

  if (ui.leadId && ui.leadPhone) {
    return <IdleWithLead leadId={ui.leadId} leadName={ui.leadName} phone={ui.leadPhone} />;
  }

  return <GenericIdle />;
}
