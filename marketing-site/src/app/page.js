import Link from "next/link";
import { SANDBOX_URL } from "../components/siteLinks";

export default function Home() {
  return (
    <main id="main-content" tabIndex={-1}>
      {/* ── Hero Section ────────────────────────────────────────── */}
      <section className="hero" id="top">
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
            Alternate CRM unifies core customer records, pipeline stages, and sales activity with modular architecture previews for in-browser telephony, live speech intelligence, and automated sequences.
          </p>

          <div className="hero-actions">
            <a
              className="btn btn-primary"
              style={{ padding: "14px 28px", fontSize: "15px" }}
              href={SANDBOX_URL}
            >
              Open Live Demo <span>⚡</span>
            </a>
            <Link
              className="btn btn-secondary"
              style={{ padding: "14px 28px", fontSize: "15px" }}
              href="/?request-access=1"
              scroll={false}
            >
              Get Early Access ↗
            </Link>
            <a className="btn btn-ghost" href="#platform">
              Explore the Platform ↓
            </a>
          </div>

          <div className="hero-trust">
            <span>🔒 Zero sign-in required</span>
            <span>•</span>
            <span>⚡ Fictional sample accounts ($910k)</span>
            <span>•</span>
            <span>📞 Calls and external integrations are simulated</span>
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
                  <span>app.alternatecrm.com/sandbox</span>
                </div>
                <div className="window-status">
                  <span className="live-pulse" style={{ width: "6px", height: "6px" }} />
                  <span className="hidden sm:inline">Interactive Architecture Preview · Fictional sample data</span>
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
                      <span>Northstar Labs · Sample Account</span>
                    </div>
                  </div>

                  <div className="audio-waveform" title="Simulated WebRTC Audio Stream">
                    <span /><span /><span /><span /><span /><span />
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="call-telemetry">
                      <span>● 04:12</span>
                      <span>|</span>
                      <span>Simulated Call</span>
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
                      <span style={{ color: "var(--lime)" }}>Architecture Preview · Planned</span>
                    </div>

                    <div className="speech-intent-box">
                      <div className="intent-quote">
                        “Evaluating Alternate CRM across our 45-person sales organization”
                      </div>
                      <div className="battlecard-pill">
                        <span>⚡ Sample Battlecard:</span>
                        <span>Enterprise Architecture & Modular System Overview</span>
                      </div>
                    </div>

                    <div className="sync-status">
                      <span>✓</span>
                      <span>Universal 2-Way Sync Engine · Planned Preview</span>
                    </div>
                  </div>

                  {/* Right: Glass KPI Metrics */}
                  <div className="kpi-row">
                    <div className="kpi-box">
                      <small>Sample Dials</small>
                      <strong>1</strong>
                      <em>↗ In current demo</em>
                    </div>
                    <div className="kpi-box">
                      <small>Deal Value</small>
                      <strong>$910k</strong>
                      <em>↗ Sample pipeline</em>
                    </div>
                    <div className="kpi-box">
                      <small>Meetings Booked</small>
                      <strong>2</strong>
                      <em>↗ In sample sprint</em>
                    </div>
                    <div className="kpi-box">
                      <small>Architecture</small>
                      <strong>Modular OS</strong>
                      <em>↗ Zero disconnected tabs</em>
                    </div>
                  </div>
                </div>
              </div>
            </div>
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
              Replace fragmented point solutions with an integrated workspace.
              Alternate CRM combines customer records, pipeline analytics, and modular communication previews.
            </p>
          </div>

          <div className="bento-grid">
            {/* Card 1: Sub-200ms WebRTC Power Dialer */}
            <div className="bento-card bento-col-7" id="crm">
              <div>
                <span className="card-badge">01 / Telephony Mesh (Planned Preview)</span>
                <h3>WebRTC In-Browser Power Dialer Preview</h3>
                <p>
                  Architected for browser-based calling without third-party plugins. In the public demo, you can test
                  a sample interaction and log the outcome directly to customer activity records.
                </p>
              </div>
              <div className="bento-visual">
                <div className="flex items-center justify-between text-xs mb-3">
                  <span className="text-slate-400 font-mono">WebRTC Audio Channel: Architecture Concept</span>
                  <span className="text-emerald-400 font-bold">State: Planned Preview</span>
                </div>
                <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
                  <div className="bg-gradient-to-r from-indigo-500 to-lime-400 h-full w-[88%]" />
                </div>
              </div>
            </div>

            {/* Card 2: Live Speech-to-Intent AI */}
            <div className="bento-card bento-col-5" id="communications">
              <div>
                <span className="card-badge">02 / Conversation AI (Planned Preview)</span>
                <h3>Real-Time Live Speech-to-Intent Intelligence Preview</h3>
                <p>
                  Designed to stream live speech intelligence, detect objections during sales calls, and surface relevant battlecards
                  while drafting structured notes directly to customer records.
                </p>
              </div>
              <div className="bento-visual">
                <div className="text-xs text-lime-400 font-bold mb-1">“Can you integrate with our external CRM?”</div>
                <div className="text-[11px] text-slate-400">Battlecard: Modular sync architecture supports bi-directional mapping.</div>
              </div>
            </div>

            {/* Card 3: Autonomous Multi-Touch Cadences */}
            <div className="bento-card bento-col-5" id="how">
              <div>
                <span className="card-badge">03 / Outreach Automation (Planned Preview)</span>
                <h3>Multi-Touch Sales Sequences Preview</h3>
                <p>
                  Engineered to coordinate multi-channel steps across phone, email, and social touchpoints that adapt based on
                  call dispositions, eliminating rep busywork and accelerating deal velocity.
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
            <div className="bento-card bento-col-7" id="integrations">
              <div>
                <span className="card-badge">04 / Enterprise Integrity (Planned Preview)</span>
                <h3>Universal Bi-directional System-of-Record Sync Preview</h3>
                <p>
                  Built to maintain enterprise system-of-record fidelity. Architected for bi-directional synchronization with
                  Salesforce, HubSpot, Postgres, and Nylas mailboxes without data silos.
                </p>
              </div>
              <div className="bento-visual">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">Salesforce & HubSpot Bi-directional Sync</span>
                  <span className="text-emerald-400 font-bold">Architecture Blueprint</span>
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
            <h2>Traditional CRM Setups vs Modular Architecture</h2>
            <p>Comparing common multi-tool configurations with an integrated sales workspace.</p>
          </div>

          <div className="comparison-wrap">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Workflow Dimension</th>
                  <th>Traditional Point Solutions</th>
                  <th>Alternate CRM (Modular OS)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>Data Entry & Notes</b></td>
                  <td>Manual note-taking and administrative pipeline updates frequently consume substantial selling time</td>
                  <td>Core CRM logging with planned speech-to-intent analysis to assist with automated note drafting</td>
                </tr>
                <tr>
                  <td><b>Telephony Integration</b></td>
                  <td>Often relies on separate softphones, desk phones, or external browser extensions</td>
                  <td>In-browser WebRTC telephony preview with native customer outcome logging</td>
                </tr>
                <tr>
                  <td><b>In-Call Assistance</b></td>
                  <td>Frequently limited to post-call review recordings rather than live contextual assistance</td>
                  <td>Planned real-time battlecards and objection cues projected directly in the sales view</td>
                </tr>
                <tr>
                  <td><b>Tool Sprawl</b></td>
                  <td>Typically combines multiple separate subscriptions across dialers, sequencers, and recording tools</td>
                  <td>One modular workspace bringing customer accounts, pipeline tracking, and communication previews together</td>
                </tr>
                <tr>
                  <td><b>Deployment & Trial</b></td>
                  <td>Often requires extensive setup or professional services before sales reps can test the workflow</td>
                  <td>Instant browser demo with $910k in sample accounts, allowing immediate workflow evaluation without sign-in</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Playbook / How It Works ──────────────────────────────── */}
      <section className="section" id="how-it-works">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">PLAYBOOK</span>
            <h2>Deploy in minutes. Scale with zero friction.</h2>
            <p>Everything your revenue organization needs to manage and close pipeline.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bento-card">
              <div>
                <span className="card-badge">Step 01</span>
                <h3>Review Customer Records</h3>
                <p>
                  Explore accounts, deal stages, and interaction history in the interactive sample workspace.
                </p>
              </div>
            </div>
            <div className="bento-card">
              <div>
                <span className="card-badge">Step 02</span>
                <h3>Simulate Call Outcome Logging</h3>
                <p>
                  Test call disposition logging on sample accounts, and explore architecture previews for speech intelligence and cadences.
                </p>
              </div>
            </div>
            <div className="bento-card">
              <div>
                <span className="card-badge">Step 03</span>
                <h3>Track Pipeline Velocity</h3>
                <p>
                  Monitor deal distribution, stage conversion rates, and revenue analytics as deals advance.
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
              Experience the modular Conversation OS live in the interactive demo workspace or request early access.
            </p>
            <div className="flex justify-center gap-4 flex-wrap">
              <a
                className="btn btn-primary"
                style={{ padding: "14px 28px", fontSize: "15px" }}
                href={SANDBOX_URL}
              >
                Open Live Demo <span>⚡</span>
              </a>
              <Link
                className="btn btn-secondary"
                style={{ padding: "14px 28px", fontSize: "15px" }}
                href="/?request-access=1"
                scroll={false}
              >
                Get Priority Access ↗
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
