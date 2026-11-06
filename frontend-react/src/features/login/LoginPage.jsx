import React from 'react';
import { PhoneCall, Sparkles, RefreshCw, ShieldCheck, ArrowRight, Zap, ExternalLink } from 'lucide-react';

export function LoginPage() {
  const handleLaunchSandbox = () => {
    window.location.href = 'sandbox.html';
  };

  const handleRequestAccess = () => {
    window.location.href = 'https://alternatecrm.com';
  };

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-[#06080c] text-white font-sans selection:bg-[#d3fa76] selection:text-[#06080c] overflow-x-hidden relative">
      {/* Background Ambient Glows */}
      <div className="absolute top-[-120px] left-[-100px] w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-[160px] pointer-events-none" />
      <div className="absolute bottom-[-100px] right-[-100px] w-[500px] h-[500px] bg-[#d3fa76]/5 rounded-full blur-[140px] pointer-events-none" />

      {/* ── Left Hero Side (Behance Dark Glassmorphic Presentation) ─────────── */}
      <div className="relative flex-1 flex flex-col justify-between p-8 sm:p-12 lg:p-16 xl:p-20 z-10 border-b lg:border-b-0 lg:border-r border-white/[0.08]">
        {/* Top Brand Logo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#d3fa76] flex items-center justify-center p-2 shadow-[0_0_20px_rgba(211,250,118,0.3)]">
            <span className="text-[#06080c] text-xl font-black">✳</span>
          </div>
          <div className="flex items-baseline text-2xl font-black tracking-tight">
            <span className="text-white">alternate</span>
            <span className="text-slate-400 font-normal">crm</span>
          </div>
        </div>

        {/* Center Main Value Proposition (Validated Market Standards) */}
        <div className="my-auto py-12 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 mb-6">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>THE AUTONOMOUS SALES CONVERSATION OS</span>
          </div>

          <h1 className="text-4xl sm:text-5xl xl:text-6xl font-black tracking-tight leading-[1.08] text-white">
            Kill the static CRM.
            <br />
            <span className="bg-gradient-to-r from-white via-slate-200 to-[#d3fa76] bg-clip-text text-transparent">
              Accelerate your pipeline.
            </span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-slate-400 leading-relaxed max-w-xl font-normal">
            Alternate CRM unifies a sub-200ms WebRTC power dialer, live speech-to-intent intelligence,
            and autonomous multi-touch cadences into one high-velocity revenue engine.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={handleLaunchSandbox}
              className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-2xl bg-[#d3fa76] hover:bg-[#bfe660] text-[#06080c] text-sm font-extrabold shadow-[0_0_25px_rgba(211,250,118,0.3)] transition-all hover:-translate-y-0.5 cursor-pointer"
            >
              <span>⚡</span>
              <span>Launch Live Sandbox</span>
              <ArrowRight size={16} strokeWidth={2.5} />
            </button>
            <span className="text-xs text-slate-400 font-medium">
              Zero login or credit card required
            </span>
          </div>

          {/* Three Validated Technical Capabilities */}
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-5">
            {/* Capability 1 */}
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-md">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mb-3">
                <PhoneCall size={18} />
              </div>
              <h3 className="text-xs font-bold text-white mb-1 uppercase tracking-wider">
                Sub-200ms WebRTC
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Parallel outbound dialing with zero desktop plugins and edge audio recording.
              </p>
            </div>

            {/* Capability 2 */}
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-md">
              <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 flex items-center justify-center mb-3">
                <Sparkles size={18} />
              </div>
              <h3 className="text-xs font-bold text-white mb-1 uppercase tracking-wider">
                Live Speech AI
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Streaming Whisper transcription and on-screen objection battlecards during active calls.
              </p>
            </div>

            {/* Capability 3 */}
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-md">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-3">
                <RefreshCw size={18} />
              </div>
              <h3 className="text-xs font-bold text-white mb-1 uppercase tracking-wider">
                2-Way CRM Sync
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Bi-directional sync with Salesforce, HubSpot, and Nylas mailbox with zero manual admin.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Trust Note */}
        <div className="flex items-center gap-6 text-xs text-slate-400 pt-6">
          <div className="flex items-center gap-1.5 font-mono">
            <ShieldCheck size={14} className="text-emerald-400" />
            <span>SOC2 Type II Ready</span>
          </div>
          <span>•</span>
          <span>Zero Audio Training on Customer Data</span>
        </div>
      </div>

      {/* ── Right Workspace Access Gate (Login Disabled) ───────────────── */}
      <div className="relative w-full lg:w-[480px] xl:w-[540px] bg-[#0b0f17] flex flex-col justify-center px-8 py-12 sm:px-12 lg:px-14 xl:px-16 z-20">
        <div className="max-w-md mx-auto w-full space-y-7">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
              <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                Direct Sign-in Disabled
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Private Workspace Gate
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-400 leading-relaxed">
              Alternate CRM is currently in private beta for selected revenue organizations. Direct username & password access is restricted to provisioned enterprise pilots.
            </p>
          </div>

          {/* Interactive Sandbox Card */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-indigo-950/60 to-slate-900 border border-indigo-500/30 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-indigo-400 uppercase tracking-wider">
                <Zap size={15} />
                <span>Client-Side Demo Sandbox</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Instant Access
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Explore the full Conversation OS right now. Test the WebRTC power dialer, move deals across the pipeline kanban, and inspect SDR telemetry with pre-loaded enterprise data.
            </p>

            <button
              type="button"
              onClick={handleLaunchSandbox}
              className="w-full py-3.5 px-5 rounded-xl font-extrabold text-xs bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition-all hover:scale-[1.01] flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>⚡ Launch Live Sandbox (No Sign-in Required)</span>
              <ArrowRight size={15} />
            </button>
          </div>

          {/* Request Enterprise Access */}
          <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">Need a Dedicated Workspace?</span>
              <span className="text-[11px] font-mono text-slate-400">VIP Onboarding</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Request early access for your revenue team or schedule a live 15-minute 1-on-1 walkthrough with our founding engineering team.
            </p>
            <button
              type="button"
              onClick={handleRequestAccess}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/10 text-white border border-white/10 transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Request VIP Early Access ↗</span>
              <ExternalLink size={13} />
            </button>
          </div>

          {/* Compliance & Status Footer */}
          <div className="text-center pt-2 text-xs text-slate-400 space-y-1">
            <p>
              Workspaces protected by enterprise-grade isolation and zero-loss local storage.
            </p>
            <p className="text-[11px] font-mono text-slate-400">
              Release v14.4.0 • Cluster Operational
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
