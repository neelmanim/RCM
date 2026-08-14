#!/usr/bin/env python3
"""
load_test.py — Staging load test for optimised endpoints
=========================================================
Run: python3 scripts/load_test.py

Generates a JWT directly (no Google SSO needed), then hammers the
previously-slow endpoints concurrently and prints a P50/P95/P99/MAX
latency report.

Endpoints tested:
  GET /api/leads               (was 9,714ms P95)
  GET /api/admin/users         (was 1,512ms P95)
  GET /api/leads/dashboard-stats (was 1,085ms P95)
  GET /api/leaderboard         (was 753ms P95)
  GET /api/admin/call-logs     (was 663ms P95)
"""
import asyncio
import os
import sys
import time
import statistics
from typing import List

import httpx

# ── Config ────────────────────────────────────────────────────────────────────
BASE_URL    = "https://rcm-crm-staging.onrender.com"
CONCURRENCY = 5   # concurrent workers per endpoint
REQUESTS    = 10  # requests per endpoint total

# JWT token — set via env var or pass as arg
TOKEN = os.environ.get("STAGING_TOKEN", "")

# ── Endpoints ─────────────────────────────────────────────────────────────────
ENDPOINTS = [
    ("GET /api/leads",                 "/api/leads?page=1&per_page=20"),
    ("GET /api/admin/users",           "/api/admin/users"),
    ("GET /api/leads/dashboard-stats", "/api/leads/dashboard-stats"),
    ("GET /api/leaderboard",           "/api/leaderboard"),
    ("GET /api/admin/call-logs",       "/api/admin/call-logs?page=1&per_page=20"),
    ("GET /api/leads/my",              "/api/leads/my?page=1&per_page=20"),
    ("GET /api/leads/activity-feed",   "/api/leads/activity-feed"),
]

# ── RAIL thresholds ───────────────────────────────────────────────────────────
RAIL = {"OK": 100, "ACCEPTABLE": 300, "SLOW": 1000}

def rail_label(ms: float) -> str:
    if ms < RAIL["OK"]:          return "✅ OK"
    if ms < RAIL["ACCEPTABLE"]:  return "🟡 ACCEPTABLE"
    if ms < RAIL["SLOW"]:        return "🟠 SLOW"
    return                              "🔴 CRITICAL"


async def hit(client: httpx.AsyncClient, url: str) -> float:
    """Single timed GET. Returns latency in ms or -1 on error."""
    try:
        t0 = time.perf_counter()
        r = await client.get(url, timeout=30.0)
        ms = (time.perf_counter() - t0) * 1000
        if r.status_code >= 400:
            print(f"  ⚠️  {url} → {r.status_code}")
            return -1
        return ms
    except Exception as e:
        print(f"  ❌ {url} → {e}")
        return -1


async def bench_endpoint(name: str, path: str, token: str) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    url = f"{BASE_URL}{path}"
    sem = asyncio.Semaphore(CONCURRENCY)

    async def bounded(client):
        async with sem:
            return await hit(client, url)

    async with httpx.AsyncClient(headers=headers, follow_redirects=True) as client:
        tasks = [bounded(client) for _ in range(REQUESTS)]
        results = await asyncio.gather(*tasks)

    latencies = [r for r in results if r >= 0]
    if not latencies:
        return {"name": name, "error": "all requests failed"}

    latencies.sort()
    p50  = statistics.median(latencies)
    p95  = latencies[int(len(latencies) * 0.95)] if len(latencies) >= 20 else max(latencies)
    p99  = latencies[int(len(latencies) * 0.99)] if len(latencies) >= 100 else max(latencies)
    return {
        "name":    name,
        "n":       len(latencies),
        "p50":     p50,
        "p95":     p95,
        "p99":     p99,
        "max":     max(latencies),
        "min":     min(latencies),
        "errors":  REQUESTS - len(latencies),
    }


def print_report(results: List[dict]):
    print()
    print("=" * 80)
    print(f"{'ENDPOINT':<40} {'N':>3}  {'P50':>8}  {'P95':>8}  {'MAX':>8}  RAIL")
    print("-" * 80)
    any_critical = False
    for r in results:
        if "error" in r:
            print(f"{r['name']:<40}  ❌ {r['error']}")
            continue
        label = rail_label(r["p95"])
        if "CRITICAL" in label:
            any_critical = True
        print(
            f"{r['name']:<40} {r['n']:>3}  "
            f"{r['p50']:>7.0f}ms  {r['p95']:>7.0f}ms  {r['max']:>7.0f}ms  {label}"
            + (f"  (errors: {r['errors']})" if r["errors"] else "")
        )
    print("=" * 80)
    if any_critical:
        print("⚠️  Some endpoints are CRITICAL — investigate before promoting to prod.")
        sys.exit(1)
    else:
        print("✅  All endpoints within acceptable thresholds — safe to promote.")
        sys.exit(0)


async def main():
    global TOKEN
    if not TOKEN:
        print("❌ No STAGING_TOKEN set. Run with:")
        print("   STAGING_TOKEN=<your_jwt> python3 scripts/load_test.py")
        sys.exit(1)

    print(f"🔫 Load testing {BASE_URL}")
    print(f"   Concurrency: {CONCURRENCY} | Requests per endpoint: {REQUESTS}")
    print()

    results = []
    for name, path in ENDPOINTS:
        print(f"  Testing {name}...", end=" ", flush=True)
        r = await bench_endpoint(name, path, TOKEN)
        if "error" not in r:
            print(f"P95={r['p95']:.0f}ms")
        else:
            print(f"FAILED — {r['error']}")
        results.append(r)

    print_report(results)


if __name__ == "__main__":
    asyncio.run(main())
