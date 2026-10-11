#!/usr/bin/env python3
"""Bulk-seed staging with synthetic leads for load testing.

seed_staging.py only creates 60 leads — too thin to stress pagination,
dashboard-stats, or leaderboard under real volume. This reuses the existing
bulk-CSV-import endpoint (upload-sheet, capped at 10k rows/call) to add a
much larger batch in one request instead of looping single POST /api/leads.

Usage:
    python3 scripts/seed_staging_bulk_leads.py --token <SA_JWT> --count 5000
"""
import argparse
import csv
import io
import random
import sys

import requests

from seed_staging import LEADS as _SEED_LEADS

BASE = "https://messenger-crm-staging.onrender.com"

# Reuse seed_staging.py's existing name/company pool instead of a second copy.
FIRST_NAMES = sorted({l["first_name"] for l in _SEED_LEADS})
LAST_NAMES = sorted({l["last_name"] for l in _SEED_LEADS})
COMPANIES = sorted({l["company"] for l in _SEED_LEADS})


def build_csv(count: int) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["first_name", "last_name", "email", "company", "phone"])
    for i in range(count):
        first = random.choice(FIRST_NAMES)
        last = random.choice(LAST_NAMES)
        company = random.choice(COMPANIES)
        writer.writerow([
            first, last,
            f"{first.lower()}.{last.lower()}.{i}@loadtest-seed.dev",
            company,
            f"+91-9{random.randint(100000000, 999999999)}",
        ])
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--token", required=True, help="Super Admin / Admin JWT for staging")
    ap.add_argument("--count", type=int, default=5000, help="Leads per batch (cap is 10,000/call)")
    ap.add_argument("--batches", type=int, default=1)
    args = ap.parse_args()

    if args.count > 10_000:
        sys.exit("count must be <= 10,000 per batch (server-enforced cap)")

    headers = {"Authorization": f"Bearer {args.token}"}
    for b in range(args.batches):
        csv_content = build_csv(args.count)
        resp = requests.post(f"{BASE}/api/admin/leads/upload-sheet", json={
            "csv": csv_content,
            "filename": f"loadtest-seed-batch-{b + 1}.csv",
            "tag": "loadtest-seed",
        }, headers=headers, timeout=300)
        if resp.status_code != 200:
            print(f"  ❌ batch {b + 1}: {resp.status_code} — {resp.text[:300]}")
            continue
        result = resp.json()
        print(f"  ✅ batch {b + 1}/{args.batches}: {result.get('imported', result)}")


if __name__ == "__main__":
    main()
