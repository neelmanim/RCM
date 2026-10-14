"use client";

import { useEffect, useState } from "react";

const SANDBOX_URL =
  process.env.NEXT_PUBLIC_SANDBOX_URL || "https://alternatecrm.staging.in/sandbox.html";
const CALENDLY_URL =
  "https://calendly.com/alternatecrm?hide_landing_page_details=1&hide_gdpr_banner=1&background_color=111619&text_color=f4f5f0&primary_color=d3fa76";

export default function Home() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCalendlyOpen, setIsCalendlyOpen] = useState(false);
  const [year, setYear] = useState("2026");

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

  // Lock body scroll when Calendly modal is active
  useEffect(() => {
    if (isCalendlyOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isCalendlyOpen]);

  // Handle ESC key to dismiss modal or mobile drawer
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setIsCalendlyOpen(false);
        setIsMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Initialize official Calendly widget when modal is open
  useEffect(() => {
    if (isCalendlyOpen && typeof window !== "undefined") {
      const initWidget = () => {
        const container = document.getElementById("calendly-embed-container");
        if (container && window.Calendly) {
          container.innerHTML = "";
          window.Calendly.initInlineWidget({
            url: CALENDLY_URL,
            parentElement: container,
          });
        }
      };

      if (window.Calendly) {
        initWidget();
      } else {
        const script = document.createElement("script");
        script.src = "https://assets.calendly.com/assets/external/widget.js";
        script.async = true;
        script.onload = initWidget;
        document.body.appendChild(script);
      }
    }
  }, [isCalendlyOpen]);

  const toggleMenu = () => {
    setIsMenuOpen((prev) => !prev);
  };

  const closeMenu = () => {
    setIsMenuOpen(false);
  };

  const openCalendly = (e) => {
    if (e) e.preventDefault();
    setIsCalendlyOpen(true);
  };

  const closeCalendly = () => {
    setIsCalendlyOpen(false);
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
              onClick={openCalendly}
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
          aria-label="Mobile"
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
              openCalendly();
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
                onClick={openCalendly}
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
                onClick={openCalendly}
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

      {/* Footer */}
      <footer className="wrap foot">
        <a className="brand" href="#top">
          <span className="mark">✳</span>
          <span>
            alternate<span className="suffix">crm</span>
          </span>
        </a>
        <small>© {year} AlternateCRM. One OS. Every conversation.</small>
        <nav>
          <a href="mailto:hello@alternatecrm.com">Contact</a>
        </nav>
      </footer>

      {/* Calendly Booking Modal */}
      {isCalendlyOpen && (
        <div
          className="calendly-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeCalendly();
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Schedule a conversation with AlternateCRM"
        >
          <div className="calendly-modal-content">
            <div className="calendly-modal-header">
              <div className="brand" style={{ fontSize: "16px" }}>
                <span className="mark" style={{ width: "28px", height: "28px", fontSize: "18px" }}>
                  ✳
                </span>
                <span>
                  alternate<span className="suffix">crm</span>
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <a
                  href="https://calendly.com/alternatecrm"
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: "12px",
                    color: "var(--lime)",
                    textDecoration: "none",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    background: "rgba(211, 250, 118, 0.08)",
                    border: "1px solid rgba(211, 250, 118, 0.25)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px"
                  }}
                >
                  Open in new tab ↗
                </a>
                <button
                  type="button"
                  className="calendly-close-btn"
                  onClick={closeCalendly}
                  aria-label="Close Calendly modal"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="calendly-iframe-wrap">
              <div
                id="calendly-embed-container"
                className="calendly-inline-widget"
                data-url={CALENDLY_URL}
                style={{ minWidth: "320px", height: "100%", width: "100%" }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
