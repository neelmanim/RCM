import HealthCheck from "../../components/HealthCheck";

export const metadata = {
  title: "Service Telemetry & Endpoint Probe",
  description:
    "Live API probe reachability and architecture availability status for Alternate CRM services.",
  alternates: { canonical: "/status" },
  openGraph: {
    title: "System Status | Alternate CRM",
    description: "Live API endpoint reachability and service telemetry across Alternate CRM.",
    url: "/status",
  },
};

const subsystems = [
  { name: "Public API Liveness Probe (/api/public/health)", status: "Probed Above", badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  { name: "Interactive Sample Demo Workspace", status: "Client-Side (Session)", badgeClass: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30" },
  { name: "WebRTC Power Dialer", status: "Planned Architecture Preview", badgeClass: "bg-slate-500/10 text-slate-400 border-slate-500/30" },
  { name: "Speech-to-Intent Streaming Pipeline", status: "Planned Architecture Preview", badgeClass: "bg-slate-500/10 text-slate-400 border-slate-500/30" },
  { name: "Universal CRM Bi-directional Sync", status: "Planned Architecture Preview", badgeClass: "bg-slate-500/10 text-slate-400 border-slate-500/30" },
];

export default function Status() {
  return (
    <main id="main-content" tabIndex={-1} className="wrap content-page py-16" style={{ maxWidth: "860px" }}>
      <div className="section-head mb-10">
        <div className="hero-pill inline-flex mb-4">
          <span className="live-pulse" />
          <span>INFRASTRUCTURE & SERVICE TELEMETRY</span>
        </div>
        <h1 style={{ fontSize: "clamp(36px, 5vw, 56px)", fontWeight: 900, letterSpacing: "-0.04em", margin: "0 0 16px" }}>
          Service <span className="gradient-text">Telemetry</span>
        </h1>
        <p style={{ fontSize: "16px", color: "var(--text-secondary)", margin: 0 }}>
          Live API endpoint reachability probe and architecture module availability status.
        </p>
      </div>

      <HealthCheck />

      {/* Subsystems Overview Table */}
      <section className="bento-card mb-8" style={{ padding: 0, overflow: "hidden", marginTop: "24px" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid rgba(255, 255, 255, 0.06)", background: "rgba(255, 255, 255, 0.02)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Subsystem Architecture
          </span>
          <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--text-secondary)" }}>
            Status / Scope
          </span>
        </div>

        <div style={{ divideY: "1px solid rgba(255, 255, 255, 0.04)" }}>
          {subsystems.map((sys, i) => (
            <div
              key={i}
              className="status-row"
              style={{
                padding: "16px 24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: i < subsystems.length - 1 ? "1px solid rgba(255, 255, 255, 0.05)" : "none",
              }}
            >
              <div className="flex items-center gap-3">
                <span className="live-pulse" style={{ width: "8px", height: "8px" }} />
                <span style={{ fontSize: "14px", fontWeight: 600, color: "#fff" }}>
                  {sys.name}
                </span>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${sys.badgeClass}`}>
                {sys.status}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="bento-card" style={{ marginTop: "24px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 800, color: "#fff", marginBottom: "8px" }}>
          Coverage & Architecture Boundaries
        </h2>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
          The health check above tests HTTP reachability for the Alternate CRM public API health endpoint.
          It verifies API edge server responsiveness, not database write availability or external provider connections.
          Client-side demo workspaces operate with browser session storage. Telephony, speech coaching,
          and external CRM sync are planned architecture modules and are not monitored by this liveness check.
        </p>
      </section>
    </main>
  );
}
