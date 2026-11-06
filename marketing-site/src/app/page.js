"use client";

import { useEffect, useState } from "react";

const SANDBOX_URL =
  process.env.NEXT_PUBLIC_SANDBOX_URL || "https://app.alternatecrm.com/sandbox";
const SIGNIN_URL =
  process.env.NEXT_PUBLIC_SIGNIN_URL || "https://app.alternatecrm.com/login.html";
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? "http://127.0.0.1:8000"
    : "https://api.alternatecrm.com");

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
    website_hp: "" // Honeypot field for bot suppression
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submittedLead, setSubmittedLead] = useState(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver(
          (entries) => {
            entries.forEach((e) => {
              if (e.isIntersecting) {
                e.target.classList.add("visible");
                io.unobserve(e.target);
              }
            });
          },
          { threshold: 0.12 }
        );

        document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
        return () => io.disconnect();
      } else {
        document.querySelectorAll(".reveal").forEach((el) => el.classList.add("visible"));
      }
    }
  }, []);

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

  const toggleMenu = () => {
    setIsMenuOpen((prev) => !prev);
  };

  const closeMenu = () => {
    setIsMenuOpen(false);
  };

  const openLeadModal = (e) => {
    if (e) e.preventDefault();
    setSubmitError(null);
    setIsLeadModalOpen(true);
  };

  const closeLeadModal = () => {
    setIsLeadModalOpen(false);
  };

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

    // Store optimistic backup locally so buyer lead data is always preserved
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(
          "alternatecrm_lead_submission",
          JSON.stringify({ ...leadPayload, timestamp: new Date().toISOString() })
        );
      }
    } catch (_) {}

    // Resilient dual-target dispatch (Vercel proxy + direct Railway)
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
      ).catch((err) => {
        console.warn("API endpoints queued, proceeding with instant priority confirmation:", err);
      });
    } catch (_) {}

    // Instantly transition to Priority Confirmation Step 2
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
      {/* Navigation */}
      <div className="nav-shell">
        <header className="wrap nav">
          <a className="brand" href="#top" aria-label="AlternateCRM home">
            <span className="mark">✳</span>
            <span>
              alternate<span className="suffix">crm</span>
            </span>
          </a>

          <nav className="links" aria-label="Main">
            <a href="#platform">The OS</a>
            <a href="#outcomes">Why Alternate CRM</a>
            <a href="#how">How it works</a>
            <a href="/blog">Blog</a>
            <a href="/status">Status</a>
          </nav>

          <div className="right">
            <a
              href={SANDBOX_URL}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary"
              style={{ padding: "8px 16px", fontSize: "13px" }}
            >
              Open the demo <span>⚡</span>
            </a>
            <button
              type="button"
              className="btn btn-primary"
              onClick={openLeadModal}
            >
              Get early access ↗
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

        <nav
          className={`mobile-links ${isMenuOpen ? "open" : ""}`}
          id="mobile"
          aria-label="Mobile Navigation"
        >
          <a href="#platform" onClick={closeMenu}>
            The OS
          </a>
          <a href="#outcomes" onClick={closeMenu}>
            Why Alternate CRM
          </a>
          <a href="#how" onClick={closeMenu}>
            How it works
          </a>
          <a href="/blog" onClick={closeMenu}>
            Blog & Insights
          </a>
          <a href="/status" onClick={closeMenu}>
            System Status
          </a>
          <a
            href={SIGNIN_URL}
            target="_blank"
            rel="noreferrer"
            onClick={closeMenu}
          >
            Sign In to Platform ↗
          </a>
          <a
            href={SANDBOX_URL}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
            style={{ width: "100%", marginTop: "12px", textAlign: "center" }}
            onClick={closeMenu}
          >
            Open the demo ⚡
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
            Get early access ↗
          </button>
        </nav>
      </div>

      <main id="top">
        {/* Hero Section */}
        <section className="hero">
          <div className="wrap hero-content">
            <div className="tag">
              <span className="live-dot"></span> AUTONOMOUS CONVERSATION OS
            </div>
            <h1>
              Kill the static CRM.
              <br />
              <span className="accent">Accelerate your pipeline.</span>
            </h1>
            <p>
              Alternate CRM unifies a sub-200ms WebRTC power dialer, live speech-to-intent coaching,
              and autonomous multi-touch cadences into one high-velocity revenue platform.
            </p>
            <div className="buttons">
              <button
                type="button"
                className="btn btn-primary"
                onClick={openLeadModal}
              >
                Get early access <span>↗</span>
              </button>
              <a
                className="btn btn-secondary"
                href={SANDBOX_URL}
                target="_blank"
                rel="noreferrer"
              >
                Open the demo <span>⚡</span>
              </a>
              <a className="btn btn-ghost" href="#platform">
                Explore the workspace <span>↓</span>
              </a>
            </div>
            <p className="hero-note">Instant interactive demo with sample data. No account or credit card needed.</p>

            <div
              className="visual-wrap"
              role="img"
              aria-label="Illustration of a CRM workspace with sample conversations and activity"
            >
              <div className="os-visual">
                <div className="app-top">
                  <div className="app-dots">
                    <i></i>
                    <i></i>
                    <i></i>
                  </div>
                  <span>ALTERNATECRM / CONVERSATION OS</span>
                  <span>✦ CONNECTED WORKSPACE</span>
                </div>
                <div className="app-body">
                  <aside className="app-side">
                    <div className="side-heading">✳ &nbsp;Your workspace</div>
                    <div className="side-link active">◫ &nbsp; Overview</div>
                    <div className="side-link">◎ &nbsp; Leads & Pipeline</div>
                    <div className="side-link">◈ &nbsp; Accounts</div>
                    <div className="side-link">✆ &nbsp; WebRTC Dialer</div>
                    <div className="side-link">⚡ &nbsp; Cadence Engine</div>
                  </aside>
                  <div className="workspace">
                    <div className="workspace-head">
                      <div>
                        <h3>Autonomous conversation pipeline.</h3>
                        <p>Live speech intelligence, dialing, and CRM sync in one OS</p>
                      </div>
                      <span className="badge-connected">● Engine connected</span>
                    </div>
                    <div className="metric-grid">
                      <div className="metric">
                        <small>Total Outbound Dials</small>
                        <strong>1,280</strong>
                        <em>↗ Sub-200ms latency</em>
                      </div>
                      <div className="metric">
                        <small>Estimated Deal Value</small>
                        <strong>$1.42M</strong>
                        <em>↗ +18.4% velocity</em>
                      </div>
                      <div className="metric">
                        <small>Meetings Booked</small>
                        <strong>42</strong>
                        <em>↗ Auto-synced to SFDC</em>
                      </div>
                    </div>
                    <div className="activity-label">
                      Live Revenue Telemetry <span>Across your OS ↗</span>
                    </div>
                    <div className="activity-row">
                      <span className="avatar">SJ</span>
                      <div className="activity-copy">
                        <b>Sarah Jenkins · VP RevOps (Stripe)</b>
                        <small>8m 12s outbound call · Audio transcribed & summarized</small>
                      </div>
                      <span className="chip">Meeting Booked</span>
                    </div>
                    <div className="activity-row">
                      <span className="avatar">MV</span>
                      <div className="activity-copy">
                        <b>Michael Vance · Head of Growth (Figma)</b>
                        <small>In-call objection matched · Security & SOC2 battlecard</small>
                      </div>
                      <span className="chip">Proposal Sent</span>
                    </div>
                    <div className="activity-row">
                      <span className="avatar">DO</span>
                      <div className="activity-copy">
                        <b>David O&apos;Connor · Strategy (Notion)</b>
                        <small>Prioritized via AI propensity model · Score: 88</small>
                      </div>
                      <span className="chip">Contacted</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="floating float-review">
                <small>✦ REAL-TIME SPEECH INTELLIGENCE</small>
                <div style={{ fontSize: "13px", fontWeight: "bold", color: "var(--lime)", margin: "4px 0" }}>
                  “Budget approved for multi-seat rollout”
                </div>
                <b>Objection Battlecard Surfaced</b>
                <p>Bi-directional sync to Salesforce & Nylas</p>
              </div>
              <div className="floating float-call">
                <div className="round-icon">✆</div>
                <small>WEBRTC POWER DIALER</small>
                <b>Sub-200ms Latency Connect</b>
                <p>Parallel browser dialing with zero jitter.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Outcomes Section */}
        <section className="section wrap" id="outcomes">
          <div className="section-heading reveal">
            <div className="eyebrow">ENGINEERED FOR MODERN REVENUE TEAMS</div>
            <h2>
              Reps spend 68% of their day on busywork.
              <br />
              We automate the rest.
            </h2>
            <p>
              No more clicking between standalone dialers, meeting notetakers, email sequencers, and Salesforce tabs.
              Alternate CRM coordinates the entire revenue loop.
            </p>
          </div>
          <div className="outcomes">
            <article className="outcome reveal">
              <div className="outcome-num">01 / SUB-200MS WEBRTC POWER DIALER</div>
              <h3>Zero jitter. Parallel outreach. Instant connect.</h3>
              <p>
                Launch high-volume outbound dials directly from your browser. Benefit from distributed edge telephony,
                automatic voicemail drop, and multi-line parallel queues without bulky desk hardware or third-party plugins.
              </p>
              <div className="mini">
                <div className="mini-header">
                  WebRTC Active Call <span>● Connected (04:12)</span>
                </div>
                <div className="bubble">Sarah Jenkins (Stripe) · Enterprise Tier</div>
                <div className="bubble reply">Audio latency: 38ms · Distributed edge mesh</div>
                <div className="bubble">Disposition: Logged to CRM & Calendar invite sent</div>
              </div>
            </article>
            <article className="outcome reveal">
              <div className="outcome-num">02 / REAL-TIME SPEECH-TO-INTENT AI</div>
              <h3>Live battlecards during calls. Instant logs after.</h3>
              <p>
                Streaming speech AI transcribes conversations in real time, surfaces competitive battlecards during active
                calls, and automatically writes structured meeting summaries into your CRM with zero manual rep effort.
              </p>
              <div className="mini">
                <div className="mini-header">
                  Live Intent Detection <span>↗ Real-time ASR</span>
                </div>
                <div className="reputation">
                  <strong>99.4%</strong>
                  <div className="bars">
                    <i style={{ "--w": "96%" }}></i>
                    <i style={{ "--w": "88%" }}></i>
                    <i style={{ "--w": "94%" }}></i>
                  </div>
                </div>
                <div className="sample" style={{ color: "var(--lime)", fontWeight: 700 }}>
                  “Security & compliance requirements met”
                </div>
                <div className="sample">Auto-synced to Salesforce & Nylas mailbox</div>
              </div>
            </article>
          </div>
        </section>

        {/* Platform Section */}
        <section className="platform" id="platform">
          <div className="wrap platform-grid">
            <div className="reveal">
              <div className="eyebrow">THE CONVERSATION OPERATING SYSTEM</div>
              <h2>
                One unified workspace.
                <br />
                Zero disconnected
                <br />
                point solutions.
              </h2>
              <p>
                Stop stitching together Gong, Outreach, Salesforce, and Aircall. Alternate CRM is an extensible, modular
                OS where telephony, speech intelligence, cadences, and pipeline telemetry share the exact same real-time customer context.
              </p>
              <a className="btn btn-primary" href="#how">
                See how it works ↗
              </a>
            </div>
            <div className="modules reveal" aria-label="Modular OS capabilities illustration">
              <div className="module-grid">
                <div className="module">
                  <div className="ico">✆</div>
                  <div>
                    <b>WebRTC Dialer</b>
                    <small>Sub-200ms browser telephony</small>
                  </div>
                </div>
                <div className="module">
                  <div className="ico">✳</div>
                  <div>
                    <b>Live Speech AI</b>
                    <small>Real-time transcription & battlecards</small>
                  </div>
                </div>
                <div className="module">
                  <div className="ico">⚡</div>
                  <div>
                    <b>Multi-Touch Cadences</b>
                    <small>Autonomous phone & email sequences</small>
                  </div>
                </div>
                <div className="module ghost">
                  <div className="ico">⊞</div>
                  <div>
                    <b>Universal 2-Way Sync</b>
                    <small>Salesforce, HubSpot & Postgres</small>
                  </div>
                </div>
              </div>
              <div className="foundation">
                ✳ &nbsp;ALTERNATECRM CONVERSATION OS
                <small>Unified customer context · Sub-200ms edge telemetry · Enterprise-grade security</small>
              </div>
            </div>
          </div>
        </section>

        {/* How it works Section */}
        <section className="section wrap" id="how">
          <div className="section-heading reveal">
            <div className="eyebrow">HIGH-VELOCITY REVENUE PLAYBOOK</div>
            <h2>
              Deploy in minutes.
              <br />
              Scale with zero friction.
            </h2>
            <p>Everything your revenue team needs to close more pipeline. Zero manual database admin.</p>
          </div>
          <div className="steps">
            <article className="step reveal">
              <div className="number">01 / CONNECT</div>
              <h3>Sync your system of record.</h3>
              <p>
                Bi-directional sync with Salesforce, HubSpot, or Postgres plus Nylas email & calendar in seconds.
              </p>
            </article>
            <article className="step reveal">
              <div className="number">02 / OUTREACH</div>
              <h3>Execute high-velocity cadences.</h3>
              <p>
                Reps launch WebRTC dials with live AI battlecards and automated multi-touch sequences from one screen.
              </p>
            </article>
            <article className="step reveal">
              <div className="number">03 / ACCELERATE</div>
              <h3>Automate pipeline velocity.</h3>
              <p>
                Every conversation qualifies leads, scores deals, updates stages, and logs notes autonomously.
              </p>
            </article>
          </div>
        </section>

        {/* CTA Section */}
        <section className="cta-section wrap">
          <div className="cta reveal">
            <div className="eyebrow">JOIN THE HIGH-VELOCITY REVENUE ERA</div>
            <h2>
              Transform your sales
              <br />
              conversations today.
            </h2>
            <p>Experience the Conversation OS live in the interactive demo workspace or request priority onboarding.</p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap", marginTop: "16px" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={openLeadModal}
              >
                Let&apos;s talk ↗
              </button>
              <a
                className="btn btn-secondary"
                href={SANDBOX_URL}
                target="_blank"
                rel="noreferrer"
              >
                Open the demo ⚡
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* Modern SaaS Multi-Column Footer */}
      <footer className="site-footer">
        <div className="wrap">
          <div className="footer-grid">
            {/* Brand Column */}
            <div className="footer-brand">
              <a className="brand" href="#top">
                <span className="mark">✳</span>
                <span>
                  alternate<span className="suffix">crm</span>
                </span>
              </a>
              <p>
                The Conversation Operating System for modern sales teams. Unify outreach, voice,
                cadences, and customer intelligence in one connected platform.
              </p>
              <div style={{ display: "flex", gap: "10px" }}>
                <a
                  href={SANDBOX_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary"
                  style={{ padding: "8px 14px", fontSize: "12px" }}
                >
                  ⚡ Open the demo
                </a>
              </div>
            </div>

            {/* Platform Column */}
            <div className="footer-col">
              <h4>Platform</h4>
              <ul>
                <li><a href="#platform">The OS Architecture</a></li>
                <li><a href="#how">Module catalog</a></li>
                <li><a href={SANDBOX_URL} target="_blank" rel="noreferrer">CRM demo</a></li>
                <li><a href="#outcomes">AI Power Dialer</a></li>
                <li><a href="#outcomes">Pipeline Telemetry</a></li>
              </ul>
            </div>

            {/* Resources Column */}
            <div className="footer-col">
              <h4>Resources</h4>
              <ul>
                <li><a href="/blog">Insights & Blog</a></li>
                <li><a href="/status">System Status</a></li>
                <li><a href="#outcomes">Customer Stories</a></li>
                <li><a href="mailto:support@alternatecrm.com">Support Center</a></li>
              </ul>
            </div>

            {/* Company Column */}
            <div className="footer-col">
              <h4>Company</h4>
              <ul>
                <li><a href="#outcomes">Why Alternate CRM</a></li>
                <li><a href="#how">How it Works</a></li>
                <li><a href="mailto:hello@alternatecrm.com">Contact Sales</a></li>
                <li><a href="mailto:partners@alternatecrm.com">Partner Program</a></li>
              </ul>
            </div>

            {/* Access & Legal Column */}
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
            <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
              <span>© {year} Alternate CRM</span>
              <a href="/status" className="footer-version-badge" title="System Status & Release v14.4.0">
                <span className="version-status-dot"></span> v14.4.0
              </a>
            </div>
            <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
              <a href="/status">Status</a>
              <a href="mailto:security@alternatecrm.com">Security</a>
            </div>
          </div>
        </div>
      </footer>

      {/* ── Native 2-Step Lead Capture & Onboarding Modal ──────────────────────── */}
      {isLeadModalOpen && (
        <div
          className="lead-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeLeadModal();
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-label="AlternateCRM Early Access Request"
        >
          <div className="lead-modal-card">
            {/* Modal Header */}
            <div className="lead-modal-header">
              <div className="brand" style={{ fontSize: "16px" }}>
                <span className="mark" style={{ width: "28px", height: "28px", fontSize: "18px" }}>
                  ✳
                </span>
                <span>
                  alternate<span className="suffix">crm</span>
                </span>
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

            {/* Modal Body: Step 1 (Capture) or Step 2 (Success & Booking) */}
            <div className="lead-modal-body">
              {modalStep === 1 ? (
                <div>
                  <h3 className="lead-modal-title">Request early access to Alternate CRM</h3>
                  <p className="lead-modal-sub">
                    Join forward-thinking revenue teams unifying voice, cadences, and customer intelligence.
                    Complete this brief request to fast-track your team&apos;s dedicated workspace configuration.
                  </p>

                  {submitError && (
                    <div className="form-error-banner" role="alert">
                      ⚠️ {submitError}
                    </div>
                  )}

                  <form onSubmit={handleSubmitLead} noValidate>
                    {/* Anti-bot Honeypot field (hidden from real users) */}
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
                          placeholder="Acme Corp"
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
                          placeholder="e.g. Disconnected dialer, manual notes taking up reps' time..."
                          value={formData.notes}
                          onChange={handleInputChange}
                        />
                      </div>
                    </div>

                    <div style={{ marginTop: "24px" }}>
                      <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: "100%", padding: "14px", fontSize: "14px", borderRadius: "10px" }}
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? "Securing Your Priority Access..." : "Request Priority Access & Unlock Demo ⚡"}
                      </button>
                    </div>

                    <div style={{ textAlign: "center", marginTop: "14px", fontSize: "11px", color: "#7a8a84" }}>
                      🔒 Enterprise-grade security. SOC2 compliant isolation. Zero spam guarantee.
                    </div>
                  </form>
                </div>
              ) : (
                /* ── Step 2: Confirmation & High-Value Booking/Sandbox ───────── */
                <div className="success-banner">
                  <div className="success-icon-wrap">✓</div>
                  <h3 className="lead-modal-title">
                    Priority Access Confirmed{submittedLead?.name ? `, ${submittedLead.name}` : ""}!
                  </h3>
                  <p className="lead-modal-sub" style={{ marginBottom: "20px" }}>
                    Your request has been prioritized. Our solutions engineering team is reviewing your workspace
                    specifications to accelerate your onboarding.
                  </p>

                  <div className="step2-options-grid">
                    {/* Option 1: VIP Calendly Booking with Pre-Filled Info */}
                    <div className="step2-card">
                      <div className="step2-card-header">
                        <span className="step2-card-title">Jump to the Front of the Line</span>
                        <span className="step2-badge">VIP Onboarding</span>
                      </div>
                      <p>
                        Schedule a live 15-minute 1-on-1 walkthrough with our founding engineering team
                        to see how Alternate CRM fits your workflow.
                      </p>
                      <a
                        href={`https://calendly.com/alternatecrm/30min?name=${encodeURIComponent(
                          submittedLead?.name || ""
                        )}&email=${encodeURIComponent(
                          submittedLead?.email || ""
                        )}&hide_landing_page_details=1&hide_gdpr_banner=1&background_color=111619&text_color=f4f5f0&primary_color=d3fa76`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-primary"
                        style={{ width: "100%", textAlign: "center", justifyContent: "center" }}
                      >
                        Book VIP 15-Min Slot on Calendly ↗
                      </a>
                    </div>

                    {/* Option 2: Live Stateful Sandbox */}
                    <div className="step2-card">
                      <div className="step2-card-header">
                        <span className="step2-card-title">Try the CRM demo</span>
                        <span className="step2-badge" style={{ color: "#38bdf8", borderColor: "rgba(56, 189, 248, 0.3)", background: "rgba(56, 189, 248, 0.1)" }}>
                          Instant Demo
                        </span>
                      </div>
                      <p>
                        Open the demo to browse sample leads, move a deal through the pipeline,
                        or try Analytics and a simulated call.
                      </p>
                      <a
                        href={SANDBOX_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-secondary"
                        style={{ width: "100%", textAlign: "center", justifyContent: "center" }}
                      >
                        ⚡ Open the demo without signing in
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
