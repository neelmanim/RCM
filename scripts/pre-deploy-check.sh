#!/usr/bin/env bash
# =============================================================================
# scripts/pre-deploy-check.sh
# RCM CRM — Interactive Pre-Deploy Checklist
#
# Run this BEFORE merging develop → main.
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
    if [[ "$1" == *infrastructure* ]]; then
      echo "n"
    else
      echo "y"
    fi
  else
    echo -e "\n  ${YELLOW}?${NC} $1"
    read -r -p "    [y/n/skip]: " ans
    echo "$ans"
  fi
}

echo ""
echo -e "${BOLD}RCM CRM — Pre-Deploy Checklist${NC}"
echo -e "Running at: $(date '+%Y-%m-%d %H:%M %Z')"
echo ""

# =============================================================================
# 1. BRANCH CHECK
# =============================================================================
header "1. Branch & Git State"

# RCA 2026-08-10: this script predated the staging gate (RCA 2026-05-22,
# see AGENT_PROTOCOL.md §6) and was never updated — it kept checking
# against develop even though the documented, actually-followed procedure
# merges staging -> main (never develop -> main directly). Checking against
# develop here always failed on a correctly-run release.
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" == "staging" ]]; then
  ok "On staging branch"
else
  fail "On '$CURRENT_BRANCH' — must be on staging before merging to main (develop -> staging -> main, see AGENT_PROTOCOL.md §6)"
fi

UNPUSHED=$(git log origin/staging..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')
if [[ "$UNPUSHED" == "0" ]]; then
  ok "No unpushed commits — staging is synced with origin"
else
  fail "$UNPUSHED commit(s) not pushed to origin/staging — push first"
fi

UNCOMMITTED=$(git status --porcelain | wc -l | tr -d ' ')
if [[ "$UNCOMMITTED" == "0" ]]; then
  ok "No uncommitted changes"
else
  warn "$UNCOMMITTED uncommitted file(s) — stash or commit before deploying"
  git status --short | sed 's/^/    /'
fi

# =============================================================================
# 2. TESTS
# =============================================================================
header "2. Backend Tests"

echo "  Running: JWT_SECRET=test_secret .venv/bin/pytest backend/tests/ -x -q --tb=short 2>&1 | tail -5"
echo ""
if JWT_SECRET=test_secret .venv/bin/pytest backend/tests/ -x -q --tb=short < /dev/null 2>&1 | tail -8; then
  ok "Tests passed"
else
  fail "Tests FAILED — fix before deploying"
fi

# =============================================================================
# 3. MIGRATION SAFETY
# =============================================================================
header "3. Migration Safety"

echo "  Checking for bare UPDATE leads in data_migrations..."
if grep -n "execute.*UPDATE leads" backend/migrations.py > /dev/null 2>&1; then
  fail "Found bare 'UPDATE leads' SQL executions — these must be named tuples in data_migrations list"
  grep -n "execute.*UPDATE leads" backend/migrations.py | sed 's/^/    /'
else
  ok "All data migrations are named tuples (tracked in _applied_migrations)"
fi

echo "  Checking for ALTER TABLE without lock_timeout..."
if grep -A2 "ALTER TABLE" backend/migrations.py | grep -v "lock_timeout\|IF NOT EXISTS\|ADD COLUMN\|--\|#" | grep "ALTER COLUMN\|ALTER TABLE.*TYPE" > /dev/null 2>&1; then
  warn "Found ALTER TABLE TYPE without visible lock_timeout — verify manually"
else
  ok "No unguarded ALTER TABLE TYPE statements found"
fi

# =============================================================================
# 4. RELEASE NOTES
# =============================================================================
header "4. Release Notes"

RELEASE_FILE="docs/RELEASES.md"
TODAY=$(date '+%Y-%m-%d')

if grep -q "$TODAY" "$RELEASE_FILE" 2>/dev/null; then
  ok "Release note for today ($TODAY) found in $RELEASE_FILE"
else
  fail "No release note for today in $RELEASE_FILE"
  echo -e "  ${YELLOW}→ Add an entry to docs/RELEASES.md before deploying${NC}"
fi

# =============================================================================
# 5. COMMIT MESSAGES
# =============================================================================
header "5. Recent Commit Quality"

echo "  Last 3 commits on develop:"
git log origin/main..origin/develop --oneline -3 2>/dev/null | sed 's/^/    /' || \
  git log -3 --oneline | sed 's/^/    /'

ans=$(ask "Do all commit messages follow the format 'type(scope): summary'?")
if [[ "$ans" == "y" ]]; then
  ok "Commit messages confirmed"
else
  warn "Fix commit messages with: git rebase -i origin/main"
fi

# =============================================================================
# 6. STAGING VERIFICATION (manual)
# =============================================================================
header "6. Staging Verification"

STAGING_URL="https://rcm-frontend-staging.onrender.com"
STAGING_API="https://rcm-crm-staging.onrender.com"

echo "  Staging frontend: $STAGING_URL"
echo "  Staging API:      $STAGING_API"
echo ""

# Auto-check health
echo -n "  Checking /api/health... "
HEALTH=$(curl -s --max-time 10 "$STAGING_API/api/health" 2>/dev/null || echo '{"error":"timeout"}')
if echo "$HEALTH" | grep -q '"db_connected":true'; then
  ok "Staging /api/health: db_connected=true"
else
  fail "Staging /api/health check failed: $HEALTH"
fi

# Auto-check deep health
echo -n "  Checking /api/health/deep... "
DEEP=$(curl -s --max-time 10 "$STAGING_API/api/health/deep" 2>/dev/null || echo '{"error":"timeout"}')
if echo "$DEEP" | grep -q '"db_tables_accessible":true'; then
  ok "Staging /api/health/deep: db_tables_accessible=true"
elif echo "$DEEP" | grep -q '"db_tables_accessible":false'; then
  fail "Staging DB TABLES ARE LOCKED — do not deploy to production"
else
  warn "Staging /api/health/deep: could not verify ($DEEP)"
fi

ans=$(ask "Have you tested an authenticated API endpoint on staging? (e.g. dashboard-stats)")
if [[ "$ans" == "y" ]]; then
  ok "Authenticated staging endpoint verified"
elif [[ "$ans" == "skip" ]]; then
  warn "Staging authenticated test skipped — document reason in release notes"
else
  fail "Authenticated staging test NOT done — required before production deploy"
fi

ans=$(ask "Were any infrastructure parameters changed (pool sizes, timeouts, worker count)?")
if [[ "$ans" == "y" ]]; then
  warn "Infrastructure changes detected — must run on staging for 24h before production"
  fail "24h staging soak required for infrastructure changes"
else
  ok "No infrastructure parameter changes"
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
  echo -e "${GREEN}${BOLD}  ✓ ALL CHECKS PASSED — safe to merge develop → main${NC}"
  echo ""
  echo "  Run:"
  echo "    git checkout main && git merge develop --no-ff -m 'chore: release vX.Y.Z'"
  echo "    git push origin main"
  echo "    git checkout develop"
  echo ""
  exit 0
else
  echo -e "${RED}${BOLD}  ✗ $FAIL CHECK(S) FAILED — DO NOT deploy to production${NC}"
  echo ""
  echo "  Fix the issues above, then re-run: bash scripts/pre-deploy-check.sh"
  echo ""
  exit 1
fi
