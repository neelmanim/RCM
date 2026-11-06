export async function GET() {
  const start = performance.now();
  const checkedAt = new Date().toISOString();
  let state = "unknown";
  let durationMs;
  try {
    const base = process.env.ALTERNATE_CRM_API_URL || "https://api.alternatecrm.com";
    const response = await fetch(`${base.replace(/\/$/, "")}/api/public/health`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    durationMs = Math.round(performance.now() - start);
    state = response.ok ? "reachable" : "degraded";
  } catch { /* A failed probe never implies an operational service. */ }
  return Response.json({ state, checkedAt, ...(durationMs != null ? { durationMs } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
