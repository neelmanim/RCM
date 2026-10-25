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

---

## Token Optimization Rules

**IMPORTANT: Minimize token usage. Every tool call and file read costs tokens.**

### Scope Boundaries — Ignore These Paths
The following directories are **deprioritized or inactive**. Do NOT read, search, or
analyze them unless the user explicitly asks:
- `frontend-react/` — React frontend (secondary)
- `backend-react/` — React backend (inactive)

### Graph Tool Rules
- Always use `detail_level="minimal"` on graph tools unless full detail is needed
- When graph tool output is saved to a file, read only the first 50 lines — don't read the full JSON dump
- Prefer `file_path_pattern` filters on `find_large_functions_tool` to scope results

### File Reading Rules
- **Never read an entire file over 500 lines** in one call — read only the relevant section
- When exploring a route file, read just the function signatures first (`grep -n "^def \|^async def "`)
- Avoid re-reading files already viewed in the same conversation

### Artifact Rules
- Do not rewrite entire artifacts for small changes — use the edit tools instead
- Keep implementation plans concise — tables over paragraphs
