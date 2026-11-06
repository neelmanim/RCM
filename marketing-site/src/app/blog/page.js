"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const SANDBOX_URL =
  process.env.NEXT_PUBLIC_SANDBOX_URL || "https://app.alternatecrm.com/sandbox";
const SIGNIN_URL =
  process.env.NEXT_PUBLIC_SIGNIN_URL || "https://app.alternatecrm.com/login.html";

export default function Blog() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeArticle, setActiveArticle] = useState(null);
  const [year] = useState(() => new Date().getFullYear().toString());

  const toggleMenu = () => setIsMenuOpen((prev) => !prev);
  const closeMenu = () => setIsMenuOpen(false);

  // Lock body scroll when article modal is open
  useEffect(() => {
    if (activeArticle) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [activeArticle]);

  // Handle ESC key to dismiss article modal or mobile menu
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setActiveArticle(null);
        setIsMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const posts = [
    {
      id: "conversation-os-architecture",
      title: "Why We Killed the Traditional CRM: Introducing Conversation OS",
      category: "Architecture",
      date: "Oct 24, 2026",
      readTime: "5 min read",
      excerpt:
        "Traditional CRMs are static databases where deals go to die. Here is why we built an active Conversation OS with real-time speech intelligence and autonomous pipeline sync.",
      tag: "Product Vision",
      sections: [
        {
          heading: "The Administrative Tax of Legacy CRMs",
          body: "For two decades, sales technology has treated the customer relationship as a spreadsheet with a graphical skin. Account executives and SDRs spend upwards of 68% of their working hours manually typing call notes, tagging lost reasons, logging activities, and manually advancing pipeline stages. When data entry is manual, CRM hygiene degrades rapidly, creating pipeline blind spots for revenue leaders."
        },
        {
          heading: "Active Intelligence vs. Post-Mortem Analytics",
          body: "Point solutions like Gong and Chorus provided call recordings and retrospective post-call analysis, but retrospective insights arrive too late to rescue a live deal. Alternate CRM reverses this paradigm by turning the CRM into an active Conversation Operating System. By combining in-browser telephony directly with real-time Whisper speech-to-intent streaming, our engine detects objections as they are voiced and projects winning battlecards directly onto the rep’s HUD in under 350ms."
        },
        {
          heading: "Unified Context Model",
          body: "Instead of maintaining separate databases across your dialer, email cadence sequencer, meeting recorder, and system-of-record CRM, Alternate CRM operates on a single reactive event bus. When a prospect mentions budget approval, the call note drafts automatically, the deal probability recalculates, and the cadence switches from cold outreach to executive follow-up without a single manual click."
        }
      ],
      metrics: [
        { label: "Manual Entry Time", value: "0 hours", sub: "Fully autonomous transcription" },
        { label: "Objection Response", value: "<350ms", sub: "Live battlecard HUD delivery" },
        { label: "Sync Latency", value: "0.12s", sub: "Bi-directional Salesforce/HubSpot" }
      ]
    },
    {
      id: "sub-200ms-webrtc-power-dialer",
      title: "Under the Hood: Sub-200ms WebRTC Power Dialer & Audio Cadences",
      category: "Engineering",
      date: "Oct 18, 2026",
      readTime: "8 min read",
      excerpt:
        "How our distributed edge nodes eliminate jitter, power multi-line parallel dialing, and stream audio directly to the Whisper conversation transcription pipeline.",
      tag: "Deep Dive",
      sections: [
        {
          heading: "The SIP Trunk Lag Bottleneck",
          body: "Traditional enterprise dialers route browser audio through legacy PSTN/SIP gateway hops before reaching the carrier network. This produces round-trip latencies of 600ms to 900ms, causing reps and prospects to inadvertently speak over each other. This micro-collision breaks rapport within the critical first 7 seconds of an outbound call."
        },
        {
          heading: "Direct WebRTC Edge Mesh Architecture",
          body: "To achieve sub-200ms audio turnaround, Alternate CRM routes audio directly from modern browser WebRTC engines to distributed media SFU nodes deployed across Washington D.C. (iad1), Frankfurt (fra1), and Singapore (sin1). Audio packets are Opus-encoded at 48kHz, dynamically adapting jitter buffers based on real-time packet loss probes."
        },
        {
          heading: "Parallel Multi-Line Outbound Engine",
          body: "Our outbound dialing engine allows reps to initiate parallel queues with automatic answering machine detection (AMD) running client-side. The moment human voice cadence is detected, the audio channel connects to the rep’s active headset instantaneously, accompanied by pre-loaded customer context and historical touchpoints."
        }
      ],
      metrics: [
        { label: "Audio Jitter", value: "<15ms", sub: "Distributed SFU edge mesh" },
        { label: "Round-Trip Latency", value: "28ms - 38ms", sub: "In-browser WebRTC connection" },
        { label: "Audio Fidelity", value: "Opus 48kHz", sub: "Studio-grade edge compression" }
      ]
    },
    {
      id: "replacing-point-solutions",
      title: "Replacing 7 Fragmented Sales Point Solutions with One Extensible Engine",
      category: "RevOps",
      date: "Oct 10, 2026",
      readTime: "6 min read",
      excerpt:
        "Sales reps spend 68% of their time clicking between dialers, email sequencers, Salesforce tabs, and meeting notetakers. Here is how unifying the workflow cut rep overhead in half.",
      tag: "Case Study",
      sections: [
        {
          heading: "The Multi-SaaS Sprawl Tax",
          body: "A typical high-growth sales tech stack today costs upwards of $1,400 per rep every month: Outreach ($140), Gong ($120), Twilio VoIP seats ($90), ZoomInfo ($250), Salesforce Enterprise ($165), Calendly ($16), and AI notetakers ($40). Beyond the software bill, the invisible tax is context-switching: reps open an average of 14 browser tabs per sales call, copy-pasting customer details across disconnected interfaces."
        },
        {
          heading: "Unified Two-Way System-of-Record Sync",
          body: "Alternate CRM replaces the fragmented point solution stack with one integrated operating system without forcing teams to abandon their core database. Our universal sync engine maintains 100% two-way fidelity with Salesforce, HubSpot, and PostgreSQL. Every outbound dial, cadence email, stage movement, and meeting booked flows bi-directionally in real-time."
        },
        {
          heading: "Quantified Velocity Outcomes",
          body: "Early enterprise pilot cohorts using Alternate CRM consolidated their dialer, cadence engine, and conversation intelligence into one workspace. Within 60 days, pilot teams logged an average of 14.8 hours saved per rep per week, a 3.4x increase in outbound dialing throughput, and an 18.4% acceleration in pipeline conversion velocity."
        }
      ],
      metrics: [
        { label: "Weekly Time Saved", value: "14.8 hours", sub: "Per sales rep per week" },
        { label: "Software Spend Cut", value: "58% reduction", sub: "Point-solution consolidation" },
        { label: "Pipeline Velocity", value: "+18.4%", sub: "SDR discovery to Closed Won" }
      ]
    }
  ];

  return (
    <div className="min-h-screen text-slate-100 relative overflow-hidden font-sans selection:bg-[#d3fa76] selection:text-[#06080c]">
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
            <Link href="/#platform">The Platform</Link>
            <Link href="/#outcomes">Why Alternate CRM</Link>
            <Link href="/#how">Playbook</Link>
            <Link href="/blog" className="text-white font-bold">Insights</Link>
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
            <Link
              href="/#top"
              className="btn btn-primary"
            >
              Get Early Access ↗
            </Link>
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
          <Link href="/#platform" onClick={closeMenu}>The Platform</Link>
          <Link href="/#outcomes" onClick={closeMenu}>Why Alternate CRM</Link>
          <Link href="/#how" onClick={closeMenu}>Playbook</Link>
          <Link href="/blog" onClick={closeMenu}>Insights</Link>
          <Link href="/status" onClick={closeMenu}>System Status</Link>
          <a href={SIGNIN_URL} target="_blank" rel="noreferrer" onClick={closeMenu}>
            Private Beta Gate ↗
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
          <Link
            href="/#top"
            className="btn btn-primary"
            style={{ width: "100%", marginTop: "8px", textAlign: "center" }}
            onClick={closeMenu}
          >
            Get Early Access ↗
          </Link>
        </nav>
      </div>

      {/* ── Main Content ─────────────────────────────────────────── */}
      <main className="wrap py-16">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="hero-pill" style={{ marginBottom: "20px" }}>
            <span className="live-pulse" />
            <span>ENGINEERING & PRODUCT INSIGHTS</span>
          </div>
          <h1 style={{ fontSize: "clamp(36px, 5vw, 64px)", fontWeight: 900, letterSpacing: "-0.04em", margin: "0 0 20px" }}>
            The Conversation OS <span className="gradient-text">Chronicles</span>
          </h1>
          <p style={{ fontSize: "17px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
            Architectural breakdowns, edge WebRTC telemetry, and lessons learned from building the autonomous revenue engine for modern sales teams.
          </p>
        </div>

        {/* Featured Posts Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
          {posts.map((post) => (
            <article
              key={post.id}
              onClick={() => setActiveArticle(post)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActiveArticle(post);
                }
              }}
              className="bento-card cursor-pointer group hover:border-indigo-500/50 transition-all duration-300"
              style={{ minHeight: "340px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="card-badge" style={{ margin: 0 }}>
                    {post.category}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
                    <span>{post.date}</span>
                    <span>•</span>
                    <span>{post.readTime}</span>
                  </div>
                </div>

                <h2 style={{ fontSize: "20px", fontWeight: 800, letterSpacing: "-0.02em", color: "#fff", marginBottom: "12px", lineHeight: 1.3 }}>
                  {post.title}
                </h2>

                <p style={{ fontSize: "14px", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                  {post.excerpt}
                </p>
              </div>

              <div className="pt-4 border-t border-white/5 flex items-center justify-between text-xs font-bold text-lime-400 mt-6 group-hover:text-lime-300">
                <span className="text-slate-500 font-normal">{post.tag}</span>
                <span className="group-hover:translate-x-1 transition-transform flex items-center gap-1">
                  Read Technical Breakdown →
                </span>
              </div>
            </article>
          ))}
        </div>

        {/* Live Sandbox Callout Banner */}
        <div className="cta-banner">
          <h2>Experience Conversation OS in action</h2>
          <p>
            Browse sample leads, move deals through the pipeline, or simulate an AI call with live Whisper intelligence.
          </p>
          <div className="flex justify-center gap-4 flex-wrap">
            <a
              href={SANDBOX_URL}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary"
              style={{ padding: "14px 28px", fontSize: "15px" }}
            >
              Launch Live Sandbox ⚡
            </a>
            <Link
              href="/#top"
              className="btn btn-primary"
              style={{ padding: "14px 28px", fontSize: "15px" }}
            >
              Get Priority Access ↗
            </Link>
          </div>
        </div>
      </main>

      {/* ── Technical Article Reader Modal ───────────────────────── */}
      {activeArticle && (
        <div
          className="lead-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveArticle(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-label={activeArticle.title}
        >
          <div
            className="lead-modal-card"
            style={{ maxWidth: "760px", maxHeight: "90vh", overflowY: "auto" }}
          >
            {/* Header */}
            <div className="lead-modal-header" style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(11, 15, 23, 0.95)", backdropFilter: "blur(12px)" }}>
              <div className="flex items-center gap-3">
                <span className="card-badge" style={{ margin: 0 }}>
                  {activeArticle.category}
                </span>
                <span style={{ fontSize: "12px", color: "var(--text-muted)", fontFamily: "monospace" }}>
                  {activeArticle.date} • {activeArticle.readTime}
                </span>
              </div>
              <button
                type="button"
                className="lead-modal-close-btn"
                onClick={() => setActiveArticle(null)}
                aria-label="Close article"
              >
                ✕
              </button>
            </div>

            {/* Article Content */}
            <div className="lead-modal-body" style={{ padding: "28px" }}>
              <h1
                style={{
                  fontSize: "clamp(24px, 4vw, 32px)",
                  fontWeight: 900,
                  letterSpacing: "-0.03em",
                  color: "#fff",
                  lineHeight: 1.25,
                  margin: "0 0 16px"
                }}
              >
                {activeArticle.title}
              </h1>

              <p
                style={{
                  fontSize: "16px",
                  color: "var(--lime)",
                  lineHeight: 1.6,
                  fontWeight: 600,
                  margin: "0 0 28px",
                  borderLeft: "3px solid var(--lime)",
                  paddingLeft: "16px"
                }}
              >
                {activeArticle.excerpt}
              </p>

              {/* Benchmarked Metrics Row */}
              {activeArticle.metrics && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: "12px",
                    marginBottom: "32px",
                    padding: "16px",
                    borderRadius: "12px",
                    background: "rgba(255, 255, 255, 0.03)",
                    border: "1px solid rgba(255, 255, 255, 0.08)"
                  }}
                >
                  {activeArticle.metrics.map((m, idx) => (
                    <div key={idx}>
                      <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)" }}>
                        {m.label}
                      </div>
                      <div style={{ fontSize: "20px", fontWeight: 900, color: "#fff", fontFamily: "monospace", margin: "4px 0" }}>
                        {m.value}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                        {m.sub}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Sections */}
              <div className="space-y-6">
                {activeArticle.sections?.map((sec, idx) => (
                  <section key={idx} className="space-y-2">
                    <h2
                      style={{
                        fontSize: "18px",
                        fontWeight: 800,
                        color: "#fff",
                        letterSpacing: "-0.02em",
                        margin: "0 0 8px"
                      }}
                    >
                      {sec.heading}
                    </h2>
                    <p
                      style={{
                        fontSize: "15px",
                        color: "var(--text-secondary)",
                        lineHeight: 1.7,
                        margin: 0
                      }}
                    >
                      {sec.body}
                    </p>
                  </section>
                ))}
              </div>

              {/* Modal Footer Callout */}
              <div
                style={{
                  marginTop: "36px",
                  padding: "20px",
                  borderRadius: "14px",
                  background: "rgba(99, 102, 241, 0.08)",
                  border: "1px solid rgba(99, 102, 241, 0.25)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px"
                }}
              >
                <div>
                  <h3 style={{ fontSize: "15px", fontWeight: 800, color: "#fff", margin: "0 0 4px" }}>
                    Test this architecture in the interactive sandbox
                  </h3>
                  <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: 0 }}>
                    Experience the sub-200ms dialer and real-time speech intelligence on sample accounts with zero sign-up.
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <a
                    href={SANDBOX_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary"
                    style={{ fontSize: "13px", padding: "10px 18px" }}
                  >
                    ⚡ Launch Live Sandbox
                  </a>
                  <button
                    type="button"
                    onClick={() => setActiveArticle(null)}
                    className="btn btn-ghost"
                    style={{ fontSize: "13px", padding: "10px 18px" }}
                  >
                    Back to Insights
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
                <li><Link href="/#platform">The OS Architecture</Link></li>
                <li><Link href="/#platform">WebRTC Power Dialer</Link></li>
                <li><Link href="/#platform">Live Speech-to-Intent</Link></li>
                <li><Link href="/#platform">Multi-Touch Cadences</Link></li>
                <li><a href={SANDBOX_URL} target="_blank" rel="noreferrer">Interactive Demo</a></li>
              </ul>
            </div>

            <div className="footer-col">
              <h4>Resources</h4>
              <ul>
                <li><Link href="/blog">Engineering Blog</Link></li>
                <li><Link href="/status">System Status</Link></li>
                <li><Link href="/#outcomes">CRM Comparison</Link></li>
                <li><a href="mailto:support@alternatecrm.com">Support Center</a></li>
              </ul>
            </div>

            <div className="footer-col">
              <h4>Company</h4>
              <ul>
                <li><Link href="/#outcomes">Why Alternate CRM</Link></li>
                <li><Link href="/#how">Revenue Playbook</Link></li>
                <li><a href="mailto:hello@alternatecrm.com">Contact Sales</a></li>
                <li><a href="mailto:partners@alternatecrm.com">Partners</a></li>
              </ul>
            </div>

            <div className="footer-col">
              <h4>Access</h4>
              <ul>
                <li>
                  <a href={SIGNIN_URL} target="_blank" rel="noreferrer" style={{ color: "var(--lime)", fontWeight: 700 }}>
                    Private Beta Gate ↗
                  </a>
                </li>
                <li><Link href="/#top">Request VIP Access</Link></li>
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
    </div>
  );
}
