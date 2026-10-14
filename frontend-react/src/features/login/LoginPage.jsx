import { useEffect, useMemo, useState } from 'react';
import { Database, Users, Zap, Lock } from 'lucide-react';
import { ProductPreviewMock } from './ProductPreviewMock';
import { ToastHost } from '../../components/ui/Toast';

const API_BASE = window.__APP_CONFIG__?.API_BASE || window.location.origin;

const FEATURES = [
  { icon: Database, color: 'bg-violet-600', title: 'Lead Enrichment', desc: 'Company intelligence on every lead' },
  { icon: Users, color: 'bg-teal-600', title: 'Smart Deduplication', desc: 'Automatically detect and remove duplicates' },
  { icon: Zap, color: 'bg-amber-500', title: 'Sales-Ready Handoff', desc: 'Refined leads flow straight into Salesforce' },
];

const SPARKS = Array.from({ length: 16 }, (_, i) => ({
  id: i,
  left: `${Math.random() * 90 + 5}%`,
  top: `${Math.random() * 90 + 5}%`,
  size: 10 + Math.random() * 12,
  delay: Math.random() * 6,
  duration: 4 + Math.random() * 4,
  dim: Math.random() > 0.5,
}));

function saveTokenAndRedirect(token) {
  localStorage.setItem('crm_token', token);
  window.location.href = 'index.html';
}

function showToast(message) {
  window.dispatchEvent(new CustomEvent('alternate:toast', { detail: { message, type: 'error' } }));
}

