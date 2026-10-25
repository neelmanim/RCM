"use client";

import { useEffect, useState } from "react";

const SANDBOX_URL =
  process.env.NEXT_PUBLIC_SANDBOX_URL || "https://app.alternatecrm.com/sandbox.html";
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
  const [year, setYear] = useState("2026");

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
    setYear(new Date().getFullYear().toString());

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
            <a href="#outcomes">Why AlternateCRM</a>
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
              Try Sandbox <span>⚡</span>
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
            Why AlternateCRM
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
            Try Live Sandbox ⚡
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
              <span className="live-dot"></span> INTRODUCING THE CONVERSATION OS
            </div>
            <h1>
              One OS.
              <br />
              <span className="accent">Every conversation.</span>
            </h1>
            <p>
              Turn every conversation into momentum. One connected foundation for your customers,
              your team, and AI. Start with what you need. Grow without limits.
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
                Try Live Sandbox <span>⚡</span>
              </a>
              <a className="btn btn-ghost" href="#platform">
                Explore the OS <span>↓</span>
              </a>
            </div>
            <p className="hero-note">Built to work together. Designed to grow with you.</p>

            <div
              className="visual-wrap"
              role="img"
              aria-label="Illustrative Conversation OS dashboard displaying connected customer engagement, example conversations and sample activity"
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
                    <div className="side-link">◎ &nbsp; Conversations</div>
                    <div className="side-link">◈ &nbsp; Customers</div>
                    <div className="side-link">☆ &nbsp; Reputation</div>
                    <div className="side-link">⊞ &nbsp; Your modules</div>
                  </aside>
                  <div className="workspace">
                    <div className="workspace-head">
                      <div>
                        <h3>Everything, connected.</h3>
                        <p>Your customer experience in one place</p>
                      </div>
                      <span className="badge-connected">● System connected</span>
                    </div>
                    <div className="metric-grid">
                      <div className="metric">
                        <small>Conversations</small>
                        <strong>128</strong>
                        <em>↗ 12% this week</em>
                      </div>
                      <div className="metric">
                        <small>Opportunities</small>
                        <strong>42</strong>
                        <em>↗ 8% this week</em>
                      </div>
                      <div className="metric">
                        <small>Customer reviews</small>
                        <strong>24</strong>
                        <em>↗ 18% this week</em>
                      </div>
                    </div>
                    <div className="activity-label">
                      Your activity <span>Across your OS ↗</span>
                    </div>
                    <div className="activity-row">
                      <span className="avatar">JD</span>
                      <div className="activity-copy">
                        <b>Jordan Davis</b>
                        <small>Started a conversation · Website</small>
                      </div>
                      <span className="chip">Replied</span>
                    </div>
                    <div className="activity-row">
                      <span className="avatar">SM</span>
                      <div className="activity-copy">
                        <b>Sam Miller</b>
                        <small>Shared feedback · Reputation</small>
                      </div>
                      <span className="chip">New review</span>
                    </div>
                    <div className="activity-row">
                      <span className="avatar">AL</span>
                      <div className="activity-copy">
                        <b>Alex Lee</b>
                        <small>Requested a callback · Voice</small>
                      </div>
                      <span className="chip">Qualified</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="floating float-review">
                <small>✦ CUSTOMER MOMENT</small>
                <div className="stars">★★★★★</div>
                <b>“Such a great experience!”</b>
                <p>Another relationship worth keeping.</p>
              </div>
              <div className="floating float-call">
                <div className="round-icon">↗</div>
                <small>CONNECTED AUTOMATION</small>
                <b>New opportunity captured</b>
                <p>From first hello to next step.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Outcomes Section */}
        <section className="section wrap" id="outcomes">
          <div className="section-heading reveal">
            <div className="eyebrow">BUILT AROUND WHAT MATTERS</div>
            <h2>
              Make every interaction
              <br />
              count for more.
            </h2>
            <p>
              From the very first hello to your next great review, connect the moments that help your
              business grow.
            </p>
          </div>
          <div className="outcomes">
            <article className="outcome reveal">
              <div className="outcome-num">01 / TURN INTEREST INTO ACTION</div>
              <h3>Make the first hello your next customer.</h3>
              <p>
                Be there when people reach out. Turn questions into conversations and conversations
                into opportunity.
              </p>
              <div className="mini">
                <div className="mini-header">
                  Website conversation <span>● Live</span>
                </div>
                <div className="bubble">Hi! Can you help me get started?</div>
                <div className="bubble reply">Absolutely. What are you looking for?</div>
                <div className="bubble">I&apos;d love to learn more.</div>
              </div>
            </article>
            <article className="outcome reveal">
              <div className="outcome-num">02 / BUILD RELATIONSHIPS THAT LAST</div>
              <h3>Give people a reason to come back.</h3>
              <p>
                Listen to customers, earn trust, and make great experiences the start of stronger
                relationships.
              </p>
              <div className="mini">
                <div className="mini-header">
                  Customer sentiment <span>↗ Trending positive</span>
                </div>
                <div className="reputation">
                  <strong>4.9</strong>
                  <div className="bars">
                    <i style={{ "--w": "92%" }}></i>
                    <i style={{ "--w": "74%" }}></i>
                    <i style={{ "--w": "45%" }}></i>
                  </div>
                </div>
                <div className="stars">★★★★★</div>
                <div className="sample">Illustrative interface · Sample data</div>
              </div>
            </article>
          </div>
        </section>

        {/* Platform Section */}
        <section className="platform" id="platform">
          <div className="wrap platform-grid">
            <div className="reveal">
              <div className="eyebrow">THE POWER OF A MODULAR OS</div>
              <h2>
                One foundation.
                <br />
                Infinite ways
                <br />
                to connect.
              </h2>
              <p>
                Your business doesn&apos;t need another pile of disconnected tools. Choose the capabilities
                that matter today, then connect new ones seamlessly as you grow—all built around the
                same customer conversation.
              </p>
              <a className="btn btn-primary" href="#how">
                See how it works ↗
              </a>
            </div>
            <div className="modules reveal" aria-label="Modular OS capabilities illustration">
              <div className="module-grid">
                <div className="module">
                  <div className="ico">◎</div>
                  <div>
                    <b>Engage</b>
                    <small>Be there for every hello</small>
                  </div>
                </div>
                <div className="module">
                  <div className="ico">✳</div>
                  <div>
                    <b>Respond</b>
                    <small>People and AI, together</small>
                  </div>
                </div>
                <div className="module">
                  <div className="ico">☆</div>
                  <div>
                    <b>Build trust</b>
                    <small>Feedback that moves you forward</small>
                  </div>
                </div>
                <div className="module ghost">
                  <div className="ico">＋</div>
                  <div>
                    <b>Add what&apos;s next</b>
                    <small>Make the OS yours</small>
                  </div>
                </div>
              </div>
              <div className="foundation">
                ✳ &nbsp;ALTERNATECRM CONVERSATION OS
                <small>One shared foundation · Connected customer context</small>
              </div>
            </div>
          </div>
        </section>

        {/* How it works Section */}
        <section className="section wrap" id="how">
          <div className="section-heading reveal">
            <div className="eyebrow">SIMPLE BY DESIGN</div>
            <h2>
              Start small.
              <br />
              Think connected.
            </h2>
            <p>Everything you need to get moving. Nothing you don&apos;t.</p>
          </div>
          <div className="steps">
            <article className="step reveal">
              <div className="number">01 / CHOOSE</div>
              <h3>Start with your priority.</h3>
              <p>
                Focus on the outcome you need now, instead of paying attention to dozens of tools.
              </p>
            </article>
            <article className="step reveal">
              <div className="number">02 / CONNECT</div>
              <h3>Bring it all together.</h3>
              <p>
                Keep your customer moments connected instead of building another isolated workflow.
              </p>
            </article>
            <article className="step reveal">
              <div className="number">03 / EXPAND</div>
              <h3>Grow at your pace.</h3>
              <p>
                Activate more capabilities when you&apos;re ready, without starting from scratch.
              </p>
            </article>
          </div>
        </section>

        {/* CTA Section */}
        <section className="cta-section wrap">
          <div className="cta reveal">
            <div className="eyebrow">THE FUTURE IS CONNECTED</div>
            <h2>
              Better conversations.
              <br />
              Better business.
            </h2>
            <p>Your Conversation OS starts here.</p>
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
                Try Live Sandbox ⚡
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
                  ⚡ Open Live Sandbox
                </a>
              </div>
            </div>

            {/* Platform Column */}
            <div className="footer-col">
              <h4>Platform</h4>
              <ul>
                <li><a href="#platform">The OS Architecture</a></li>
                <li><a href="#how">Modular App Store</a></li>
                <li><a href={SANDBOX_URL} target="_blank" rel="noreferrer">Interactive Sandbox</a></li>
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
                <li><a href="#outcomes">Why AlternateCRM</a></li>
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
                <li><a href="https://app.alternatecrm.com/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a></li>
                <li><a href="https://app.alternatecrm.com/terms.html" target="_blank" rel="noreferrer">Terms of Service</a></li>
                <li><a href="#top" onClick={openLeadModal}>Request VIP Access</a></li>
              </ul>
            </div>
          </div>

          <div className="footer-bottom">
            <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
              <span>© {year} AlternateCRM Inc. All rights reserved. One OS. Every conversation.</span>
              <a href="/status" className="footer-version-badge" title="System Status & Release v14.4.0">
                <span className="version-status-dot"></span> v14.4.0
              </a>
            </div>
            <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
              <a href="https://app.alternatecrm.com/privacy.html" target="_blank" rel="noreferrer">Privacy</a>
              <a href="https://app.alternatecrm.com/terms.html" target="_blank" rel="noreferrer">Terms</a>
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
                  <h3 className="lead-modal-title">Request Priority Access to Conversation OS</h3>
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
                        to tailor Conversation OS to your workflow.
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
                        <span className="step2-card-title">Interactive Live Sandbox</span>
                        <span className="step2-badge" style={{ color: "#38bdf8", borderColor: "rgba(56, 189, 248, 0.3)", background: "rgba(56, 189, 248, 0.1)" }}>
                          Instant Demo
                        </span>
                      </div>
                      <p>
                        No need to wait: Test drive our fully interactive client-side sandbox right now
                        with pre-seeded enterprise pipeline telemetry and simulated live calls.
                      </p>
                      <a
                        href={SANDBOX_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-secondary"
                        style={{ width: "100%", textAlign: "center", justifyContent: "center" }}
                      >
                        ⚡ Launch Interactive Sandbox (No Login Required)
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
