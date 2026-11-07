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
                  Architected to launch high-volume outbound queues directly from Chrome. Explore simulated multi-line calling,
                  voicemail drop workflows, and zero-plugin edge audio directly within the interactive demo.
                </p>
              </div>
              <div className="bento-visual">
                <div className="flex items-center justify-between text-xs mb-3">
                  <span className="text-slate-400 font-mono">WebRTC Audio Channel: Client-Side Simulation</span>
                  <span className="text-emerald-400 font-bold">State: Active Preview</span>
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
                  <td><b>Data Entry & Notes</b></td>
                  <td>Reps spend extensive daily time manually typing call notes and status updates</td>
                  <td>Core CRM logging with planned real-time speech intelligence for automated note drafting</td>
                </tr>
                <tr>
                  <td><b>Telephony Integration</b></td>
                  <td>External desk phones, third-party softphones, or disconnected browser plugins</td>
                  <td>In-browser WebRTC power dialer preview with native CRM call outcome logging</td>
                </tr>
                <tr>
                  <td><b>In-Call Assistance</b></td>
                  <td>Retrospective call recordings only; no real-time on-screen guidance</td>
                  <td>Planned streaming speech-to-intent objection battlecards projected in the workspace</td>
                </tr>
                <tr>
                  <td><b>Tool Sprawl</b></td>
                  <td>Requires 4–6 disparate subscriptions (dialer, cadence tool, meeting bot, CRM)</td>
                  <td>1 modular workspace combining customer records, pipeline analytics, and communication previews</td>
                </tr>
                <tr>
                  <td><b>Deployment & Trial</b></td>
                  <td>Multi-month enterprise implementation with heavy consulting overhead</td>
                  <td>Instant interactive browser demo with $910k pre-seeded pipeline and zero setup</td>
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
                <h3>Simulate High-Velocity Workflows</h3>
                <p>
                  Simulate outbound dials, log call dispositions, and preview live battlecards from one screen.
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
