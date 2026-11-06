"use client";

import Link from "next/link";

const SANDBOX_URL = "https://app.alternatecrm.com/sandbox";

export default function NotFound() {
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen text-slate-100 relative overflow-hidden font-sans selection:bg-[#d3fa76] selection:text-[#06080c] flex flex-col justify-between">
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
            <Link href="/" className="btn btn-primary">
              Return Home ↗
            </Link>
          </div>
        </header>
      </div>

      {/* ── 404 Hero Card ─────────────────────────────────────────── */}
      <main className="wrap py-20 flex-1 flex items-center justify-center">
        <div
          className="bento-card text-center max-w-lg mx-auto w-full"
          style={{ padding: "48px 32px", border: "1px solid rgba(99, 102, 241, 0.25)" }}
        >
          <div className="hero-pill" style={{ marginBottom: "20px" }}>
            <span className="live-pulse" />
            <span>404 // CLUSTER ROUTE NOT FOUND</span>
          </div>

          <h1
            style={{
              fontSize: "clamp(32px, 5vw, 48px)",
              fontWeight: 900,
              letterSpacing: "-0.04em",
              lineHeight: 1.15,
              margin: "0 0 16px",
              color: "#fff",
            }}
          >
            Lost in the <span className="gradient-text">pipeline?</span>
          </h1>

          <p
            style={{
              fontSize: "15px",
              color: "var(--text-secondary)",
              lineHeight: 1.6,
              margin: "0 0 32px",
            }}
          >
            The route you navigated to doesn’t exist or has been migrated. Explore
            our active client-side sandbox or head back to the main platform.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href={SANDBOX_URL}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary"
              style={{ width: "100%", justifyContent: "center" }}
            >
              ⚡ Launch Live Demo
            </a>
            <Link
              href="/"
              className="btn btn-secondary"
              style={{ width: "100%", justifyContent: "center" }}
            >
              Return Home →
            </Link>
          </div>
        </div>
      </main>

      {/* ── SaaS Footer ───────────────────────────────────────────── */}
      <footer className="site-footer">
        <div className="wrap">
          <div className="footer-bottom" style={{ borderTop: "none", paddingTop: 0 }}>
            <span>© {year} Alternate CRM Inc. Autonomous Revenue Operating System.</span>
            <div className="flex items-center gap-6">
              <Link href="/status">System Status</Link>
              <Link href="/blog">Engineering Blog</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
