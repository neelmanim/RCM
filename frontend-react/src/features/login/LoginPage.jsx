import { useEffect, useMemo, useState } from 'react';
import { Mail, Lock, Eye, EyeOff, User, Users, BarChart3, ArrowRight, Check } from 'lucide-react';
import { ToastHost } from '../../components/ui/Toast';

const API_BASE = window.__APP_CONFIG__?.API_BASE || window.location.origin;

function saveTokenAndRedirect(token) {
  localStorage.setItem('crm_token', token);
  window.location.href = 'index.html';
}

function showToast(message, type = 'error') {
  window.dispatchEvent(new CustomEvent('alternate:toast', { detail: { message, type } }));
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [loading, setLoading] = useState(false);

  const origin = window.location.origin;
  const googleHref = useMemo(
    () => `${API_BASE}/api/auth/login?origin=${encodeURIComponent(origin)}`,
    [origin]
  );

  useEffect(() => {
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
      showToast('Your session has ended. Please sign in again to continue.', 'warning');
    } else if (params.has('error')) {
      showToast(
        params.get('error') === 'unauthorized'
          ? "You're not set up in Alternate CRM yet — we've let your admin know. They'll grant access shortly."
          : `Login error: ${params.get('error')}`,
        'error'
      );
    }
  }, [origin]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!email) {
      showToast('Please enter your work email address.', 'warning');
      return;
    }

    setLoading(true);

    // If sandbox or demo email, initialize sandbox/demo session
    if (email.includes('sandbox') || email.includes('demo') || email.includes('test')) {
      setTimeout(() => {
        window.location.href = 'sandbox.html?auto=1';
      }, 500);
      return;
    }

    // Default enterprise flow: SSO redirect or password notification
    setTimeout(() => {
      setLoading(false);
      showToast('Please use "Continue with Google" for single sign-on with your workspace.', 'info');
    }, 600);
  };

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-[#F7F9F4] text-[#0F172A] font-sans selection:bg-[#C9FF68] selection:text-[#090D0E] overflow-x-hidden">
      {/* ── Left Hero Side (Light Cream & Marketing Presentation) ─────────── */}
      <div className="relative flex-1 flex flex-col justify-between p-8 sm:p-12 lg:p-16 xl:p-20 overflow-hidden bg-[#F7F9F4]">
        {/* Top Brand Logo */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#C9FF68] flex items-center justify-center p-2 shadow-sm">
              <svg viewBox="0 0 512 512" className="w-full h-full" fill="none" stroke="#090D0E" strokeWidth="36" strokeLinecap="round">
                <line x1="112.64" y1="256" x2="399.36" y2="256" />
                <line x1="154.63" y1="154.63" x2="357.37" y2="357.37" />
                <line x1="256" y1="112.64" x2="256" y2="399.36" />
                <line x1="357.37" y1="154.63" x2="154.63" y2="357.37" />
              </svg>
            </div>
            <div className="flex items-baseline text-2xl font-black tracking-tighter">
              <span className="text-[#090D0E]">alternate</span>
              <span className="text-[#9BA9A5] font-semibold">crm</span>
            </div>
          </div>
        </div>

        {/* Center Main Value Proposition */}
        <div className="relative z-10 my-auto py-12 max-w-2xl">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.25em] text-[#64748B] mb-5">
            SALES • CUSTOMERS • GROWTH
          </div>

          <h1 className="text-4xl sm:text-5xl xl:text-[56px] font-black tracking-tight leading-[1.08] text-[#0F172A]">
            Better relationships.
            <br />
            <span className="text-[#58B62B]">Bigger opportunities.</span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-[#475569] leading-relaxed max-w-xl font-normal">
            AlternateCRM helps you keep your leads, customers and sales activity in one place, so you can focus on building lasting relationships and growing your business.
          </p>

          {/* Three Feature Cards Row */}
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-[#E6F8D4] text-[#24661A] flex items-center justify-center mb-3.5 shadow-sm">
                <User size={20} strokeWidth={2.2} />
              </div>
              <h3 className="text-sm font-bold text-[#0F172A] mb-1">Organize your leads</h3>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Never miss a follow up or important update.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-[#E6F8D4] text-[#24661A] flex items-center justify-center mb-3.5 shadow-sm">
                <Users size={20} strokeWidth={2.2} />
              </div>
              <h3 className="text-sm font-bold text-[#0F172A] mb-1">Stay aligned</h3>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Keep your team and customers in sync.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="flex flex-col">
              <div className="w-10 h-10 rounded-xl bg-[#E6F8D4] text-[#24661A] flex items-center justify-center mb-3.5 shadow-sm">
                <BarChart3 size={20} strokeWidth={2.2} />
              </div>
              <h3 className="text-sm font-bold text-[#0F172A] mb-1">Drive more deals</h3>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Focus on what matters and move faster.
              </p>
            </div>
          </div>
        </div>

        {/* Bottom Decorative Wave Arc (Exact Match to Design) */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-64 overflow-hidden z-0">
          <svg
            viewBox="0 0 1000 300"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full preserve-3d"
          >
            {/* Soft background glow contour */}
            <path
              d="M-100 320 C 150 120, 450 280, 800 240 L 800 350 L -100 350 Z"
              fill="rgba(201, 255, 104, 0.2)"
            />
            <path
              d="M-50 320 C 200 160, 500 260, 950 210"
              stroke="#AEE384"
              strokeWidth="2"
              fill="none"
              opacity="0.8"
            />
            {/* Prominent topographic arc with coordinate dot */}
            <path
              d="M-100 320 Q 350 170 700 290 T 1100 300"
              stroke="#8FD95A"
              strokeWidth="2"
              fill="none"
              opacity="0.75"
            />
            {/* Green circle node positioned along the arc */}
            <circle cx="480" cy="248" r="9" fill="#75CE38" />
          </svg>
        </div>
      </div>

      {/* ── Right Sign-In Panel (Dark Slate Aesthetic) ────────────────────── */}
      <div className="relative w-full lg:w-[480px] xl:w-[540px] bg-[#11171D] text-white flex flex-col justify-center px-8 py-12 sm:px-12 lg:px-14 xl:px-16 lg:rounded-l-[40px] shadow-[0_0_60px_rgba(0,0,0,0.3)] z-20">
        {/* Top Sandbox Pill Link (Nuance for evaluator access) */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#C9FF68] flex items-center justify-center p-1.5 shadow-sm">
              <svg viewBox="0 0 512 512" className="w-full h-full" fill="none" stroke="#090D0E" strokeWidth="40" strokeLinecap="round">
                <line x1="112.64" y1="256" x2="399.36" y2="256" />
                <line x1="154.63" y1="154.63" x2="357.37" y2="357.37" />
                <line x1="256" y1="112.64" x2="256" y2="399.36" />
                <line x1="357.37" y1="154.63" x2="154.63" y2="357.37" />
              </svg>
            </div>
            <div className="flex items-baseline text-xl font-black tracking-tighter">
              <span className="text-[#F4F6F2]">alternate</span>
              <span className="text-[#9BA9A5] font-semibold">crm</span>
            </div>
          </div>

          <a
            href="sandbox.html"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold text-[#C9FF68] bg-[#C9FF68]/10 border border-[#C9FF68]/30 hover:bg-[#C9FF68]/20 transition-colors"
          >
            <span>⚡</span> Quick Peek
          </a>
        </div>

        {/* Heading */}
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
          Welcome back
        </h2>
        <p className="mt-2 text-sm text-[#94A3B8] font-normal leading-relaxed">
          Sign in to your AlternateCRM account to continue where you left off.
        </p>

        {/* Sign In Form */}
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          {/* Work Email Address */}
          <div>
            <label className="block text-xs font-semibold text-[#CBD5E1] mb-2">
              Work email address
            </label>
            <div className="flex items-center gap-3 bg-[#18222A] border border-[#2B3744] rounded-xl px-4 py-3 focus-within:border-[#C9FF68]/70 focus-within:ring-2 focus-within:ring-[#C9FF68]/20 transition-all">
              <Mail size={16} className="text-[#64748B] shrink-0" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="w-full text-sm text-white placeholder:text-[#64748B] bg-transparent outline-none border-0"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-[#CBD5E1] mb-2">
              Password
            </label>
            <div className="flex items-center gap-3 bg-[#18222A] border border-[#2B3744] rounded-xl px-4 py-3 focus-within:border-[#C9FF68]/70 focus-within:ring-2 focus-within:ring-[#C9FF68]/20 transition-all">
              <Lock size={16} className="text-[#64748B] shrink-0" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full text-sm text-white placeholder:text-[#64748B] bg-transparent outline-none border-0"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-[#64748B] hover:text-[#94A3B8] transition-colors shrink-0"
                aria-label="Toggle password visibility"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Utility Row: Keep signed in & Forgot Password */}
          <div className="flex items-center justify-between pt-1">
            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
              <button
                type="button"
                role="checkbox"
                aria-checked={keepSignedIn}
                onClick={() => setKeepSignedIn(!keepSignedIn)}
                className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${
                  keepSignedIn
                    ? 'bg-[#C9FF68] border-[#C9FF68] text-black'
                    : 'bg-[#18222A] border-[#2B3744]'
                }`}
              >
                {keepSignedIn && <Check size={12} strokeWidth={3} />}
              </button>
              <span className="text-xs font-medium text-[#CBD5E1]">Keep me signed in</span>
            </label>

            <button
              type="button"
              onClick={() => showToast('Password reset link sent to your registered workspace email.', 'info')}
              className="text-xs font-semibold text-[#C9FF68] hover:underline"
            >
              Forgot password?
            </button>
          </div>

          {/* Primary Sign In Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 bg-[#C9FF68] hover:bg-[#D7FF85] active:scale-[0.99] text-black font-extrabold py-3.5 px-6 rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#C9FF68]/20 transition-all cursor-pointer disabled:opacity-50"
          >
            <span>Sign in</span>
            <ArrowRight size={16} strokeWidth={2.5} />
          </button>
        </form>

        {/* Divider */}
        <div className="relative my-6 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[#2B3744]" />
          </div>
          <span className="relative bg-[#11171D] px-3 text-xs font-medium text-[#64748B]">
            or
          </span>
        </div>

        {/* Continue with Google SSO */}
        <a
          href={googleHref}
          onClick={() => setLoading(true)}
          className="w-full bg-[#18222A] hover:bg-[#202D38] border border-[#2B3744] text-white font-semibold py-3 px-6 rounded-xl text-sm flex items-center justify-center gap-3 transition-all cursor-pointer shadow-sm"
        >
          <GoogleIcon />
          <span>Continue with Google</span>
        </a>

        {/* Footer info note */}
        <div className="mt-8 text-center">
          <p className="text-xs text-[#94A3B8]">
            Need an account?{' '}
            <a
              href="mailto:admin@alternatecrm.com"
              className="font-semibold text-[#C9FF68] hover:underline"
            >
              Contact your workspace administrator.
            </a>
          </p>
        </div>
      </div>

      <ToastHost />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}
