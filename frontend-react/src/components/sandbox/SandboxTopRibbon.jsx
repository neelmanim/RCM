import React, { useState, useEffect } from 'react';
import { SandboxStore, PERSONAS } from '../../services/sandboxStore';
import { 
  Sparkles, RotateCcw, PhoneCall, Moon, Sun, 
  User, CheckCircle2, X, Volume2, Mic, PhoneOff
} from 'lucide-react';

export default function SandboxTopRibbon({ darkMode, setDarkMode }) {
  const [activePersona, setActivePersona] = useState(() => SandboxStore.getActivePersona());
  const [isDialerOpen, setIsDialerOpen] = useState(false);
  const [callState, setCallState] = useState('idle'); // idle, ringing, connected, ended
  const [callDuration, setCallDuration] = useState(0);
  const [toastMessage, setToastMessage] = useState(null);

  useEffect(() => {
    let timer;
    if (callState === 'connected') {
      timer = setInterval(() => setCallDuration(d => d + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [callState]);

  const handlePersonaChange = (e) => {
    const pId = e.target.value;
    SandboxStore.setPersona(pId);
    setActivePersona(PERSONAS.find(p => p.id === pId));
    showToast(`Switched persona to ${PERSONAS.find(p => p.id === pId)?.name}`);
  };

  const handleReset = () => {
    SandboxStore.reset();
    setActivePersona(PERSONAS[0]);
    showToast('🔄 Demo environment restored to clean seeded state.');
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const startTestCall = () => {
    setIsDialerOpen(true);
    setCallState('ringing');
    setCallDuration(0);
    setTimeout(() => {
      setCallState('connected');
    }, 2500);
  };

  const endCallWithOutcome = (outcome) => {
    setCallState('ended');
    SandboxStore.addCallLog(101, {
      duration: `${Math.floor(callDuration / 60)}m ${callDuration % 60}s`,
      outcome,
      notes: `Simulated live call via Sandbox dialer. Outcome marked as: ${outcome}.`
    });
    showToast(`📞 Call logged for Sarah Jenkins (Stripe) as "${outcome}"`);
    setTimeout(() => {
      setIsDialerOpen(false);
      setCallState('idle');
    }, 1200);
  };

  const formatSecs = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-14 right-6 z-50 flex items-center gap-3 px-4 py-3 bg-slate-900 text-white border border-indigo-500/40 rounded-xl shadow-xl backdrop-blur-md animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Ribbon Bar */}
      <div className="h-11 bg-slate-950 border-b border-indigo-950/60 px-4 flex items-center justify-between text-xs text-slate-300 select-none z-40">
        {/* Left: Sandbox Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 font-semibold">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span>Interactive Sandbox Demo</span>
          </div>
          <span className="hidden md:inline text-slate-500 font-mono">
            Zero-Config Client-Side Engine
          </span>
        </div>

        {/* Right: Controls & Persona Switcher */}
        <div className="flex items-center gap-3">
          {/* Persona Switcher */}
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1">
            <User className="w-3.5 h-3.5 text-indigo-400" />
            <select
              value={activePersona.id}
              onChange={handlePersonaChange}
              className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer text-xs"
            >
              {PERSONAS.map(p => (
                <option key={p.id} value={p.id} className="bg-slate-900 text-slate-200">
                  {p.name} ({p.role.split(' ')[0]})
                </option>
              ))}
            </select>
          </div>

          {/* Quick Call Action */}
          <button
            onClick={startTestCall}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30 font-semibold transition-all"
            title="Launch Simulated Outbound Call"
          >
            <PhoneCall className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Simulate Call</span>
          </button>

          {/* Reset Action */}
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 transition-all font-medium"
            title="Reset to clean sample data"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset State</span>
          </button>

          {/* Dual Theme Toggle */}
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-amber-400 transition-all"
            title="Toggle Dark/Light Mode"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Floating Simulated Dialer Modal */}
      {isDialerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl text-white space-y-6 animate-scaleUp">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" />
                <span className="font-bold text-sm">AI Power Dialer Simulation</span>
              </div>
              <button 
                onClick={() => setIsDialerOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Calling Contact Info */}
            <div className="text-center space-y-2 py-4">
              <div className="w-16 h-16 rounded-full bg-indigo-600/20 border border-indigo-500/40 text-indigo-400 flex items-center justify-center font-bold text-xl mx-auto">
                SJ
              </div>
              <h4 className="text-xl font-bold">Sarah Jenkins</h4>
              <p className="text-sm text-slate-400">VP of Revenue Operations · Stripe</p>
              <p className="text-xs font-mono text-indigo-400">+1 (415) 890-2341</p>
            </div>

            {/* Call Status & Animated Audio Waveform */}
            <div className="bg-slate-950 rounded-2xl p-4 border border-slate-800/80 text-center space-y-3">
              <div className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                {callState === 'ringing' && 'Connecting to local carrier network...'}
                {callState === 'connected' && `Call Active · ${formatSecs(callDuration)}`}
                {callState === 'ended' && 'Call Terminated'}
              </div>

              {callState === 'connected' ? (
                <div className="flex items-center justify-center gap-1.5 h-10">
                  <span className="w-1 bg-indigo-500 rounded-full animate-bounce h-6" />
                  <span className="w-1 bg-indigo-400 rounded-full animate-bounce h-10 delay-75" />
                  <span className="w-1 bg-indigo-500 rounded-full animate-bounce h-4 delay-150" />
                  <span className="w-1 bg-indigo-400 rounded-full animate-bounce h-8 delay-100" />
                  <span className="w-1 bg-indigo-500 rounded-full animate-bounce h-5 delay-200" />
                </div>
              ) : (
                <div className="text-xs text-slate-500 italic py-2">
                  {callState === 'ringing' ? 'Ringing outbound line...' : 'Dispositioning...'}
                </div>
              )}
            </div>

            {/* Disposition Actions */}
            {callState === 'connected' && (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Log Call Disposition
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => endCallWithOutcome('Meeting Scheduled')}
                    className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold transition-all"
                  >
                    Meeting Booked
                  </button>
                  <button
                    onClick={() => endCallWithOutcome('Left Voicemail')}
                    className="p-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-bold transition-all"
                  >
                    Voicemail Drop
                  </button>
                  <button
                    onClick={() => endCallWithOutcome('Connected / Follow-up')}
                    className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold transition-all"
                  >
                    Follow-up
                  </button>
                </div>
              </div>
            )}

            {/* Hangup Button */}
            <div className="pt-2">
              <button
                onClick={() => endCallWithOutcome('Call Ended')}
                className="w-full py-3 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all"
              >
                <PhoneOff className="w-4 h-4" />
                <span>Disconnect Call</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
