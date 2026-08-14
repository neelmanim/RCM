#!/bin/bash
# ============================================================================
# 📓 Daily Context Capture Script — RCM
# ============================================================================
#
# Run this at the end of each working day to capture context and state.
# Usage: ./scripts/close_day.sh [optional summary message]
#
# What it captures:
#   1. Date and time
#   2. Git status (uncommitted changes, branch, recent commits)
#   3. Test suite status (backend)
#   4. Open TODOs/FIXMEs in changed files
#   5. Your manual summary (interactive prompt or CLI argument)
#
# Output: Appends an entry to docs/PROJECT_JOURNAL.md
# ============================================================================

set -euo pipefail

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Paths
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
JOURNAL="$PROJECT_ROOT/docs/PROJECT_JOURNAL.md"
DAILY_LOG_DIR="$PROJECT_ROOT/docs/daily_logs"

# Ensure daily_logs directory exists
mkdir -p "$DAILY_LOG_DIR"

# Today's date
TODAY=$(date "+%Y-%m-%d")
NOW=$(date "+%Y-%m-%d %H:%M:%S %Z")
DAY_OF_WEEK=$(date "+%A")

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║     📓 RCM — End of Day Capture        ║${NC}"
echo -e "${BOLD}${CYAN}║     $DAY_OF_WEEK, $TODAY                     ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ──────────────────────────────────────────────
# 1. Git Status
# ──────────────────────────────────────────────
echo -e "${BLUE}📂 Collecting git status...${NC}"
cd "$PROJECT_ROOT"

GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
GIT_UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
GIT_LAST_5_COMMITS=$(git log --oneline -5 2>/dev/null || echo "No commits found")
GIT_CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null || echo "")
GIT_STAGED_FILES=$(git diff --cached --name-only 2>/dev/null || echo "")

# ──────────────────────────────────────────────
# 2. Backend Test Status — kick off now, collect after the prompts (step 5b).
#    The full suite takes ~4min; running it here and waiting on it would mean
#    staring at a spinner before you can even type your summary. Starting it
#    in the background lets that wait overlap with the interactive prompts
#    below instead.
# ──────────────────────────────────────────────
echo -e "${BLUE}🧪 Starting backend tests in background (full suite, ~4min)...${NC}"
TEST_OUTPUT_FILE=$(mktemp)
TEST_PID=""
if [ -f "$PROJECT_ROOT/backend/pytest.ini" ]; then
    ( cd "$PROJECT_ROOT/backend" && python3 -m pytest --tb=no -q > "$TEST_OUTPUT_FILE" 2>&1 || true ) &
    TEST_PID=$!
fi

# ──────────────────────────────────────────────
# 3. TODOs & FIXMEs in recently changed files
# ──────────────────────────────────────────────
echo -e "${BLUE}📝 Scanning for TODOs/FIXMEs...${NC}"
TODOS=""
if [ -n "$GIT_CHANGED_FILES" ]; then
    for f in $GIT_CHANGED_FILES; do
        if [ -f "$f" ]; then
            FILE_TODOS=$(grep -n -i "TODO\|FIXME\|HACK\|XXX" "$f" 2>/dev/null || true)
            if [ -n "$FILE_TODOS" ]; then
                TODOS="$TODOS\n  **$f:**\n$(echo "$FILE_TODOS" | sed 's/^/    /')\n"
            fi
        fi
    done
fi
if [ -z "$TODOS" ]; then
    TODOS="  None found in changed files"
fi