export function LoginPage() {
  const [loading, setLoading] = useState(false);

  const [eggClicks, setEggClicks] = useState(0);
  const [eggFlipped, setEggFlipped] = useState(false);
  const handleEggClick = () => {
    if (eggFlipped) return;
    const next = eggClicks + 1;
    if (next >= 5) {
      setEggFlipped(true);
      setEggClicks(0);
      setTimeout(() => setEggFlipped(false), 1000);
    } else {
      setEggClicks(next);
    }
  };

  const origin = window.location.origin;
  const googleHref = useMemo(
    () => `${API_BASE}/api/auth/login?origin=${encodeURIComponent(origin)}`,
    [origin]
  );

  useEffect(() => {
    // Safety net for the redirect-back-from-Google flow (below): if the
    // backend somehow sends the token to the wrong same-origin frontend,
    // this lets that page detect it and forward the token onward.
    sessionStorage.setItem('crm_login_origin', origin);

    const params = new URLSearchParams(window.location.search);
    if (params.has('token')) {
      const savedOrigin = sessionStorage.getItem('crm_login_origin');
      sessionStorage.removeItem('crm_login_origin');
      const token = params.get('token');
      if (savedOrigin && savedOrigin !== window.location.origin) {
        window.location.href = `${savedOrigin}/login.html?token=${token}`;
      } else {
        saveTokenAndRedirect(token);
      }
    } else if (params.has('expired')) {
      showToast('Your session has ended. Please sign in again to continue.');
    } else if (params.has('error')) {
      showToast(
        params.get('error') === 'unauthorized'
          ? "You're not set up in Alternate CRM yet — we've let your admin know. They'll grant access shortly."
          : `Login error: ${params.get('error')}`
      );
    }

  }, [origin]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0B0F19] via-[#111827] to-[#1E1B4B] text-slate-100 selection:bg-[#d3fa76] selection:text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col lg:flex-row">
        {/* ── Brand panel (Gluestack UI inspired) ───────────────────────── */}
        <div className="relative flex flex-col justify-center overflow-hidden px-8 py-10 lg:flex-1 lg:max-w-3xl lg:px-16 lg:py-16">
          <div
            className="pointer-events-none absolute -right-24 -top-48 h-[520px] w-[520px] rounded-full opacity-20"
            style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.4) 0%, transparent 70%)' }}
          />
          {SPARKS.map((s) => (
            <span
              key={s.id}
              className="pointer-events-none absolute select-none"
              style={{
                left: s.left,
                top: s.top,
                fontSize: s.size,
                color: s.dim ? 'rgba(255,255,255,0.2)' : 'rgba(211,250,118,0.6)',
                animation: `login-float-spark ${s.duration}s ease-in-out ${s.delay}s infinite`,
              }}
            >
              {s.dim ? '·' : '✦'}
            </span>
          ))}

          <div className="relative z-10 mb-8 flex items-center gap-3 lg:mb-12">
            <img src="img/alternatecrm-logo.png" alt="Alternate CRM" className="h-10 w-10 rounded-xl object-cover shadow-lg ring-1 ring-white/10" />
            <div className="flex flex-col leading-tight">
              <span className="text-xl font-extrabold tracking-tight text-white">Alternate CRM</span>
              <span className="text-[11px] font-semibold text-slate-400">{window.__POWERED_BY__ || 'Powered by Alternate Messenger'}</span>
            </div>
          </div>

          <span className="relative z-10 mb-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-500/10 px-3.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#d3fa76] ring-1 ring-[#d3fa76]/20">
            <span>⚡</span> Commercial Conversation OS
          </span>

          <h1 className="relative z-10 mb-5 max-w-lg text-3xl font-extrabold leading-[1.12] tracking-tight text-white lg:text-[2.75rem]">
            Where raw leads become{' '}
            <span className="bg-gradient-to-r from-[#d3fa76] via-teal-300 to-indigo-400 bg-clip-text text-transparent">
              Salesforce-ready pipeline.
            </span>
          </h1>
          <p className="relative z-10 mb-8 max-w-md text-[15px] leading-relaxed text-slate-300 lg:mb-10">
            Enrich, deduplicate, and qualify every lead in real time. Orchestrate multi-channel outreach and push clean, sales-ready records directly into Salesforce.
          </p>

          <div className="relative z-10 mb-10 hidden lg:mb-0 lg:flex lg:items-end lg:gap-8">
            <div className="hidden shrink-0 lg:block">
              <ProductPreviewMock />
            </div>
          </div>

          <div className="relative z-10 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:mt-10">
            {FEATURES.map(({ icon: Icon, color, title, desc }, i) => {
              const isEgg = i === FEATURES.length - 1;
              return (
                <div key={title} className="flex items-start gap-3 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10 backdrop-blur-md transition-all hover:bg-white/[0.07] hover:ring-white/20">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${color} shadow-sm`}
                    style={isEgg ? { userSelect: 'none', touchAction: 'manipulation' } : undefined}
                    onClick={isEgg ? handleEggClick : undefined}
                  >
                    {isEgg && eggFlipped
                      ? <span className="text-[17px] leading-none text-white">{'\uD83D\uDD31'}</span>
                      : <Icon size={17} className="text-white" strokeWidth={2.25} />}
                  </span>
                  <div>
                    <p className="text-[13px] font-bold text-white">{title}</p>
                    <p className="text-[11px] leading-snug text-slate-400 mt-0.5">{desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Modern Gluestack Sign-In Panel ───────────────────────────── */}
        <div className="flex w-full flex-1 shrink-0 flex-col justify-center bg-[#0e1420]/90 px-6 py-10 sm:px-10 lg:sticky lg:top-0 lg:h-screen lg:w-[460px] lg:flex-none lg:px-12 border-l border-white/[0.06] backdrop-blur-2xl">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <img src="img/alternatecrm-logo.png" alt="Alternate CRM" className="h-9 w-9 rounded-xl object-cover" />
            <span className="text-lg font-bold text-white">Alternate CRM</span>
          </div>

          <div className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-7 shadow-2xl">
            <h2 className="mb-1.5 text-2xl font-extrabold tracking-tight text-white">Welcome back</h2>
            <p className="mb-6 text-sm text-slate-400">Sign in to your Alternate CRM workspace</p>

            <a
              href={googleHref}
              onClick={() => setLoading(true)}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white text-slate-900 px-6 py-3.5 text-sm font-bold shadow-md transition-all duration-150 hover:-translate-y-0.5 hover:bg-slate-100 hover:shadow-lg active:translate-y-0"
            >
              <GoogleIcon />
              Continue with Google
            </a>

            <div className="relative my-6 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <span className="relative bg-[#101726] px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Or explore live
              </span>
            </div>

            <a
              href="sandbox.html"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#d3fa76]/30 bg-[#d3fa76]/10 px-6 py-3 text-sm font-bold text-[#d3fa76] transition-all duration-150 hover:bg-[#d3fa76]/20 hover:border-[#d3fa76]/50"
            >
              <span>⚡</span> Try Live Sandbox / Quick Peek
            </a>

            <p className="mt-5 text-center text-xs text-slate-400">
              New to Alternate CRM? Just sign in above — we'll let your admin know.
            </p>
          </div>

          <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
            <Lock size={12} className="shrink-0 text-slate-400" />
            Enterprise grade security · Synced with Salesforce
          </p>
        </div>
      </div>

      {loading && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-[#090D0E]/85 backdrop-blur-xl">
          <BrandLoader />
          <div className="flex flex-col items-center gap-1.5 text-center">
            <p className="text-base font-bold text-white tracking-tight">Authenticating workspace credentials…</p>
            <p className="text-xs font-medium text-[#9BA9A5]">Securing session tokens & establishing enterprise handshake</p>
          </div>
        </div>
      )}

      <ToastHost />
    </div>
  );
}

function BrandLoader() {
  return (
    <div className="relative flex h-20 w-20 items-center justify-center">
      {/* Outer pulsing ring in brand lime */}
      <div className="absolute inset-0 rounded-2xl bg-[#C9FF68]/15 animate-ping opacity-30" />
      {/* Gluestack styled glass card for brand symbol */}
      <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-[#C9FF68]/30 bg-[#090D0E] shadow-[0_0_30px_rgba(201,255,104,0.25)]">
        <img
          src="img/brand/icon-lime.svg"
          alt="Alternate CRM"
          className="h-9 w-9 object-contain animate-pulse"
        />
      </div>
      {/* Circular orbiting spinner ring */}
      <div
        className="absolute -inset-1.5 rounded-2xl border-2 border-transparent border-t-[#C9FF68] border-r-[#C9FF68]/40"
        style={{ animation: 'spin 1.2s cubic-bezier(0.55, 0.25, 0.25, 0.95) infinite' }}
      />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}
