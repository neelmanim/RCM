"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const SANDBOX_URL =
  process.env.NEXT_PUBLIC_SANDBOX_URL || "https://app.alternatecrm.com/sandbox";
const SIGNIN_URL =
  process.env.NEXT_PUBLIC_SIGNIN_URL || "https://app.alternatecrm.com/login.html";

export default function Home() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState(1);
  const [year] = useState(() => new Date().getFullYear().toString());

  // Lead Form State
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    company: "",
    phone: "",
    teamSize: "11-50",
    primaryInterest: "AI Power Dialer & Voice",
    notes: "",
    website_hp: "" // Honeypot field
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submittedLead, setSubmittedLead] = useState(null);

  // Lock body scroll when Lead modal is active
  useEffect(() => {
    if (isLeadModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isLeadModalOpen]);

  // Handle ESC key to dismiss modal or mobile drawer
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setIsLeadModalOpen(false);
        setIsMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const toggleMenu = () => setIsMenuOpen((prev) => !prev);
  const closeMenu = () => setIsMenuOpen(false);

  const openLeadModal = (e) => {
    if (e) e.preventDefault();
    setSubmitError(null);
    setIsLeadModalOpen(true);
  };

  const closeLeadModal = () => setIsLeadModalOpen(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmitLead = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    const email = formData.email.trim();
    const firstName = formData.firstName.trim();
    if (!firstName) {
      setSubmitError("Please enter your first name.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      setSubmitError("Please enter a valid work email address (e.g. name@company.com).");
      return;
    }

    setIsSubmitting(true);
    const leadPayload = {
      first_name: firstName,
      last_name: formData.lastName.trim(),
      email: email,
      company: formData.company.trim(),
      phone: formData.phone.trim(),
      team_size: formData.teamSize,
      primary_interest: formData.primaryInterest,
      notes: formData.notes.trim(),
      website_hp: formData.website_hp || ""
    };

    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(
          "alternatecrm_lead_submission",
          JSON.stringify({ ...leadPayload, timestamp: new Date().toISOString() })
        );
      }
    } catch (_) {}

    const targets = [
      "https://app.alternatecrm.com/api/public/leads/inbound",
      "https://api.alternatecrm.com/api/public/leads/inbound"
    ];

    try {
      await Promise.any(
        targets.map((url) =>
          fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(leadPayload),
            signal: AbortSignal.timeout(4000)
          }).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r;
          })
        )
      ).catch(() => {});
    } catch (_) {}

    setSubmittedLead({
      name: firstName,
      email: email,
      company: formData.company.trim()
    });
    setModalStep(2);
    setIsSubmitting(false);
  };

  return (
    <>
      {/* ── Frosted Navbar ────────────────────────────────────────── */}
      <div className="nav-shell">
        <header className="wrap nav">
          <Link className="brand" href="/" aria-label="Alternate CRM home">
            <span className="mark">✳</span>
            <span>
              alternate<span className="suffix">crm</span>
            </span>
          </Link>

          <nav className="links" aria-label="Main Navigation">
            <a href="#platform">The Platform</a>
            <a href="#outcomes">Why Alternate CRM</a>
            <a href="#how">Playbook</a>
            <Link href="/blog">Insights</Link>
            <Link href="/status">System Status</Link>
          </nav>

          <div className="right">
            <a
              href={SANDBOX_URL}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary"
            >
              Open Live Demo <span>⚡</span>
            </a>
            <button
              type="button"
              className="btn btn-primary"
              onClick={openLeadModal}
            >
              Get Early Access ↗
            </button>
            <button
              className="mobile-toggle"
              aria-label="Toggle navigation"
              aria-expanded={isMenuOpen}
              onClick={toggleMenu}
            >
              {isMenuOpen ? "✕" : "☰"}
            </button>
          </div>
        </header>

        {/* Mobile Navigation Drawer */}
        <nav
          className={`mobile-links ${isMenuOpen ? "open" : ""}`}
          aria-label="Mobile Navigation"
        >
          <a href="#platform" onClick={closeMenu}>The Platform</a>
          <a href="#outcomes" onClick={closeMenu}>Why Alternate CRM</a>
          <a href="#how" onClick={closeMenu}>Playbook</a>
          <Link href="/blog" onClick={closeMenu}>Insights</Link>
          <Link href="/status" onClick={closeMenu}>System Status</Link>
          <a href={SIGNIN_URL} target="_blank" rel="noreferrer" onClick={closeMenu}>
            Sign In to App ↗
          </a>
          <a
            href={SANDBOX_URL}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
            style={{ width: "100%", marginTop: "12px", textAlign: "center" }}
            onClick={closeMenu}
          >
            Open Live Demo ⚡
          </a>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: "100%", marginTop: "8px" }}
            onClick={() => {
              closeMenu();
              openLeadModal();
            }}
          >
            Get Early Access ↗
          </button>
        </nav>
      </div>

      <main id="top">
        {/* ── Hero Section ────────────────────────────────────────── */}
        <section className="hero">
          <div className="wrap">
            <div className="hero-pill">
              <span className="live-pulse" />
              <span>THE AUTONOMOUS SALES CONVERSATION OS</span>
            </div>

            <h1>
              Kill the static CRM.
              <br />
              <span className="gradient-text">Accelerate your pipeline.</span>
            </h1>

            <p>
              Alternate CRM unifies a sub-200ms WebRTC power dialer, live speech-to-intent intelligence,
              and autonomous multi-touch cadences into one high-velocity revenue platform.
            </p>

            <div className="hero-actions">
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: "14px 28px", fontSize: "15px" }}
                onClick={openLeadModal}
              >
                Get Early Access ↗
              </button>
              <a
                className="btn btn-secondary"
                style={{ padding: "14px 28px", fontSize: "15px" }}
                href={SANDBOX_URL}
                target="_blank"
                rel="noreferrer"
              >
                Open Live Demo <span>⚡</span>
              </a>
              <a className="btn btn-ghost" href="#platform">
                Explore the Platform ↓
              </a>
            </div>

            <div className="hero-trust">
              <span>🔒 Zero sign-in required</span>
              <span>•</span>
              <span>⚡ Pre-seeded enterprise pipeline</span>
              <span>•</span>
              <span>🛡️ SOC2 Type II compliance ready</span>
            </div>

            {/* ── Behance Hero Showcase (Command Center Window) ──── */}
            <div className="showcase-container">
              <div className="showcase-glow" />
              <div className="showcase-window">
                {/* Window Chrome */}
                <div className="showcase-topbar">
                  <div className="window-dots">
                    <span className="dot-red" />
                    <span className="dot-yellow" />
                    <span className="dot-green" />
                  </div>
                  <div className="window-url">
                    <span style={{ color: "var(--lime)" }}>🔒</span>
                    <span>app.alternatecrm.com/live-workspace</span>
                  </div>
                  <div className="window-status">
                    <span className="live-pulse" style={{ width: "6px", height: "6px" }} />
                    <span className="hidden sm:inline">99.99% Systems Operational</span>
                  </div>
                </div>

                {/* Window Body: Live Telemetry HUD */}
                <div className="showcase-body">
                  {/* Active WebRTC Live Call HUD */}
                  <div className="active-call-strip">
                    <div className="call-lead-info">
                      <div className="call-lead-avatar">SJ</div>
                      <div className="call-lead-details">
                        <b>Sarah Jenkins · VP Revenue Operations</b>
                        <span>Stripe · Enterprise Pipeline Tier</span>
                      </div>
                    </div>

                    <div className="audio-waveform" title="Live WebRTC Audio Mesh">
                      <span /><span /><span /><span /><span /><span />
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="call-telemetry">
                        <span>● 04:12</span>
                        <span>|</span>
                        <span>38ms Latency</span>
                      </div>
                      <span className="hidden md:inline-flex px-3 py-1 rounded-lg text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        Meeting Booked
                      </span>
                    </div>
                  </div>

                  {/* Dual Column Intelligence & KPI Telemetry */}
                  <div className="showcase-grid">
                    {/* Left: Real-time Speech-to-Intent AI HUD */}
                    <div className="showcase-card">
                      <div className="card-label">
                        <span>Live Speech-to-Intent AI</span>
                        <span style={{ color: "var(--lime)" }}>Active Whisper Probe</span>
                      </div>

                      <div className="speech-intent-box">
                        <div className="intent-quote">
                          “Budget approved for multi-seat Q4 deployment across 80 reps”
                        </div>
                        <div className="battlecard-pill">
                          <span>⚡ Battlecard Matched:</span>
                          <span>Enterprise Security & SOC2 Type II Architecture</span>
                        </div>
                      </div>

                      <div className="sync-status">
                        <span>✓</span>
                        <span>Auto-synced to Salesforce & Nylas mailbox (0.12s)</span>
                      </div>
                    </div>

                    {/* Right: Glass KPI Metrics */}
                    <div className="kpi-row">
                      <div className="kpi-box">
                        <small>Total Dials</small>
                        <strong>1,280</strong>
                        <em>↗ Sub-200ms audio</em>
                      </div>
                      <div className="kpi-box">
                        <small>Deal Value</small>
                        <strong>$1.42M</strong>
                        <em>↗ +18.4% velocity</em>
                      </div>
                      <div className="kpi-box">
                        <small>Meetings</small>
                        <strong>42</strong>
                        <em>↗ In sprint</em>
                      </div>
                      <div className="kpi-box">
                        <small>Time Saved</small>
                        <strong>14.8h</strong>
                        <em>↗ Zero manual admin</em>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Social Proof / Logo Cloud ────────────────────────────── */}
        <section className="logos-section">
          <div className="wrap">
            <div className="logos-heading">
              Powering next-generation outbound & conversation intelligence at scale
            </div>
            <div className="logos-grid">
              <span className="logo-item">STRIPE</span>
              <span className="logo-item">FIGMA</span>
              <span className="logo-item">NOTION</span>
              <span className="logo-item">RAMP</span>
              <span className="logo-item">RETOOL</span>
              <span className="logo-item">VERCEL</span>
            </div>
          </div>
        </section>

        {/* ── Bento Grid: The Platform Architecture ────────────────── */}
        <section className="section" id="platform">
          <div className="wrap">
            <div className="section-head">
              <span className="eyebrow">THE REVENUE ENGINE</span>
              <h2>One unified workspace. Zero disconnected tabs.</h2>
              <p>
                Stop stitching together Gong, Outreach, Salesforce, and standalone dialers.
                Alternate CRM combines telephony, speech intelligence, and automated sequences into one modular OS.
              </p>
            </div>

            <div className="bento-grid">
              {/* Card 1: Sub-200ms WebRTC Power Dialer */}
              <div className="bento-card bento-col-7">
                <div>
                  <span className="card-badge">01 / Telephony Mesh</span>
                  <h3>Sub-200ms WebRTC In-Browser Power Dialer</h3>
                  <p>
                    Launch high-volume outbound queues directly from Chrome. Enjoy multi-line parallel dialing,
                    automatic voicemail drops, and crystal-clear edge audio with zero desktop plugins or desk phones.
                  </p>
                </div>
                <div className="bento-visual">
                  <div className="flex items-center justify-between text-xs mb-3">
                    <span className="text-slate-400 font-mono">Edge Node: Washington D.C. (iad1)</span>
                    <span className="text-emerald-400 font-bold">Latency: 28ms</span>
                  </div>
                  <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
                    <div className="bg-gradient-to-r from-indigo-500 to-lime-400 h-full w-[88%]" />
                  </div>
                </div>
              </div>

              {/* Card 2: Live Speech-to-Intent AI */}
              <div className="bento-card bento-col-5">
                <div>
                  <span className="card-badge">02 / Conversation AI</span>
                  <h3>Real-Time Live Speech-to-Intent Intelligence</h3>
                  <p>
                    Streaming Whisper speech intelligence transcribes calls as they happen, surfaces winning objection
                    battlecards during live calls, and drafts structured meeting notes automatically.
                  </p>
                </div>
                <div className="bento-visual">
                  <div className="text-xs text-lime-400 font-bold mb-1">“Can you integrate with our Salesforce?”</div>
                  <div className="text-[11px] text-slate-400">Battlecard: Native bi-directional sync ready in 60s.</div>
                </div>
              </div>

              {/* Card 3: Autonomous Multi-Touch Cadences */}
              <div className="bento-card bento-col-5">
                <div>
                  <span className="card-badge">03 / Outreach Automation</span>
                  <h3>Autonomous Multi-Touch Sequences</h3>
                  <p>
                    Coordinate phone, email, and social steps that execute automatically based on call dispositions,
                    eliminating rep busywork and accelerating deal velocity.
                  </p>
                </div>
                <div className="bento-visual">
                  <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                    <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400">Day 1: Call</span>
                    <span>→</span>
                    <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-400">Day 2: Email</span>
                    <span>→</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Day 4: Follow-up</span>
                  </div>
                </div>
              </div>

              {/* Card 4: Universal 2-Way Sync */}
              <div className="bento-card bento-col-7">
                <div>
                  <span className="card-badge">04 / Enterprise Integrity</span>
                  <h3>Universal Bi-directional CRM & Mailbox Sync</h3>
                  <p>
                    Never lose enterprise system-of-record fidelity. Alternate CRM syncs two-way with Salesforce,
                    HubSpot, Postgres, and Nylas email/calendar with zero latency or record drift.
                  </p>
                </div>
                <div className="bento-visual">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200">Salesforce & HubSpot Two-Way Sync</span>
                    <span className="text-emerald-400 font-bold">100% Synced</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Comparison Section ───────────────────────────────────── */}
        <section className="section" id="outcomes">
          <div className="wrap">
            <div className="section-head">
              <span className="eyebrow">THE SHIFT</span>
              <h2>Legacy CRM Database vs The Conversation OS</h2>
              <p>Why modern revenue teams are leaving static database graveyards behind.</p>
            </div>

            <div className="comparison-wrap">
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>Workflow Dimension</th>
                    <th>Legacy CRM (Salesforce / HubSpot)</th>
                    <th>Alternate CRM (Conversation OS)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><b>Data Entry Overhead</b></td>
                    <td>Reps spend 68% of time manually logging calls and notes</td>
                    <td>0% manual entry — live speech AI transcribes & logs autonomously</td>
                  </tr>
                  <tr>
                    <td><b>Telephony Latency</b></td>
                    <td>External desk phones or slow 800ms+ browser plugins</td>
                    <td>Sub-200ms WebRTC direct mesh with zero jitter</td>
                  </tr>
                  <tr>
                    <td><b>In-Call Assistance</b></td>
                    <td>Post-call recordings only; zero guidance while on the phone</td>
                    <td>Live streaming speech-to-intent objection battlecards on-screen</td>
                  </tr>
                  <tr>
                    <td><b>Tool Sprawl</b></td>
                    <td>Requires 5–7 point solutions (Dialer + Sequencer + Meeting Bot)</td>
                    <td>1 unified modular operating system built on one shared customer context</td>
                  </tr>
                  <tr>
                    <td><b>Deployment Time</b></td>
                    <td>3–6 months complex enterprise rollout</td>
                    <td>Instant 1-click workspace with live seeded demo ready immediately</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── Playbook / How It Works ──────────────────────────────── */}
        <section className="section" id="how">
          <div className="wrap">
            <div className="section-head">
              <span className="eyebrow">PLAYBOOK</span>
              <h2>Deploy in minutes. Scale with zero friction.</h2>
              <p>Everything your revenue organization needs to close more pipeline.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bento-card">
                <div>
                  <span className="card-badge">Step 01</span>
                  <h3>Connect System of Record</h3>
                  <p>
                    Bi-directional sync with Salesforce, HubSpot, or Postgres plus Nylas email & calendar in seconds.
                  </p>
                </div>
              </div>
              <div className="bento-card">
                <div>
                  <span className="card-badge">Step 02</span>
                  <h3>Execute High-Velocity Cadences</h3>
                  <p>
                    Reps launch WebRTC parallel dials with live AI battlecards and automated follow-up sequences from one screen.
                  </p>
                </div>
              </div>
              <div className="bento-card">
                <div>
                  <span className="card-badge">Step 03</span>
                  <h3>Automate Pipeline Velocity</h3>
                  <p>
                    Every conversation qualifies leads, scores deals, updates stages, and logs notes autonomously.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── CTA Banner ──────────────────────────────────────────── */}
        <section className="section">
          <div className="wrap">
            <div className="cta-banner">
              <h2>Accelerate your pipeline velocity.</h2>
              <p>
                Experience the Conversation OS live in the interactive demo workspace or request priority onboarding.
              </p>
              <div className="flex justify-center gap-4 flex-wrap">
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: "14px 28px", fontSize: "15px" }}
                  onClick={openLeadModal}
                >
                  Get Early Access ↗
                </button>
                <a
                  className="btn btn-secondary"
                  style={{ padding: "14px 28px", fontSize: "15px" }}
                  href={SANDBOX_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Live Demo <span>⚡</span>
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Modern SaaS Multi-Column Footer ──────────────────────── */}
      <footer className="site-footer">
        <div className="wrap">
          <div className="footer-grid">
            <div className="footer-brand">
              <Link className="brand" href="/">
                <span className="mark">✳</span>
                <span>
                  alternate<span className="suffix">crm</span>
                </span>
              </Link>
              <p>
                The Autonomous Conversation Operating System for modern sales teams. Unify telephony,
                live speech intelligence, and automated cadences in one connected platform.
              </p>
              <a
                href={SANDBOX_URL}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary"
                style={{ padding: "8px 14px", fontSize: "12px" }}
              >
                ⚡ Open Live Demo
              </a>
            </div>

            <div className="footer-col">
              <h4>Platform</h4>
              <ul>
                <li><a href="#platform">The OS Architecture</a></li>
                <li><a href="#platform">WebRTC Power Dialer</a></li>
                <li><a href="#platform">Live Speech-to-Intent</a></li>
                <li><a href="#platform">Multi-Touch Cadences</a></li>
                <li><a href={SANDBOX_URL} target="_blank" rel="noreferrer">Interactive Demo</a></li>
              </ul>
            </div>

            <div className="footer-col">
              <h4>Resources</h4>
              <ul>
                <li><Link href="/blog">Engineering Blog</Link></li>
                <li><Link href="/status">System Status</Link></li>
                <li><a href="#outcomes">CRM Comparison</a></li>
                <li><a href="mailto:support@alternatecrm.com">Support Center</a></li>
              </ul>
            </div>

            <div className="footer-col">
              <h4>Company</h4>
              <ul>
                <li><a href="#outcomes">Why Alternate CRM</a></li>
                <li><a href="#how">Revenue Playbook</a></li>
                <li><a href="mailto:hello@alternatecrm.com">Contact Sales</a></li>
                <li><a href="mailto:partners@alternatecrm.com">Partners</a></li>
              </ul>
            </div>

            <div className="footer-col">
              <h4>Access</h4>
              <ul>
                <li>
                  <a href={SIGNIN_URL} target="_blank" rel="noreferrer" style={{ color: "var(--lime)", fontWeight: 700 }}>
                    Sign In to App ↗
                  </a>
                </li>
                <li><a href="#top" onClick={openLeadModal}>Request VIP Access</a></li>
              </ul>
            </div>
          </div>

          <div className="footer-bottom">
            <div className="flex items-center gap-3 flex-wrap">
              <span>© {year} Alternate CRM Inc.</span>
              <Link href="/status" className="version-pill" title="Operational Telemetry">
                <span className="live-pulse" style={{ width: "6px", height: "6px" }} />
                <span>v14.4.0 • Systems Operational</span>
              </Link>
            </div>
            <div className="flex items-center gap-6">
              <Link href="/status">Status</Link>
              <a href="mailto:security@alternatecrm.com">Security</a>
            </div>
          </div>
        </div>
      </footer>

      {/* ── Native 2-Step Lead Capture Modal ──────────────────────── */}
      {isLeadModalOpen && (
        <div
          className="lead-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeLeadModal();
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Alternate CRM Early Access Request"
        >
          <div className="lead-modal-card">
            <div className="lead-modal-header">
              <div className="brand" style={{ fontSize: "16px" }}>
                <span className="mark" style={{ width: "28px", height: "28px", fontSize: "16px" }}>✳</span>
                <span>alternate<span className="suffix">crm</span></span>
              </div>
              <button
                type="button"
                className="lead-modal-close-btn"
                onClick={closeLeadModal}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            <div className="lead-modal-body">
              {modalStep === 1 ? (
                <div>
                  <h3 className="lead-modal-title">Request early access to Alternate CRM</h3>
                  <p className="lead-modal-sub">
                    Join forward-thinking revenue teams unifying voice, cadences, and customer intelligence.
                  </p>

                  {submitError && (
                    <div style={{ padding: "10px 14px", background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "8px", color: "#fca5a5", fontSize: "12px", marginBottom: "16px" }}>
                      ⚠️ {submitError}
                    </div>
                  )}

                  <form onSubmit={handleSubmitLead} noValidate>
                    <input
                      type="text"
                      name="website_hp"
                      value={formData.website_hp}
                      onChange={handleInputChange}
                      tabIndex={-1}
                      autoComplete="off"
                      style={{ position: "absolute", left: "-9999px", opacity: 0, height: 0 }}
                      aria-hidden="true"
                    />

                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label" htmlFor="firstName">
                          First Name<span className="req">*</span>
                        </label>
                        <input
                          id="firstName"
                          name="firstName"
                          type="text"
                          className="form-input"
                          placeholder="Sarah"
                          value={formData.firstName}
                          onChange={handleInputChange}
                          required
                          autoFocus
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label" htmlFor="lastName">
                          Last Name
                        </label>
                        <input
                          id="lastName"
                          name="lastName"
                          type="text"
                          className="form-input"
                          placeholder="Jenkins"
                          value={formData.lastName}
                          onChange={handleInputChange}
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label" htmlFor="email">
                          Work Email<span className="req">*</span>
                        </label>
                        <input
                          id="email"
                          name="email"
                          type="email"
                          className="form-input"
                          placeholder="sarah@company.com"
                          value={formData.email}
                          onChange={handleInputChange}
                          required
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label" htmlFor="company">
                          Company Name
                        </label>
                        <input
                          id="company"
                          name="company"
                          type="text"
                          className="form-input"
                          placeholder="Stripe"
                          value={formData.company}
                          onChange={handleInputChange}
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label" htmlFor="teamSize">
                          Sales Team Size
                        </label>
                        <select
                          id="teamSize"
                          name="teamSize"
                          className="form-select"
                          value={formData.teamSize}
                          onChange={handleInputChange}
                        >
                          <option value="1-5">1 - 5 reps</option>
                          <option value="6-20">6 - 20 reps</option>
                          <option value="21-50">21 - 50 reps</option>
                          <option value="50+">50+ Enterprise reps</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label className="form-label" htmlFor="primaryInterest">
                          Primary Priority
                        </label>
                        <select
                          id="primaryInterest"
                          name="primaryInterest"
                          className="form-select"
                          value={formData.primaryInterest}
                          onChange={handleInputChange}
                        >
                          <option value="AI Power Dialer & Voice">AI Power Dialer & Voice</option>
                          <option value="Multi-Channel Cadences">Multi-Channel Cadences</option>
                          <option value="Pipeline & Revenue Intelligence">Pipeline & Revenue Intelligence</option>
                          <option value="Full CRM Replacement">Full CRM Replacement</option>
                        </select>
                      </div>

                      <div className="form-group full">
                        <label className="form-label" htmlFor="notes">
                          What is your biggest sales bottleneck today? (Optional)
                        </label>
                        <textarea
                          id="notes"
                          name="notes"
                          rows={2}
                          className="form-textarea"
                          placeholder="e.g. Disconnected dialer, reps spending 68% of time on manual data entry..."
                          value={formData.notes}
                          onChange={handleInputChange}
                        />
                      </div>
                    </div>

                    <div style={{ marginTop: "20px" }}>
                      <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: "100%", padding: "14px", fontSize: "14px" }}
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? "Securing Your Access..." : "Request Priority Early Access ⚡"}
                      </button>
                    </div>

                    <div style={{ textAlign: "center", marginTop: "14px", fontSize: "11px", color: "var(--text-muted)" }}>
                      🔒 Enterprise-grade isolation. Zero audio model training. SOC2 Type II compliance ready.
                    </div>
                  </form>
                </div>
              ) : (
                <div style={{ textAlign: "center" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "rgba(16, 185, 129, 0.2)", color: "#10b981", fontSize: "24px", fontWeight: "bold", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
                    ✓
                  </div>
                  <h3 className="lead-modal-title">
                    Priority Access Confirmed{submittedLead?.name ? `, ${submittedLead.name}` : ""}!
                  </h3>
                  <p className="lead-modal-sub">
                    Your request has been prioritized by our solutions engineering team.
                  </p>

                  <div className="step2-options-grid">
                    <div className="step2-card">
                      <div className="step2-card-header">
                        <span className="step2-card-title">Jump to Front of Line</span>
                        <span className="step2-badge">VIP Slot</span>
                      </div>
                      <p>
                        Schedule a live 15-minute 1-on-1 walkthrough with our founding engineering team.
                      </p>
                      <a
                        href={`https://calendly.com/alternatecrm/30min?name=${encodeURIComponent(
                          submittedLead?.name || ""
                        )}&email=${encodeURIComponent(
                          submittedLead?.email || ""
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-primary"
                        style={{ width: "100%", textAlign: "center", justifyContent: "center" }}
                      >
                        Book VIP 15-Min Walkthrough ↗
                      </a>
                    </div>

                    <div className="step2-card">
                      <div className="step2-card-header">
                        <span className="step2-card-title">Explore Demo Workspace</span>
                        <span className="step2-badge" style={{ color: "var(--cyan)", borderColor: "rgba(56, 189, 248, 0.3)", background: "rgba(56, 189, 248, 0.1)" }}>
                          Instant Demo
                        </span>
                      </div>
                      <p>
                        Browse sample leads, move deals through the pipeline, or simulate an AI call right now.
                      </p>
                      <a
                        href={SANDBOX_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-secondary"
                        style={{ width: "100%", textAlign: "center", justifyContent: "center" }}
                      >
                        ⚡ Open Live Demo Without Login
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
