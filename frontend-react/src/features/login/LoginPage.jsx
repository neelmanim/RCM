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
    <div className="relative min-h-screen bg-[#090D0E] text-[#F4F6F2] selection:bg-[#C9FF68] selection:text-[#090D0E] flex flex-col justify-between overflow-x-hidden font-sans">
      {/* Background Ambient Glows */}
      <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 h-[500px] w-full max-w-7xl overflow-hidden opacity-30">
        <div className="absolute left-1/2 top-[-200px] -translate-x-1/2 h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,#C9FF68_0%,transparent_70%)] blur-[100px] opacity-20" />
      </div>

      {/* ── Top Header Navigation ───────────────────────────────────────── */}
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 sm:px-8">
        <a href="https://alternatecrm.com" className="flex items-center gap-3 text-decoration-none group">
          <img
            src="img/brand/icon-lime.svg"
            alt="Alternate CRM"
            className="h-9 w-9 rounded-xl object-contain p-1.5 bg-[#151C1E] border border-white/10 shadow-sm transition-transform group-hover:scale-105"
          />
          <div className="flex flex-col">
            <span className="text-base font-extrabold tracking-tight text-[#F4F6F2]">Alternate CRM</span>
            <span className="text-[10px] font-semibold text-[#9BA9A5]">{window.__POWERED_BY__ || 'Enterprise Conversation OS'}</span>
          </div>
        </a>

        <a
          href="sandbox.html"
          className="inline-flex items-center gap-2 rounded-xl border border-[#C9FF68]/40 bg-[#C9FF68]/10 px-4 py-2 text-xs font-bold text-[#C9FF68] transition-all hover:bg-[#C9FF68]/20 hover:border-[#C9FF68]/60 shadow-sm"
        >
          <span>⚡</span> Live Sandbox
        </a>
      </header>

      {/* ── Center Hero & Sign-In Card (Gluestack UI) ────────────────────── */}
      <main className="relative z-10 mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-8">
        {/* Badge */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#C9FF68]/25 bg-[#C9FF68]/10 px-3.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#C9FF68]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#C9FF68] animate-ping" />
          Enterprise Workspace Access
        </div>

        {/* Title & Tagline */}
        <h1 className="mb-3 text-center text-3xl font-extrabold tracking-tight text-[#F4F6F2] sm:text-4xl">
          Sign in to your workspace
        </h1>
        <p className="mb-8 max-w-md text-center text-sm font-medium leading-relaxed text-[#9BA9A5]">
          Enrich raw prospects, orchestrate real-time communications, and push qualified pipeline directly into Salesforce.
        </p>

        {/* Gluestack Elevation Card */}
        <div className="w-full rounded-2xl border border-white/10 bg-[#12181A]/90 p-8 shadow-[0_24px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
          <div className="space-y-4">
            <a
              href={googleHref}
              onClick={() => setLoading(true)}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/20 bg-[#F4F6F2] px-6 py-3.5 text-sm font-bold text-[#090D0E] shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:bg-white hover:shadow-md active:translate-y-0"
            >
              <GoogleIcon />
              Continue with Google Workspace
            </a>

            <div className="relative my-4 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <span className="relative bg-[#12181A] px-3 text-[11px] font-semibold uppercase tracking-wider text-[#9BA9A5]">
                Instant Evaluator Access
              </span>
            </div>

            <a
              href="sandbox.html"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#C9FF68]/30 bg-[#C9FF68]/10 px-6 py-3.5 text-sm font-bold text-[#C9FF68] transition-all duration-150 hover:bg-[#C9FF68]/20 hover:border-[#C9FF68]/50"
            >
              <span>⚡</span> Launch Interactive Sandbox / Quick Peek
            </a>
          </div>

          <div className="mt-7 border-t border-white/5 pt-5 text-center">
            <p className="text-xs text-[#9BA9A5]">
              New to Alternate CRM? Single sign-on will notify your organization administrator to grant role privileges.
            </p>
          </div>
        </div>

        {/* Features Row */}
        <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-left transition-colors hover:border-white/10"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#C9FF68]/10 text-[#C9FF68]">
                <Icon size={16} strokeWidth={2.2} />
              </div>
              <div>
                <p className="text-xs font-bold text-[#F4F6F2]">{title}</p>
                <p className="text-[10px] text-[#9BA9A5] line-clamp-1">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5 text-xs text-[#9BA9A5]">
        <div className="flex items-center gap-2">
          <Lock size={12} className="text-[#C9FF68]" />
          <span>SOC2 Type II & HIPAA compliant architecture</span>
        </div>
        <div>
          <span>Alternate CRM © {new Date().getFullYear()}</span>
        </div>
      </footer>

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
