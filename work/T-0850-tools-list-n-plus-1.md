---
id: T-0850
title: "Tools list endpoints: batch the per-tool queries (no N+1), select only the columns the view uses"
status: todo
milestone: M5
branch: task/T-0850-tools-list-n-plus-1
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0850: Tools list endpoints: batch the per-tool queries (no N+1), select only the columns the view uses

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding C-F8 item 1 in `docs/audit/simplify-2026-10-09/C-server.md`.
- **`listTools`** (about `apps/server/src/tools/service.ts:364-395`) and **`listToolsForAi`** (about `:1139-1170`) each run, per tool, one `SELECT *` of `ai_tool_versions` (including the tool source, up to `MAX_TOOL_SOURCE_BYTES`) and one `latestRunStatus` query.
- **`apps/server/src/tools/api.ts`** (about :405 and :992) also loops per `aiId`.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
Replace the per-tool queries with batched queries: one for the latest versions of all listed tools, one `DISTINCT ON (tool_id)` for the latest run status. Select only the columns the returned view needs. If the api.ts per-AI loop can use the same batch cheaply, do it too.

Keep identical: result order, values, error behaviour and every response body. The existing `apps/server/src/tools/*.test.ts` must pass unchanged. Add a test that listing N tools runs a constant number of queries, by counting through a wrapped SqlClient or the existing test hooks if there are any; otherwise explain in the Report how you verified it.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/server/src/tools/service.ts`, `apps/server/src/tools/api.ts`, `apps/server/src/tools/*.test.ts`, `work/T-0850-tools-list-n-plus-1.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=30000 --hookTimeout=30000 src/tools
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.

---

## Report (written by the worker when done)

## Review (written by Claude)
