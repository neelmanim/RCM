import { containDialogFocus } from '../containDialogFocus';
import React, { useRef, useState, useEffect } from 'react';
import { SandboxStore, PERSONAS } from '../../services/sandboxStore';
import { RotateCcw, PhoneCall, Moon, Sun, X, Menu } from 'lucide-react';

export default function SandboxTopRibbon({ darkMode, setDarkMode, onToggleMenu, isMobileMenuOpen }) {
  const [activePersona, setActivePersona] = useState(() => SandboxStore.getActivePersona());
  const [isDialerOpen, setIsDialerOpen] = useState(false);
  const [callState, setCallState] = useState('idle');
  const [callDuration, setCallDuration] = useState(0);
  const [callLead, setCallLead] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isDialerOpen && !dialog.open) dialog.showModal();
    if (!isDialerOpen && dialog.open) dialog.close();
  }, [isDialerOpen]);

  useEffect(() => {
    if (callState !== 'ringing') return;
    const timer = setTimeout(() => setCallState('connected'), 1200);
    return () => clearTimeout(timer);
  }, [callState]);

  useEffect(() => {
    if (callState !== 'connected') return;
    const timer = setInterval(() => setCallDuration(seconds => seconds + 1), 1000);
    return () => clearInterval(timer);
  }, [callState]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = message => {
    clearTimeout(toastTimer.current);
    setToastMessage(message);
    toastTimer.current = setTimeout(() => setToastMessage(''), 4000);
  };
  const closeCall = () => {
    setIsDialerOpen(false);
    setCallState('idle');
    triggerRef.current?.focus();
  };
  const reset = () => {
    closeCall();
    SandboxStore.reset();
    setActivePersona(PERSONAS[0]);
    showToast('Sample accounts, notes and call logs restored.');
  };
  const startCall = () => {
    const lead = SandboxStore.getLeads().find(item => item.id === 101) || SandboxStore.getLeads()[0];
    if (!lead) { showToast('No sample account available. Reset the demo first.'); return; }
    setCallLead(lead);
    setCallDuration(0);
    setCallState('ringing');
    setIsDialerOpen(true);
  };
  const saveOutcome = outcome => {
    if (callState !== 'connected' || !callLead) return;
    SandboxStore.addCallLog(callLead.id, {
      duration: `${Math.floor(callDuration / 60)}m ${callDuration % 60}s`, outcome,
      notes: `Demo simulation only. No real call was placed. Outcome: ${outcome}.`,
    });
    setCallState('ended');
    showToast(`Sample call outcome saved for ${callLead.name}.`);
  };
  return <>
    <div role="status" className="sr-only">{toastMessage}</div>
    {toastMessage && <div aria-hidden="true" className="fixed bottom-4 right-4 left-4 sm:left-auto z-50 max-w-md rounded-xl p-4 bg-slate-900 text-white border border-lime-300/30 shadow-lg text-sm">{toastMessage}</div>}
    <header className="min-h-14 bg-slate-950 border-b border-slate-800 px-3 py-2 sm:px-4 flex flex-wrap items-center justify-between gap-3 text-slate-200">
      <div className="flex items-center gap-2">
        <button onClick={onToggleMenu} className="crm-icon-button lg:hidden" aria-label="Toggle navigation" aria-expanded={isMobileMenuOpen} aria-controls="workspace-navigation"><Menu size={18}/></button>
        <span className="crm-badge">Demo workspace</span><span className="hidden xl:inline text-xs text-slate-400">Fictional data · Session-only changes</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <select aria-label="Demo persona" className="max-w-40 min-h-11 rounded-lg bg-slate-900 border border-slate-700 text-xs px-2" value={activePersona.id} onChange={event => {SandboxStore.setPersona(event.target.value);setActivePersona(PERSONAS.find(persona => persona.id === event.target.value));}}>{PERSONAS.map(persona => <option key={persona.id} value={persona.id}>{persona.name}</option>)}</select>
        <button ref={triggerRef} onClick={startCall} className="crm-icon-button gap-2 text-lime-300" aria-label="Simulate call"><PhoneCall size={17}/><span className="hidden sm:inline text-xs font-semibold">Simulate call</span></button>
        <button onClick={reset} className="crm-icon-button gap-2" aria-label="Reset to clean sample data"><RotateCcw size={17}/><span className="hidden sm:inline text-xs">Reset demo</span></button>
        <button onClick={() => setDarkMode(!darkMode)} className="crm-icon-button" aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}>{darkMode ? <Sun size={18}/> : <Moon size={18}/>}</button>
      </div>
    </header>
    <dialog onKeyDown={containDialogFocus} ref={dialogRef} onCancel={closeCall} onClose={closeCall} aria-labelledby="call-dialog-title" aria-describedby="call-dialog-description" className="crm-call-dialog w-[calc(100%-2rem)] max-w-md rounded-2xl p-5 sm:p-6 border border-slate-700 bg-slate-900 text-white shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
      <div className="flex items-center justify-between gap-3"><h2 id="call-dialog-title" className="text-lg font-semibold">Call outcome simulation</h2><button autoFocus className="crm-icon-button" aria-label="Close call simulation" onClick={() => dialogRef.current.close()}><X size={20}/></button></div>
      <p id="call-dialog-description" className="text-sm text-slate-300 mt-3">A local demo only. No phone connection, microphone access, transcription or messages.</p>
      {callLead && <div className="my-5 p-4 rounded-xl bg-slate-950"><h3 className="font-semibold">{callLead.name}</h3><p className="text-sm text-slate-300">{callLead.company} · Fictional account</p></div>}
      <p role="status" className="sr-only">{callState === 'ringing' ? 'Starting sample interaction' : callState === 'connected' ? 'Simulation ready. Choose a sample outcome.' : callState === 'ended' ? 'Sample outcome saved.' : ''}</p>
      <p aria-live="off" className="my-4 text-sm text-lime-300">{callState === 'ringing' ? 'Starting sample interaction…' : callState === 'connected' ? `Simulation running · ${Math.floor(callDuration / 60)}:${String(callDuration % 60).padStart(2, '0')}` : callState === 'ended' ? 'Outcome saved to the sample account.' : ''}</p>
      {callState === 'connected' && <div className="space-y-3"><p className="text-sm font-semibold">Choose an outcome</p><div className="grid gap-2">{['Meeting Scheduled', 'Left Voicemail', 'Connected / Follow-up'].map(outcome => <button key={outcome} onClick={() => saveOutcome(outcome)} className="crm-button">{outcome}</button>)}</div></div>}
      <button onClick={() => dialogRef.current.close()} className="mt-5 w-full min-h-11 rounded-xl border border-slate-600 text-sm">{callState === 'ended' ? 'Done' : 'Cancel simulation'}</button>
    </dialog>
  </>;
}
