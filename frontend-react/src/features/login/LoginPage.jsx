import React from 'react';
import { ArrowRight, BarChart3, Layers, PhoneCall, ExternalLink } from 'lucide-react';

export function LoginPage() {
  return (
    <main id="workspace-access" className="login-page min-h-screen w-full bg-[#06080c] text-white font-sans selection:bg-[#d3fa76] selection:text-[#06080c]">
      <a className="login-skip-link" href="#access-options">Skip to access options</a>
      <div className="mx-auto min-h-screen max-w-[1440px] grid lg:grid-cols-[1.25fr_1fr]">
        <section className="p-6 sm:p-12 lg:p-16 xl:p-20 border-b lg:border-b-0 lg:border-r border-white/10">
          <a href="https://alternatecrm.com/" aria-label="Alternate CRM home" className="inline-flex items-center gap-3 text-2xl font-extrabold tracking-tight rounded-lg">
            <span aria-hidden="true" className="w-10 h-10 rounded-xl bg-[#d3fa76] text-[#06080c] flex items-center justify-center">✳</span>
            <span>alternate<span className="text-slate-400 font-normal">crm</span></span>
          </a>
          <div className="py-12 sm:py-16 max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-widest text-[#d3fa76] mb-5">A workspace for your sales pipeline</p>
            <h1 className="text-3xl sm:text-5xl xl:text-6xl font-extrabold tracking-tight leading-[1.1]">Keep the next step<br className="hidden sm:block" /> in sight.</h1>
            <p className="mt-6 text-base sm:text-lg text-slate-300 leading-relaxed max-w-xl">Bring accounts, deal stages and follow-up notes into one place. Explore the CRM with fictional sample data before requesting workspace access.</p>
            <a href="/sandbox" className="mt-8 inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl bg-[#d3fa76] hover:bg-[#bfe660] text-[#06080c] text-sm font-bold transition-colors">
              Try the demo <ArrowRight size={18} aria-hidden="true" />
            </a>
            <p className="mt-3 text-sm text-slate-400">No sign-in or credit card required.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="p-4 rounded-2xl bg-[#0b0f17] border border-white/10">
              <BarChart3 size={20} className="text-[#d3fa76] mb-3" aria-hidden="true" />
              <h2 className="text-sm font-bold mb-2">Manage sample deals</h2>
              <p className="text-sm text-slate-300 leading-relaxed">Review accounts, move deals and see the pipeline totals update.</p>
            </div>
            <div className="p-4 rounded-2xl bg-[#0b0f17] border border-white/10">
              <PhoneCall size={20} className="text-[#d3fa76] mb-3" aria-hidden="true" />
              <h2 className="text-sm font-bold mb-2">Simulate a call</h2>
              <p className="text-sm text-slate-300 leading-relaxed">Practice logging an outcome. No real call is placed or audio recorded.</p>
            </div>
            <div className="p-4 rounded-2xl bg-[#0b0f17] border border-white/10">
              <Layers size={20} className="text-[#d3fa76] mb-3" aria-hidden="true" />
              <h2 className="text-sm font-bold mb-2">Preview modules</h2>
              <p className="text-sm text-slate-300 leading-relaxed">Voice, SMS, WhatsApp, speech AI and external sync are placeholders, not connected services.</p>
            </div>
          </div>
          <p className="mt-8 text-sm text-slate-400 leading-relaxed">Demo changes stay in this browser. Reset the sample data whenever you want a fresh start.</p>
        </section>
        <section id="access-options" tabIndex={-1} aria-labelledby="access-heading" className="bg-[#0b0f17] px-6 py-10 sm:p-12 lg:p-14 flex flex-col justify-center">
          <div className="max-w-md mx-auto w-full space-y-7">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#d3fa76] mb-3">Workspace access</p>
              <h2 id="access-heading" className="text-2xl sm:text-3xl font-bold tracking-tight">Start with a closer look.</h2>
              <p className="mt-3 text-base text-slate-300 leading-relaxed">The public demo is open to everyone. Workspace access is arranged separately; this page does not accept sign-in credentials.</p>
            </div>
            <div className="p-6 rounded-2xl border border-[#d3fa76]/30 bg-[#d3fa76]/5 space-y-4">
              <h3 className="text-lg font-bold">Explore the sample workspace</h3>
              <p className="text-sm text-slate-300 leading-relaxed">Try the account list, pipeline, notes and analytics. Calls are simulated, and no external provider is connected.</p>
              <a href="/sandbox" className="w-full px-5 py-3.5 rounded-xl bg-[#d3fa76] hover:bg-[#bfe660] text-[#06080c] text-sm font-bold transition-colors inline-flex items-center justify-center gap-2">
                Open demo <ArrowRight size={18} aria-hidden="true" />
              </a>
            </div>
            <div className="p-6 rounded-2xl border border-white/10 space-y-4">
              <h3 className="text-lg font-bold">Discuss your team's needs</h3>
              <p className="text-sm text-slate-300 leading-relaxed">Request early access and tell us about your workflow. The request form opens on the Alternate CRM website.</p>
              <a href="https://alternatecrm.com/?request-access=1" className="w-full px-5 py-3.5 rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 text-sm font-bold transition-colors inline-flex items-center justify-center gap-2">
                Request early access <ExternalLink size={16} aria-hidden="true" />
              </a>
            </div>
            <p className="text-sm text-slate-400">Release v14.4.0 · Sample-data demo</p>
          </div>
        </section>
      </div>
    </main>
  );
}
