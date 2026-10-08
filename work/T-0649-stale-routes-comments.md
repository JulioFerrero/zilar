---
id: T-0649
title: "Comments only: repoint the doc comments that name deleted server routes.ts files (approvals, audit, connections, machines, tools, routines, push) at their api.ts; fix three stale server header comments"
status: merged
milestone: M5
branch: task/T-0649-stale-routes-comments
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0649: stale comments about the deleted Hono wrappers

## Spec (written by Claude, do not edit)

### Why
T-0637 to T-0645 deleted the item-11 Hono wrappers (`apps/server/src/<module>/routes.ts`). The wire contract of each module now lives in `apps/server/src/<module>/api.ts`, but comments in mobile, web, the runner and the server still name the deleted files. **This task changes comments only, with no code change.**

### Verified facts (do not re-derive)
**`git grep` on main** shows these comments naming a deleted `routes.ts`:
- `apps/mobile/src/lib/approvals-api.ts:10`: `apps/server/src/approvals/routes.ts`;
- `apps/mobile/src/lib/audit-api.ts:10`: `apps/server/src/audit/routes.ts`;
- `apps/mobile/src/lib/connections-api.ts:10`: `apps/server/src/connections/routes.ts`;
- `apps/mobile/src/lib/machines-api.ts:10`: `apps/server/src/machines/routes.ts`;
- `apps/mobile/src/lib/tools-api.ts:11`: `apps/server/src/tools/routes.ts` and `apps/server/src/routines/routes.ts`;
- `apps/runner/src/capabilities.ts:15`: `apps/server/src/machines/routes.ts`;
- `apps/web/src/lib/api.ts`, five lines:
  - `:1362` machines;
  - `:1457` and `:1540` approvals;
  - `:1751` push;
  - `:2188` audit;
- `apps/web/src/lib/tools.ts:2-3`: tools and routines.

**Server header comments that still call the wrapper live:**
- `apps/server/src/connections/api.ts:3`: "the old Hono router (`routes.ts`, now a thin wrapper";
- `apps/server/src/routines/api.ts:3`: "the old Hono router (`routes.ts`, now a thin wrapper below)";
- `apps/server/src/drafts/api.ts:146-148`: "The item-11 wrapper builds the API without a logger". `deps.logger` is still optional at `drafts/api.ts:77`; the wrapper is gone.

### What to build
1. **In each mobile, web and runner comment above,** replace `routes.ts` with `api.ts` for the same module. Keep the rest of the sentence; adjust only the words that no longer fit.
2. **In the three server comments:**
   - say the old Hono router and its wrapper are deleted;
   - for `drafts/api.ts:146-148`, say a caller without a logger (the tests) gets the silent one.
3. **Change nothing but comments.** Do not touch `apps/server/src/tools/api.ts`; another task is editing it.
4. **Afterwards,** `git grep -n "\(approvals\|audit\|connections\|machines\|tools\|routines\|push\)/routes\.ts" apps` must show nothing outside `apps/server/src/tools/api.ts`.

### Read first
`AGENTS.md`, then each cited line in its file.

### Allowed files
`apps/mobile/src/lib/approvals-api.ts`, `apps/mobile/src/lib/audit-api.ts`, `apps/mobile/src/lib/connections-api.ts`, `apps/mobile/src/lib/machines-api.ts`, `apps/mobile/src/lib/tools-api.ts`, `apps/runner/src/capabilities.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/tools.ts`, `apps/server/src/connections/api.ts`, `apps/server/src/routines/api.ts`, `apps/server/src/drafts/api.ts`, `work/T-0649-stale-routes-comments.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The grep in step 4 is clean.
- `git diff main...HEAD` changes only comment lines.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Comment-only change. Repointed every doc comment that named a deleted Hono
wrapper (`apps/server/src/<module>/routes.ts`) at the module's `api.ts`, and
fixed the three stale server header comments.

Files changed (all inside Allowed files):
- `apps/mobile/src/lib/approvals-api.ts`, `audit-api.ts`, `connections-api.ts`,
  `machines-api.ts`, `tools-api.ts`: `routes.ts` -> `api.ts` in the wire-contract
  comment (tools-api.ts: both `tools` and `routines`).
- `apps/runner/src/capabilities.ts`: `machines/routes.ts` -> `machines/api.ts`.
- `apps/web/src/lib/api.ts`: machines, two approvals spots, push and audit.
- `apps/web/src/lib/tools.ts`: tools and routines.
- `apps/server/src/connections/api.ts`: header now says the old Hono router
  (`routes.ts`) and its thin wrapper have been deleted; reflowed the sentence.
- `apps/server/src/routines/api.ts`: same, for the routines wrapper.
- `apps/server/src/drafts/api.ts`: the wrapper is gone, so the comment now says
  a caller without a logger (the tests) gets the silent one.
- `apps/server/src/tools/api.ts`: not touched (per spec, another task edits it).

### Checks
- `git grep -n "\(approvals\|audit\|connections\|machines\|tools\|routines\|push\)/routes\.ts" apps` -> no matches (exit 1, clean; not even `tools/api.ts` matches).
- `git diff -U0` filtered to changed lines: every added/removed line is a comment line, no code changed.
- `pnpm gate` from the repo root:

```
gate: 12 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (19.7s)
PASS  lint  (1.4s)
PASS  typecheck  (27.6s)
PASS  tests @zilar/mobile  (2.9s)
PASS  tests @zilar/runner  (0.8s)
PASS  tests @zilar/server  (17.0s)
PASS  tests @zilar/web  (2.3s)
scope: every changed file is inside the Allowed files
GATE PASS
```

I did not run any single test files separately: the change is comments only and
`pnpm gate` ran the nearest tests for mobile, runner, server and web.

### Problems / deviations
None. No open questions.

## Review (written by Claude)

**2026-10-09, lead:** approved.
- **Pre-review:** clean. The packet head is 7b5cdf75, the current HEAD.
- **Lead check:** every changed line in `apps/` is a comment.
