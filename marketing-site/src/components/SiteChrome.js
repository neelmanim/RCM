"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { SANDBOX_URL, SIGNIN_URL } from "./siteLinks";

const navLinks = [
  ["/#platform", "The Platform"],
  ["/#outcomes", "Why Alternate CRM"],
  ["/#how-it-works", "Playbook"],
  ["/blog", "Insights"],
  ["/status", "System Status"],
];

export function Header() {
  const [open, setOpen] = useState(false);
  const toggle = useRef(null);
  const close = () => setOpen(false);

  return (
    <div
      className="nav-shell"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          close();
          toggle.current?.focus();
        }
      }}
    >
      <header className="wrap nav">
        <Link className="brand" href="/" aria-label="Alternate CRM home" onClick={close}>
          <span className="mark" aria-hidden="true">✳</span>
          <span>
            alternate<span className="suffix">crm</span>
          </span>
          <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            OS
          </span>
        </Link>

        <nav className="links" aria-label="Main navigation">
          {navLinks.map(([href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>

        <div className="right">
          <a href={SANDBOX_URL} className="btn btn-secondary">
            Open Live Demo <span>⚡</span>
          </a>
          <Link className="btn btn-primary" href="/?request-access=1" scroll={false}>
            Get Early Access ↗
          </Link>
          <button
            type="button"
            ref={toggle}
            className="mobile-toggle"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls="mobile-navigation"
            onClick={() => setOpen(!open)}
          >
            {open ? "✕" : "☰"}
          </button>
        </div>
      </header>

      {/* Mobile Drawer */}
      <nav
        id="mobile-navigation"
        className={`mobile-links ${open ? "open" : ""}`}
        aria-label="Mobile navigation"
      >
        {navLinks.map(([href, label]) => (
          <Link key={href} href={href} onClick={close}>
            {label}
          </Link>
        ))}
        <a href={SIGNIN_URL} onClick={close}>
          Private Beta Gate ↗
        </a>
        <a
          href={SANDBOX_URL}
          className="btn btn-secondary"
          style={{ width: "100%", marginTop: "12px", textAlign: "center" }}
          onClick={close}
        >
          Open Live Demo ⚡
        </a>
        <Link
          href="/?request-access=1"
          scroll={false}
          className="btn btn-primary"
          style={{ width: "100%", marginTop: "8px", textAlign: "center" }}
          onClick={close}
        >
          Get Early Access ↗
        </Link>
      </nav>
    </div>
  );
}

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link className="brand" href="/">
              <span className="mark" aria-hidden="true">✳</span>
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
              <li><Link href="/#crm">WebRTC Power Dialer</Link></li>
              <li><Link href="/#communications">Live Speech-to-Intent</Link></li>
              <li><Link href="/#integrations">Universal 2-Way Sync</Link></li>
              <li><a href={SANDBOX_URL}>Interactive Demo</a></li>
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
            <h4>Access</h4>
            <ul>
              <li>
                <Link
                  href="/?request-access=1"
                  scroll={false}
                  style={{ color: "var(--lime)", fontWeight: 700 }}
                >
                  Request VIP Early Access ↗
                </Link>
              </li>
              <li><a href={SIGNIN_URL}>Private Beta Gate ↗</a></li>
              <li><a href="mailto:security@alternatecrm.com">Security & Compliance</a></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <div className="flex items-center gap-3 flex-wrap">
            <span>© {year} Alternate CRM Inc. Autonomous Revenue Operating System.</span>
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
  );
}
