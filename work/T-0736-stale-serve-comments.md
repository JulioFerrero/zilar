---
id: T-0736
title: "comments only: three stale 'after serve()' comments in actions/gateway.ts, approvals/sweeper.ts and routines/scheduler.ts now say 'after the edge server is listening' (T-0733 replaced serve())"
status: merged
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

**What I did:** replaced the three `serve()` comment hits with the wording from the spec ("after the edge server is listening (`serveEdgeOnNode` in `index.ts`)"). Comments only, no code changed.

**Files changed:**
- `apps/server/src/actions/gateway.ts` (comment at about line 199, rewrapped)
- `apps/server/src/approvals/sweeper.ts` (comment at about line 89, rewrapped)
- `apps/server/src/routines/scheduler.ts` (comment at about line 94, rewrapped)
- `work/T-0736-stale-serve-comments.md` (status and this Report)

**Commands run (real results):**
- `pnpm install`: done, exit ok.
- `pnpm exec prettier --write` on the three files: all unchanged.
- `git grep -n "serve()" -- apps/server/src`: no output (exit 1), acceptance check passes.
- `pnpm gate` (from `/Users/julio/personal-projects/zilar-T-0736`):
  - `gate: 4 changed file(s) against main`
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (16.5s)`
  - `PASS  lint  (1.0s)`
  - `PASS  typecheck  (3.2s)`
  - `PASS  tests @zilar/server  (19.1s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

**Deviations / problems:** none. I did not run single tests by hand, since the spec's Checks is only `pnpm gate`.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 1.5 min). The three changes are comments only, and `git grep "serve()"` in `apps/server/src` now prints nothing. `lead merge` runs the gate again on the final commit.
