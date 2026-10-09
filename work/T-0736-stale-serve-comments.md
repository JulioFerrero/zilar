---
id: T-0736
title: "comments only: three stale 'after serve()' comments in actions/gateway.ts, approvals/sweeper.ts and routines/scheduler.ts now say 'after the edge server is listening' (T-0733 replaced serve())"
status: todo
milestone: M5
branch: task/T-0736-stale-serve-comments
model: auto
effort: low
depends_on: [T-0735]
estimate: 0.02 day
---

# T-0736: three stale serve() comments

## Spec (written by Claude, do not edit)

### Why
T-0733 replaced `serve()` from `@hono/node-server` with `serveEdgeOnNode` (`apps/server/src/effect/node-serve.ts`). T-0735 found three comments that still say a job starts "after `serve()`".

### Verified facts (do not re-derive)
Run `grep -n "serve()" apps/server/src/actions/gateway.ts apps/server/src/approvals/sweeper.ts apps/server/src/routines/scheduler.ts`. It lists exactly those comment lines (about `gateway.ts:199`, `sweeper.ts:89`, `scheduler.ts:94`).

### What to build
In each of those comment lines, replace the `serve()` wording with "after the edge server is listening (`serveEdgeOnNode` in `index.ts`)", keeping the rest of each comment. **Comments only; no code changes.**

### Read first
`AGENTS.md`, plus the lines around each hit.

### Allowed files
`apps/server/src/actions/gateway.ts`, `apps/server/src/approvals/sweeper.ts`, `apps/server/src/routines/scheduler.ts`, `work/T-0736-stale-serve-comments.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `git grep -n "serve()" -- apps/server/src` prints nothing.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
