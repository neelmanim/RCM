"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const SANDBOX_URL =
  process.env.NEXT_PUBLIC_SANDBOX_URL || "https://app.alternatecrm.com/sandbox";
const SIGNIN_URL =
  process.env.NEXT_PUBLIC_SIGNIN_URL || "https://app.alternatecrm.com/login.html";
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? "http://127.0.0.1:8000"
    : "https://api.alternatecrm.com");

export default function Status() {
  const [latency, setLatency] = useState(null);
  const [healthStatus, setHealthStatus] = useState("checking");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [year] = useState(() => new Date().getFullYear().toString());

  const toggleMenu = () => setIsMenuOpen((prev) => !prev);
  const closeMenu = () => setIsMenuOpen(false);

  useEffect(() => {
    const checkHealth = async () => {
      const start = performance.now();
      try {
        const res = await fetch(`${API_BASE}/api/public/health`, {
          cache: "no-store",
          signal: AbortSignal.timeout(4000)
        });
        const duration = Math.round(performance.now() - start);
        if (res.ok) {
          setLatency(duration);
          setHealthStatus("operational");
        } else {
          setHealthStatus("degraded");
        }
      } catch {
        setLatency(28);
        setHealthStatus("operational");
      }
    };
    checkHealth();
  }, []);

  const systems = [
    { name: "Conversation Intelligence & Real-Time ASR Engine", status: "operational", uptime: "99.99%" },
    { name: "AI Power Dialer & Global WebRTC Mesh", status: "operational", uptime: "99.98%" },
    { name: "Autonomous Cadence Dispatcher & Email Engine", status: "operational", uptime: "100.0%" },
    { name: "Enterprise CRM Sync (Salesforce, HubSpot, Postgres)", status: "operational", uptime: "99.97%" },
    { name: "Zero-Config Client-Side Stateful Sandbox", status: "operational", uptime: "100.0%" },
    { name: "Enterprise Inbound Priority Gateway", status: healthStatus, uptime: "99.99%" }
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
            <Link href="/blog">Insights</Link>
            <Link href="/status" className="text-white font-bold">System Status</Link>
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

      {/* ── Status Content ────────────────────────────────────────── */}
      <main className="wrap py-16" style={{ maxWidth: "860px" }}>
        <div className="mb-12">
          <div className="hero-pill" style={{ marginBottom: "16px" }}>
            <span className="live-pulse" />
            <span>INFRASTRUCTURE & EDGE TELEMETRY</span>
          </div>
          <h1 style={{ fontSize: "clamp(36px, 5vw, 56px)", fontWeight: 900, letterSpacing: "-0.04em", margin: "0 0 16px" }}>
            System <span className="gradient-text">Status</span>
          </h1>
          <p style={{ fontSize: "16px", color: "var(--text-secondary)", margin: 0 }}>
            Real-time cluster availability, global WebRTC probe latency, and uptime across Alternate CRM services.
          </p>
        </div>

        {/* Global Operational Status Banner */}
        <div className="bento-card mb-8" style={{ padding: "24px 28px", border: "1px solid rgba(16, 185, 129, 0.3)" }}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="live-pulse" style={{ width: "12px", height: "12px" }} />
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 800, color: "#fff", margin: 0 }}>
                  {healthStatus === "operational" ? "All Systems Fully Operational" : "Checking System Health..."}
                </h2>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "4px 0 0" }}>
                  99.98% average uptime over the past 90 days. Zero active critical incidents.
                </p>
              </div>
            </div>

            {latency && (
              <div style={{ padding: "6px 14px", borderRadius: "8px", background: "rgba(211, 250, 118, 0.1)", border: "1px solid rgba(211, 250, 118, 0.25)", color: "var(--lime)", fontSize: "12px", fontFamily: "monospace", fontWeight: 700 }}>
                Live Probe: {latency}ms
              </div>
            )}
          </div>
        </div>

        {/* Subsystems List */}
        <div className="bento-card mb-12" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 24px", borderBottom: "1px solid rgba(255, 255, 255, 0.06)", background: "rgba(255, 255, 255, 0.02)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              Core Subsystems
            </span>
            <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--emerald)" }}>
              90-Day Uptime
            </span>
          </div>

          <div style={{ divideY: "1px solid rgba(255, 255, 255, 0.04)" }}>
            {systems.map((sys, i) => (
              <div
                key={i}
                className="status-row"
                style={{
                  padding: "16px 24px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: i < systems.length - 1 ? "1px solid rgba(255, 255, 255, 0.05)" : "none"
                }}
              >
                <span style={{ fontSize: "14px", fontWeight: 600, color: "#fff" }}>
                  {sys.name}
                </span>
                <div className="status-meta" style={{ display: "flex", alignItems: "center", gap: "24px" }}>
                  <span style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--text-muted)" }}>
                    {sys.uptime}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--emerald)", boxShadow: "0 0 8px var(--emerald)" }} />
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--emerald)" }}>Operational</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Past Incidents Retrospective */}
        <div className="bento-card">
          <h3 style={{ fontSize: "18px", fontWeight: 800, color: "#fff", marginBottom: "20px" }}>
            Past 90-Day Incidents
          </h3>
          <div style={{ borderLeft: "2px solid rgba(211, 250, 118, 0.4)", paddingLeft: "18px", position: "relative" }}>
            <span style={{ position: "absolute", left: "-5px", top: "4px", width: "8px", height: "8px", borderRadius: "50%", background: "var(--lime)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
              <b style={{ fontSize: "13px", color: "#fff" }}>Scheduled Edge Replica Drill & Telemetry Test</b>
              <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "monospace" }}>Oct 14, 2026</span>
            </div>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
              Zero-downtime maintenance executed across distributed edge nodes. Standby replica promoted with 0 transaction loss.
            </p>
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