# ──────────────────────────────────────────────
# 4. Collect manual summary
# ──────────────────────────────────────────────
if [ $# -gt 0 ]; then
    SUMMARY="$*"
else
    echo ""
    echo -e "${YELLOW}${BOLD}What did you work on today? (press Enter twice to finish)${NC}"
    echo -e "${YELLOW}Include: features built, bugs fixed, blockers hit, decisions made${NC}"
    echo ""
    SUMMARY=""
    EMPTY_LINE_COUNT=0
    while IFS= read -r line; do
        if [ -z "$line" ]; then
            EMPTY_LINE_COUNT=$((EMPTY_LINE_COUNT + 1))
            if [ $EMPTY_LINE_COUNT -ge 1 ] && [ -n "$SUMMARY" ]; then
                break
            fi
        else
            EMPTY_LINE_COUNT=0
        fi
        if [ -n "$SUMMARY" ]; then
            SUMMARY="$SUMMARY\n$line"
        else
            SUMMARY="$line"
        fi
    done
fi

# ──────────────────────────────────────────────
# 5. Collect carry-forward context
# ──────────────────────────────────────────────
echo ""
echo -e "${YELLOW}${BOLD}What needs to carry forward to tomorrow? (press Enter twice to finish)${NC}"
echo -e "${YELLOW}Include: unfinished work, things to remember, next steps${NC}"
echo ""
CARRY_FORWARD=""
EMPTY_LINE_COUNT=0
while IFS= read -r line; do
    if [ -z "$line" ]; then
        EMPTY_LINE_COUNT=$((EMPTY_LINE_COUNT + 1))
        if [ $EMPTY_LINE_COUNT -ge 1 ] && [ -n "$CARRY_FORWARD" ]; then
            break
        fi
    else
        EMPTY_LINE_COUNT=0
    fi
    if [ -n "$CARRY_FORWARD" ]; then
        CARRY_FORWARD="$CARRY_FORWARD\n$line"
    else
        CARRY_FORWARD="$line"
    fi
done

if [ -z "$CARRY_FORWARD" ]; then
    CARRY_FORWARD="No carry-forward items noted."
fi

# ──────────────────────────────────────────────
# 5b. Collect backend test result (started in background in step 2)
# ──────────────────────────────────────────────
TEST_RESULT="skipped"
if [ -n "$TEST_PID" ]; then
    if kill -0 "$TEST_PID" 2>/dev/null; then
        echo ""
        echo -e "${BLUE}🧪 Still running backend tests, waiting...${NC}"
    fi
    wait "$TEST_PID" 2>/dev/null || true
    TEST_RESULT=$(tail -3 "$TEST_OUTPUT_FILE")
else
    TEST_RESULT="No pytest.ini found — skipped"
fi
rm -f "$TEST_OUTPUT_FILE"

# ──────────────────────────────────────────────
# 6. Build the daily log entry
# ──────────────────────────────────────────────
DAILY_LOG_FILE="$DAILY_LOG_DIR/$TODAY.md"

cat > "$DAILY_LOG_FILE" << ENTRY_END
# 📅 Daily Log — $TODAY ($DAY_OF_WEEK)

**Captured at:** $NOW

---

## 📝 Summary
$(echo -e "$SUMMARY")

## 🔄 Carry-Forward Context
$(echo -e "$CARRY_FORWARD")

## 📂 Git Status
- **Branch:** \`$GIT_BRANCH\`
- **Uncommitted changes:** $GIT_UNCOMMITTED files
$(if [ -n "$GIT_STAGED_FILES" ]; then echo "- **Staged files:**"; echo "$GIT_STAGED_FILES" | sed 's/^/  - /'; fi)

### Last 5 Commits
\`\`\`
$GIT_LAST_5_COMMITS
\`\`\`

## 🧪 Test Results
\`\`\`
$TEST_RESULT
\`\`\`

## 📌 TODOs/FIXMEs in Changed Files
$(echo -e "$TODOS")

---
ENTRY_END

# ──────────────────────────────────────────────
# 7. Update PROJECT_JOURNAL.md with reference
# ──────────────────────────────────────────────
if [ -f "$JOURNAL" ]; then
    # Insert the daily summary reference into the journal after the DAILY_LOGS_START marker.
    # Built with REAL newlines (not \n text) — awk below prints it as-is, no sed escaping games.
    JOURNAL_ENTRY="### $TODAY ($DAY_OF_WEEK)
$(echo -e "$SUMMARY" | head -3)
**Carry-forward:** $(echo -e "$CARRY_FORWARD" | head -2 | tr '\n' ' ')
**Tests:** $(echo "$TEST_RESULT" | tail -1)
**Uncommitted:** $GIT_UNCOMMITTED files | **Branch:** \`$GIT_BRANCH\`
> Full log: [daily_logs/$TODAY.md](daily_logs/$TODAY.md)"

    # Idempotent: only insert if today's heading doesn't already exist
    if grep -q "DAILY_LOGS_START" "$JOURNAL"; then
        if ! grep -q "### $TODAY" "$JOURNAL"; then
            TMP_JOURNAL=$(mktemp)
            # macOS awk rejects a literal newline inside a -v assignment ("newline in
            # string") — pass the multi-line entry via ENVIRON instead, which has no
            # such restriction.
            JOURNAL_ENTRY="$JOURNAL_ENTRY" awk '
                { print }
                /DAILY_LOGS_START/ { print ""; print ENVIRON["JOURNAL_ENTRY"] }
            ' "$JOURNAL" > "$TMP_JOURNAL" && mv "$TMP_JOURNAL" "$JOURNAL"
        else
            echo -e "${YELLOW}ℹ  Journal entry for $TODAY already exists — skipping duplicate.${NC}"
        fi
    fi
fi

# ──────────────────────────────────────────────
# 8. Release notes check — warn if main was updated today without a release note
# ──────────────────────────────────────────────
MAIN_COMMITS_TODAY=$(git log origin/main --since="$TODAY 00:00:00" --oneline 2>/dev/null | wc -l | tr -d ' ')
RELEASES_FILE="$PROJECT_ROOT/docs/RELEASES.md"
RELEASE_NOTE_TODAY=$(grep -c "$TODAY" "$RELEASES_FILE" 2>/dev/null || echo "0")

if [[ "$MAIN_COMMITS_TODAY" -gt 0 ]] && [[ "$RELEASE_NOTE_TODAY" -eq 0 ]]; then
    echo ""
    echo -e "${RED}${BOLD}⚠  WARNING: $MAIN_COMMITS_TODAY commit(s) went to main today but no release note found!${NC}"
    echo -e "${YELLOW}   Add an entry to docs/RELEASES.md before closing.${NC}"
    echo -e "${YELLOW}   Commits on main today:${NC}"
    git log origin/main --since="$TODAY 00:00:00" --oneline | sed 's/^/     /'
    echo ""
    read -r -p "   Open RELEASES.md now to add a note? [y/n]: " open_releases
    if [[ "$open_releases" == "y" ]]; then
        ${EDITOR:-nano} "$RELEASES_FILE"
    fi
elif [[ "$MAIN_COMMITS_TODAY" -gt 0 ]]; then
    echo -e "${GREEN}✓ Release note found in RELEASES.md for today's production deploy${NC}"
fi

# ──────────────────────────────────────────────
# 9. Done!
# ──────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║  ✅ Daily context saved!                     ║${NC}"
echo -e "${GREEN}${BOLD}║                                              ║${NC}"
echo -e "${GREEN}${BOLD}║  📄 Full log: docs/daily_logs/$TODAY.md      ║${NC}"
echo -e "${GREEN}${BOLD}║  📓 Journal:  docs/PROJECT_JOURNAL.md        ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Tip: Share the daily log with your AI assistant at the${NC}"
echo -e "${CYAN}start of your next session for seamless context pickup.${NC}"
echo ""
