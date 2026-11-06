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
            Alternate CRM unifies a sub-200ms WebRTC power dialer, live speech-to-intent intelligence,
            and autonomous multi-touch cadences into one high-velocity revenue platform.
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
            <span>⚡ Pre-seeded interactive demo ($1.42M)</span>
            <span>•</span>
            <span>🛡️ SOC2 Type II compliance ready</span>
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
                  <span>app.alternatecrm.com/live-workspace</span>
                </div>
                <div className="window-status">
                  <span className="live-pulse" style={{ width: "6px", height: "6px" }} />
                  <span className="hidden sm:inline">99.99% Systems Operational</span>
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
                      <span>Stripe · Enterprise Pipeline Tier</span>
                    </div>
                  </div>

                  <div className="audio-waveform" title="Live WebRTC Audio Mesh">
                    <span /><span /><span /><span /><span /><span />
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="call-telemetry">
                      <span>● 04:12</span>
                      <span>|</span>
                      <span>38ms Latency</span>
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
                      <span style={{ color: "var(--lime)" }}>Active Whisper Probe</span>
                    </div>

                    <div className="speech-intent-box">
                      <div className="intent-quote">
                        “Budget approved for multi-seat Q4 deployment across 80 reps”
                      </div>
                      <div className="battlecard-pill">
                        <span>⚡ Battlecard Matched:</span>
                        <span>Enterprise Security & SOC2 Type II Architecture</span>
                      </div>
                    </div>

                    <div className="sync-status">
                      <span>✓</span>
                      <span>Auto-synced to Salesforce & Nylas mailbox (0.12s)</span>
                    </div>
                  </div>

                  {/* Right: Glass KPI Metrics */}
                  <div className="kpi-row">
                    <div className="kpi-box">
                      <small>Total Dials</small>
                      <strong>1,280</strong>
                      <em>↗ Sub-200ms audio</em>
                    </div>
                    <div className="kpi-box">
                      <small>Deal Value</small>
                      <strong>$1.42M</strong>
                      <em>↗ +18.4% velocity</em>
                    </div>
                    <div className="kpi-box">
                      <small>Meetings</small>
                      <strong>42</strong>
                      <em>↗ In sprint</em>
                    </div>
                    <div className="kpi-box">
                      <small>Time Saved</small>
                      <strong>14.8h</strong>
                      <em>↗ Zero manual admin</em>
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
              Stop stitching together Gong, Outreach, Salesforce, and standalone dialers.
              Alternate CRM combines telephony, speech intelligence, and automated sequences into one modular OS.
            </p>
          </div>

          <div className="bento-grid">
            {/* Card 1: Sub-200ms WebRTC Power Dialer */}
            <div className="bento-card bento-col-7" id="crm">
              <div>
                <span className="card-badge">01 / Telephony Mesh</span>
                <h3>Sub-200ms WebRTC In-Browser Power Dialer</h3>
                <p>
                  Launch high-volume outbound queues directly from Chrome. Enjoy multi-line parallel dialing,
                  automatic voicemail drops, and crystal-clear edge audio with zero desktop plugins or desk phones.
                </p>
              </div>
              <div className="bento-visual">
                <div className="flex items-center justify-between text-xs mb-3">
                  <span className="text-slate-400 font-mono">Edge Node: Washington D.C. (iad1)</span>
                  <span className="text-emerald-400 font-bold">Latency: 28ms</span>
                </div>
                <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
                  <div className="bg-gradient-to-r from-indigo-500 to-lime-400 h-full w-[88%]" />
                </div>
              </div>
            </div>

            {/* Card 2: Live Speech-to-Intent AI */}
            <div className="bento-card bento-col-5" id="communications">
              <div>
                <span className="card-badge">02 / Conversation AI</span>
                <h3>Real-Time Live Speech-to-Intent Intelligence</h3>
                <p>
                  Streaming Whisper speech intelligence transcribes calls as they happen, surfaces winning objection
                  battlecards during live calls, and drafts structured meeting notes automatically.
                </p>
              </div>
              <div className="bento-visual">
                <div className="text-xs text-lime-400 font-bold mb-1">“Can you integrate with our Salesforce?”</div>
                <div className="text-[11px] text-slate-400">Battlecard: Native bi-directional sync ready in 60s.</div>
              </div>
            </div>

            {/* Card 3: Autonomous Multi-Touch Cadences */}
            <div className="bento-card bento-col-5" id="how">
              <div>
                <span className="card-badge">03 / Outreach Automation</span>
                <h3>Autonomous Multi-Touch Sequences</h3>
                <p>
                  Coordinate phone, email, and social steps that execute automatically based on call dispositions,
                  eliminating rep busywork and accelerating deal velocity.
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
                <span className="card-badge">04 / Enterprise Integrity</span>
                <h3>Universal Bi-directional CRM & Mailbox Sync</h3>
                <p>
                  Never lose enterprise system-of-record fidelity. Alternate CRM syncs two-way with Salesforce,
                  HubSpot, Postgres, and Nylas email/calendar with zero latency or record drift.
                </p>
              </div>
              <div className="bento-visual">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">Salesforce & HubSpot Two-Way Sync</span>
                  <span className="text-emerald-400 font-bold">100% Synced</span>
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
                  <td><b>Data Entry Overhead</b></td>
                  <td>Reps spend 68% of time manually logging calls and notes</td>
                  <td>0% manual entry — live speech AI transcribes & logs autonomously</td>
                </tr>
                <tr>
                  <td><b>Telephony Latency</b></td>
                  <td>External desk phones or slow 800ms+ browser plugins</td>
                  <td>Sub-200ms WebRTC direct mesh with zero jitter</td>
                </tr>
                <tr>
                  <td><b>In-Call Assistance</b></td>
                  <td>Post-call recordings only; zero guidance while on the phone</td>
                  <td>Live streaming speech-to-intent objection battlecards on-screen</td>
                </tr>
                <tr>
                  <td><b>Tool Sprawl</b></td>
                  <td>Requires 5–7 point solutions (Dialer + Sequencer + Meeting Bot)</td>
                  <td>1 unified modular operating system built on one shared customer context</td>
                </tr>
                <tr>
                  <td><b>Deployment Time</b></td>
                  <td>3–6 months complex enterprise rollout</td>
                  <td>Instant 1-click workspace with live seeded demo ready immediately</td>
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
            <p>Everything your revenue organization needs to close more pipeline.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bento-card">
              <div>
                <span className="card-badge">Step 01</span>
                <h3>Connect System of Record</h3>
                <p>
                  Bi-directional sync with Salesforce, HubSpot, or Postgres plus Nylas email & calendar in seconds.
                </p>
              </div>
            </div>
            <div className="bento-card">
              <div>
                <span className="card-badge">Step 02</span>
                <h3>Execute High-Velocity Cadences</h3>
                <p>
                  Reps launch WebRTC parallel dials with live AI battlecards and automated follow-up sequences from one screen.
                </p>
              </div>
            </div>
            <div className="bento-card">
              <div>
                <span className="card-badge">Step 03</span>
                <h3>Automate Pipeline Velocity</h3>
                <p>
                  Every conversation qualifies leads, scores deals, updates stages, and logs notes autonomously.
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
              Experience the Conversation OS live in the interactive demo workspace or request priority onboarding.
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
