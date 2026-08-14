#!/usr/bin/env bash
# ── SDR Lead Page Test Runner ─────────────────────────────────────────────────
# Usage: bash scripts/run-sdr-tests.sh
# Requires: .env.test in project root

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

ENV_FILE="$ROOT/.env.test"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌  .env.test not found."
  echo "    Copy .env.test.template → .env.test and fill in the values."
  exit 1
fi

# Load env vars
set -a; source "$ENV_FILE"; set +a

# Validate required vars
MISSING=()
[[ -z "$SDR_TOKEN" || "$SDR_TOKEN" == "PASTE_SDR_JWT_HERE" ]] && MISSING+=("SDR_TOKEN")
[[ -z "$LEAD_CALLING_ID" ]]   && MISSING+=("LEAD_CALLING_ID")
[[ -z "$LEAD_ASSIGNED_ID" ]]  && MISSING+=("LEAD_ASSIGNED_ID")

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "❌  Missing required env vars in .env.test:"
  for v in "${MISSING[@]}"; do echo "    - $v"; done
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SDR Lead Page Test Suite"
echo "  Target: $CRM_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$ROOT"

npx playwright test \
  tests/sdr-lead-page-p1.spec.js \
  tests/sdr-lead-page-p2.spec.js \
  tests/sdr-lead-page-p3.spec.js \
  tests/sdr-lead-page-p4.spec.js \
  --reporter=html,list \
  "$@"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Report → playwright-report/index.html"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
