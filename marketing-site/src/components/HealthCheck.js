"use client";
import { useEffect, useRef, useState } from "react";
async function fetchResult(signal) {
  try {
    const response = await fetch("/api/service-check", { cache: "no-store", signal });
    const data = await response.json();
    return response.ok && ["reachable", "degraded", "unknown"].includes(data.state) ? data : { state: "unknown", checkedAt: new Date().toISOString() };
  } catch { return { state: "unknown", checkedAt: new Date().toISOString() }; }
}
export default function HealthCheck() {
  const [result, setResult] = useState({ state: "checking" });
  const running = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetchResult(AbortSignal.any([controller.signal, AbortSignal.timeout(7000)])).then(data => { if (!controller.signal.aborted) setResult(data); });
    return () => controller.abort();
  }, []);
  async function check() {
    if (running.current) return;
    running.current = true;
    setResult({ state: "checking" });
    setResult(await fetchResult(AbortSignal.timeout(7000)));
    running.current = false;
  }
  const labels = { checking: "Checking API reachability…", reachable: "Public API responded", degraded: "Public API returned an error", unknown: "API reachability could not be verified" };
  return <section className="bento-card health-result"><div role="status" aria-live="polite"><h2>{labels[result.state]}</h2>{result.durationMs != null && <p>Server-to-API response time: {result.durationMs} ms. This is not audio latency.</p>}{result.checkedAt && <p>Checked at <time dateTime={result.checkedAt}>{result.checkedAt}</time></p>}<p>{result.state === "reachable" ? "Only this public endpoint was checked; other services may have different availability." : result.state === "checking" ? "Waiting for a bounded response." : "No operational status is assumed when a check fails."}</p></div><button type="button" className="btn btn-secondary" disabled={result.state === "checking"} onClick={check}>Check again</button></section>;
}
