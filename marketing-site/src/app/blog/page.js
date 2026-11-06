"use client";

import { useState } from "react";
import Link from "next/link";

const SANDBOX_URL =
  process.env.NEXT_PUBLIC_SANDBOX_URL || "https://app.alternatecrm.com/sandbox";
const SIGNIN_URL =
  process.env.NEXT_PUBLIC_SIGNIN_URL || "https://app.alternatecrm.com/login.html";

export default function Blog() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [year] = useState(() => new Date().getFullYear().toString());

  const toggleMenu = () => setIsMenuOpen((prev) => !prev);
  const closeMenu = () => setIsMenuOpen(false);

  const posts = [
    {
      title: "Why We Killed the Traditional CRM: Introducing Conversation OS",
      category: "Architecture",
      date: "Oct 24, 2026",
      readTime: "5 min read",
      excerpt: "Traditional CRMs are static databases where deals go to die. Here is why we built an active Conversation OS with real-time speech intelligence and autonomous pipeline sync.",
      tag: "Product Vision"
    },
    {
      title: "Under the Hood: Sub-200ms WebRTC Power Dialer & Audio Cadences",
      category: "Engineering",
      date: "Oct 18, 2026",
      readTime: "8 min read",
      excerpt: "How our distributed edge nodes eliminate jitter, power multi-line parallel dialing, and stream audio directly to the Whisper conversation transcription pipeline.",
      tag: "Deep Dive"
    },
    {
      title: "Replacing 7 Fragmented Sales Point Solutions with One Extensible Engine",
      category: "RevOps",
      date: "Oct 10, 2026",
      readTime: "6 min read",
      excerpt: "Sales reps spend 68% of their time clicking between dialers, email sequencers, Salesforce tabs, and meeting notetakers. Here is how unifying the workflow cut rep overhead in half.",
      tag: "Case Study"
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
          {posts.map((post, i) => (
            <article
              key={i}
              className="bento-card"
              style={{ minHeight: "340px" }}
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

              <div className="pt-4 border-t border-white/5 flex items-center justify-between text-xs font-bold text-lime-400 mt-6">
                <span className="text-slate-500 font-normal">{post.tag}</span>
                <span className="hover:underline flex items-center gap-1">
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
                    Sign In to App ↗
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
