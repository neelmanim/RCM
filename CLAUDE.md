<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`
- **Before ANY code change** (bug fix, refactor, new feature): before Grepping
  for callers/usages or opening files to scope the change, run
  `query_graph` (callers_of/callees_of/imports_of) and `get_impact_radius`
  on the symbol(s) you're about to touch. This is what surfaces every
  sibling call site up front — the reason the class of bug from
  `dialer_call_event_time()` took a full-repo grep-based audit to catch
  instead of one graph query. Token cost matters here too: a graph query
  is a fraction of the tokens of reading whole files to trace the same
  callers by hand.

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.

## Mandatory pre-ship review: ponytail-review + ponytail-audit

**Before any `staging → main` promotion, and before declaring a non-trivial
feature "done", run BOTH `/ponytail-review` (diff-scoped) and
`/ponytail-audit` (repo-wide, scoped to the files touched) on the changes.**
This was skipped once (Account Disqualify shipped with zero frontend UI, and
a new per-row array scan was added to `lead_list.js` without noticing it
tripled an existing redundant-scan pattern) — both would have been caught by
this pass. Do this even when the user hasn't explicitly asked for it; treat
it as part of finishing the work, not an optional extra step.
