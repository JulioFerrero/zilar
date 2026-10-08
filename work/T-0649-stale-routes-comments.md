---
id: T-0649
title: "Comments only: repoint the doc comments that name deleted server routes.ts files (approvals, audit, connections, machines, tools, routines, push) at their api.ts; fix three stale server header comments"
status: todo
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

## Review (written by Claude)
