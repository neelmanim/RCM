#!/usr/bin/env bash
# =============================================================================
# scripts/pre-deploy-check.sh
# Alternate CRM — Pre-Deploy Checklist
#
# Run this BEFORE merging staging → main.
# Usage: bash scripts/pre-deploy-check.sh
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

PASS=0
FAIL=0
SKIP=0

header() { echo -e "\n${BOLD}${BLUE}══════════════════════════════════════════${NC}"; echo -e "${BOLD}${BLUE}  $1${NC}"; echo -e "${BOLD}${BLUE}══════════════════════════════════════════${NC}"; }
ok()     { echo -e "  ${GREEN}✓${NC} $1"; ((PASS++)) || true; }
fail()   { echo -e "  ${RED}✗${NC} $1"; ((FAIL++)) || true; }
warn()   { echo -e "  ${YELLOW}⚠${NC} $1"; ((SKIP++)) || true; }
ask()    {
  if [[ "${NON_INTERACTIVE:-0}" == "1" ]]; then
    echo "y"
  else
    echo -e "\n  ${YELLOW}?${NC} $1" >&2
    read -r -p "    [y/n/skip]: " ans
    echo "$ans"
  fi
}

echo ""
echo -e "${BOLD}Alternate CRM — Pre-Deploy Checklist${NC}"
echo -e "Running at: $(date '+%Y-%m-%d %H:%M %Z')"
echo ""

# =============================================================================
# 1. BRANCH & GIT STATE
# =============================================================================
header "1. Branch & Git State"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" == "staging" || "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "develop" ]]; then
  ok "Active branch: '$CURRENT_BRANCH'"
else
  warn "On '$CURRENT_BRANCH' — standard release flow is develop -> staging -> main"
fi

UNCOMMITTED=$(git status --porcelain | wc -l | tr -d ' ')
if [[ "$UNCOMMITTED" == "0" ]]; then
  ok "Working directory clean (no uncommitted changes)"
else
  warn "$UNCOMMITTED uncommitted file(s) present"
  git status --short | sed 's/^/    /'
fi

# =============================================================================
# 2. STAGING & PRODUCTION CONNECTIVITY
# =============================================================================
header "2. Production & Staging Health Verification"

# Hosting Architecture: Exclusively Vercel (Frontend) and Railway (Backend API & PostgreSQL DB)
STAGING_URL="https://app.alternatecrm.com"
STAGING_API="https://api.alternatecrm.com"

echo "  Frontend (Vercel):     $STAGING_URL"
echo "  Backend API (Railway): $STAGING_API"
echo ""

# Auto-check health
echo -n "  Checking $STAGING_API/api/health... "
HEALTH=$(curl -s --max-time 10 "$STAGING_API/api/health" 2>/dev/null || echo '{"error":"timeout"}')
if echo "$HEALTH" | grep -q '"db_connected":true'; then
  ok "API /api/health: db_connected=true"
else
  fail "API /api/health check failed: $HEALTH"
fi

# Auto-check deep health
echo -n "  Checking $STAGING_API/api/health/deep... "
DEEP=$(curl -s --max-time 10 "$STAGING_API/api/health/deep" 2>/dev/null || echo '{"error":"timeout"}')
if echo "$DEEP" | grep -q '"db_tables_accessible":true'; then
  ok "API /api/health/deep: db_tables_accessible=true"
elif echo "$DEEP" | grep -q '"db_tables_accessible":false'; then
  fail "DB TABLES ARE LOCKED — do not deploy to production"
else
  warn "API /api/health/deep: could not verify ($DEEP)"
fi

# =============================================================================
# SUMMARY
# =============================================================================
header "Summary"

TOTAL=$((PASS + FAIL + SKIP))
echo -e "  Total checks: $TOTAL"
echo -e "  ${GREEN}Passed:${NC}  $PASS"
echo -e "  ${YELLOW}Warned:${NC}  $SKIP"
echo -e "  ${RED}Failed:${NC}  $FAIL"
echo ""

if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}  ✓ ALL CHECKS PASSED — safe to deploy / merge${NC}"
  echo ""
  exit 0
else
  echo -e "${RED}${BOLD}  ✗ $FAIL CHECK(S) FAILED — fix issues before production deploy${NC}"
  echo ""
  exit 1
fi
