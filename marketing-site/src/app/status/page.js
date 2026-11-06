import HealthCheck from "../../components/HealthCheck";

export const metadata = {
  title: "System Status & Service Telemetry",
  description:
    "Real-time API probe reachability, cluster status, and architecture availability across Alternate CRM services.",
  alternates: { canonical: "/status" },
  openGraph: {
    title: "System Status | Alternate CRM",
    description: "Real-time API reachability and service telemetry across Alternate CRM clusters.",
    url: "/status",
  },
};

const subsystems = [
  { name: "Zero-Config Client-Side Stateful Sandbox", status: "Operational" },
  { name: "Inbound Lead Intake API Gateway", status: "Operational" },
  { name: "WebRTC Power Dialer & Edge Media Mesh", status: "Active Preview" },
  { name: "Speech-to-Intent Whisper Streaming Pipeline", status: "Active Preview" },
  { name: "Universal CRM Bi-directional Sync (Salesforce / HubSpot)", status: "Active Preview" },
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
          System <span className="gradient-text">Status</span>
        </h1>
        <p style={{ fontSize: "16px", color: "var(--text-secondary)", margin: 0 }}>
          Live API endpoint reachability, cluster health, and service availability across Alternate CRM.
        </p>
      </div>

      <HealthCheck />

      {/* Subsystems Overview Table */}
      <section className="bento-card mb-8" style={{ padding: 0, overflow: "hidden", marginTop: "24px" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid rgba(255, 255, 255, 0.06)", background: "rgba(255, 255, 255, 0.02)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Subsystem Architecture
          </span>
          <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--emerald)" }}>
            Deployment State
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
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
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
          The health check directly probes the Alternate CRM public API edge in Washington D.C. (iad1).
          Client-side demo workspaces operate with zero-loss in-memory state. Real-time telephony, speech coaching,
          and external CRM sync are running in active enterprise preview mode.
        </p>
      </section>
    </main>
  );
}
