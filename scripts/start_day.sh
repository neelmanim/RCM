#!/bin/bash
# ============================================================================
# 🌅 Daily Context Loader — RCM
# ============================================================================
#
# Run this at the START of each working day to load yesterday's context.
# Usage: ./scripts/start_day.sh
#
# What it shows:
#   1. The most recent carry-forward context
#   2. Uncommitted changes
#   3. Latest commits
# ============================================================================

set -euo pipefail

# Colors
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DAILY_LOG_DIR="$PROJECT_ROOT/docs/daily_logs"

cd "$PROJECT_ROOT"

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║     🌅 RCM — Start of Day Briefing     ║${NC}"
echo -e "${BOLD}${CYAN}║     $(date '+%A, %Y-%m-%d')                   ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# Find the most recent daily log
LATEST_LOG=""
if compgen -G "$DAILY_LOG_DIR/*.md" > /dev/null 2>&1; then
    LATEST_LOG=$(ls -t "$DAILY_LOG_DIR"/*.md 2>/dev/null | head -1)
fi

if [ -n "$LATEST_LOG" ] && [ -f "$LATEST_LOG" ]; then
    LOG_DATE=$(basename "$LATEST_LOG" .md)
    echo -e "${YELLOW}${BOLD}📅 Last session: $LOG_DATE${NC}"
    echo -e "${YELLOW}───────────────────────────────────────────────${NC}"
    echo ""
    
    # Extract carry-forward section
    echo -e "${BOLD}🔄 Carry-Forward from Last Session:${NC}"
    echo ""
    awk '/^## 🔄 Carry-Forward Context/ { inside=1; next } inside && /^## / { inside=0 } inside { print }' "$LATEST_LOG" | head -20
    echo ""
    
    # Extract summary
    echo -e "${BOLD}📝 What Was Done:${NC}"
    echo ""
    awk '/^## 📝 Summary/ { inside=1; next } inside && /^## / { inside=0 } inside { print }' "$LATEST_LOG" | head -10
    echo ""
else
    echo -e "${YELLOW}No previous daily logs found. Run ./scripts/close_day.sh at end of day.${NC}"
    echo ""
fi

# Current git status
echo -e "${BLUE}${BOLD}📂 Current Git Status:${NC}"
echo -e "${BLUE}───────────────────────────────────────────────${NC}"
echo ""
GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
GIT_UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
echo -e "  Branch: ${BOLD}$GIT_BRANCH${NC}"
echo -e "  Uncommitted changes: ${BOLD}$GIT_UNCOMMITTED files${NC}"
echo ""

if [ "$GIT_UNCOMMITTED" -gt 0 ]; then
    echo -e "${YELLOW}  Changed files:${NC}"
    git status --porcelain 2>/dev/null | head -15 | sed 's/^/    /'
    echo ""
fi

echo -e "${BOLD}  Recent commits:${NC}"
git log --oneline -5 2>/dev/null | sed 's/^/    /'
echo ""

echo -e "${CYAN}${BOLD}Ready to start! 🚀${NC}"
echo -e "${CYAN}Tip: Share this output with your AI assistant for instant context.${NC}"
echo ""
