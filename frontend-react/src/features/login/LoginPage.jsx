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
    <div className="min-h-screen bg-gradient-to-br from-[#1B1035] via-[#4C1D95] to-[#BE185D]">
      {/* Gradient lives on this full-bleed outer div so it always covers the
          whole viewport width. The two panels below are wrapped in their own
          centered, width-capped flex row — mx-auto + max-w on ONE container
          is a more reliably-responsive way to center a flex-1-plus-fixed-width
          pair than relying on justify-center against a flex-1 sibling's
          leftover space (which stayed uncentered at very wide viewports —
          the "not responsive" bug this replaces). */}
      <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col lg:flex-row">
      {/* ── Brand panel ─────────────────────────────────────────────── */}
      {/* Capped at lg:max-w-3xl so this panel can't stretch indefinitely
          on very wide/ultrawide monitors — without a cap its content stays
          left-padded while the rest of the panel is empty gradient, which
          reads as a rendering bug rather than a design choice. */}
      <div className="relative flex flex-col justify-center overflow-hidden px-8 py-10 lg:flex-1 lg:max-w-3xl lg:px-16 lg:py-16">
        <div
          className="pointer-events-none absolute -right-24 -top-48 h-[500px] w-[500px] rounded-full opacity-25"
          style={{ background: 'radial-gradient(circle, rgba(236,72,153,0.35) 0%, transparent 70%)' }}
        />
        {SPARKS.map((s) => (
          <span
            key={s.id}
            className="pointer-events-none absolute select-none"
            style={{
              left: s.left,
              top: s.top,
              fontSize: s.size,
              color: s.dim ? 'rgba(255,255,255,0.25)' : 'rgba(244,114,182,0.6)',
              animation: `login-float-spark ${s.duration}s ease-in-out ${s.delay}s infinite`,
            }}
          >
            {s.dim ? '·' : '✦'}
          </span>
        ))}

        <div className="relative z-10 mb-8 flex items-center gap-2.5 lg:mb-14">
          <img src="img/alternatecrm-logo.png" alt="Alternate CRM" className="h-9 w-9 rounded-[10px] object-cover shadow-lg" />
          <div className="flex flex-col leading-tight">
            <span className="text-lg font-bold text-white">Alternate CRM</span>
            <span className="text-[11px] font-medium text-white/60">{window.__POWERED_BY__ || 'Powered by Alternate Messenger'}</span>
          </div>
        </div>

        <span className="relative z-10 mb-4 inline-flex w-fit items-center rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white/70 ring-1 ring-white/15">
          From Leads to Revenue
        </span>
        <h1 className="relative z-10 mb-5 max-w-lg text-3xl font-extrabold leading-[1.1] tracking-tight text-white [text-wrap:balance] lg:text-[2.75rem]">
          Where raw leads become{' '}
          <span className="bg-gradient-to-r from-amber-300 to-pink-400 bg-clip-text text-transparent">
            Salesforce-ready pipeline.
          </span>
        </h1>
        <p className="relative z-10 mb-8 max-w-md text-[15px] leading-relaxed text-white/65 lg:mb-10">
          Enrich, deduplicate, and qualify every lead here — then push the sales-ready result straight into
          Salesforce, so your team never works from a half-formed record.
        </p>

        <div className="relative z-10 mb-10 hidden lg:mb-0 lg:flex lg:items-end lg:gap-8">
          <div className="hidden shrink-0 lg:block">
            <ProductPreviewMock />
            <p
              className="mt-4 -rotate-2 text-2xl text-pink-200"
              style={{ fontFamily: "'Caveat', cursive" }}
            >
              Continuous improvement<br />is better than delayed perfection.
              <svg width="150" height="14" viewBox="0 0 150 14" className="mt-0.5 text-pink-300" fill="none">
                <path d="M2 8C30 2 60 12 90 6C110 2 130 8 148 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </p>
          </div>
        </div>

        <div className="relative z-10 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:mt-10">
          {FEATURES.map(({ icon: Icon, color, title, desc }, i) => {
            const isEgg = i === FEATURES.length - 1;
            return (
              <div key={title} className="flex items-start gap-3 rounded-xl bg-white/[0.06] p-3.5 ring-1 ring-white/10 backdrop-blur">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${color}`}
                  style={isEgg ? { userSelect: 'none', touchAction: 'manipulation' } : undefined}
                  onClick={isEgg ? handleEggClick : undefined}
                >
                  {isEgg && eggFlipped
                    ? <span className="text-[17px] leading-none text-white">{'\uD83D\uDD31'}</span>
                    : <Icon size={17} className="text-white" strokeWidth={2.25} />}
                </span>
                <div>
                  <p className="text-[13px] font-bold text-white">{title}</p>
                  <p className="text-[11px] leading-snug text-white/45">{desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Login panel ──────────────────────────────────────────────── */}
      {/* lg:sticky + lg:h-screen: without this, this panel's height (and
          therefore where its vertically-centered content lands) is set by
          flexbox stretch to match the brand panel's content height — which
          grows with viewport width/font rendering and can exceed a laptop's
          shorter browser window, silently centering the sign-in button
          below the fold with no scroll indicator. Pinning this panel to the
          real viewport height keeps the button reliably visible regardless
          of how tall the brand panel's content gets. */}
      <div className="flex w-full flex-1 shrink-0 flex-col justify-center bg-[#FDFCFB] px-6 py-10 sm:px-10 lg:sticky lg:top-0 lg:h-screen lg:w-[440px] lg:flex-none lg:px-12">
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <img src="img/alternatecrm-logo.png" alt="Alternate CRM" className="h-9 w-9 rounded-[10px] object-cover" />
          <span className="text-lg font-bold text-slate-900">Alternate CRM</span>
        </div>

        <h2 className="mb-2 text-2xl font-bold tracking-tight text-slate-900">Welcome back</h2>
        <p className="mb-8 text-sm text-slate-500">Sign in to your Alternate CRM account</p>

        <a
          href={googleHref}
          onClick={() => setLoading(true)}
          className="flex items-center justify-center gap-3.5 rounded-xl border-2 border-slate-200 bg-white px-6 py-4 text-sm font-semibold text-slate-900 shadow-sm transition-all hover:-translate-y-px hover:border-violet-400 hover:bg-violet-50/40 hover:shadow-md"
        >
          <GoogleIcon />
          Continue with Google
        </a>

        {/* ponytail: no separate "request access" form — access is only ever
            granted from inside Alternate CRM (Team & Access), so there's nothing
            for a self-service form to submit to. Signing in with Google IS
            the request: auth_routes.py records it and notifies Super Admins
            the first time an unrecognized email tries, and the toast below
            (params.get('error') === 'unauthorized') already tells the
            person that's what just happened. */}
        <p className="mt-5 text-center text-xs text-slate-400">
          New to Alternate CRM? Just sign in above — we'll let your admin know.
        </p>

        <p className="mt-8 text-center text-xs leading-relaxed text-slate-400">
          By signing in, you agree to our{' '}
          <a href="terms.html" className="font-medium text-slate-500 underline hover:text-violet-600">Terms of Use</a>{' '}
          and{' '}
          <a href="privacy.html" className="font-medium text-slate-500 underline hover:text-violet-600">Privacy Policy</a>.
        </p>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
          <Lock size={11} className="shrink-0" />
          Your data is secure and synced with Salesforce
        </p>
      </div>
      </div>

      {loading && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-[#0f172a]/70 backdrop-blur-sm">
          <BrandLoader />
          <p className="text-sm font-medium text-white">Wait for it… the bots are working.</p>
        </div>
      )}

      <ToastHost />
    </div>
  );
}

function BrandLoader() {
  return (
    <div className="relative h-[76px] w-[76px]">
      <div
        className="login-loader-ring absolute inset-0 rounded-full"
        style={{
          background: 'conic-gradient(from 0deg, transparent 0deg, transparent 255deg, #7C3AED 300deg, #EC4899 360deg)',
          WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
          mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
          animation: 'login-orbit-spin 1.4s linear infinite',
        }}
      />
      <span
        className="login-loader-spark absolute -inset-2 flex items-start justify-center text-[13px] text-fuchsia-400"
        style={{ animation: 'login-orbit-spin 1.4s linear infinite', textShadow: '0 0 8px rgba(232,121,249,0.9), 0 0 2px #fff' }}
      >
        ✦
      </span>
      <img
        src="img/alternatecrm-logo.png"
        alt=""
        className="absolute inset-4 h-11 w-11 rounded-xl object-cover shadow-[0_4px_20px_rgba(124,58,237,0.45)]"
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
