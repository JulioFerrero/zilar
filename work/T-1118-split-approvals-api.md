---
id: T-1118
title: "Size split: apps/server/src/approvals/api.ts (562) — the read helpers after createApprovalsApi move unchanged to approvals/api-reads.ts"
status: merged
milestone: M5
branch: task/T-1118-split-approvals-api
model: auto
effort: default
depends_on: [T-1116]
estimate: 0.1 day
---

# T-1118: Split `approvals/api.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is 400 lines per source file (2026-10-10); the plan is `docs/audit/size-plan.md` T62. `apps/server/src/approvals/api.ts` has 562 lines (read by the lead).
- `createApprovalsApi` runs from `:92` to about `:414`.
- **After it come only private helpers:**
  - `loadTopicRow` (`:415`), `loadTopicsForGroup` (`:427`), `AiOwnerRow` (`:442`), `loadAiOwnerRow` (`:447`) and `loadApprovalRule` (`:459`);
  - `canManageRuleFor` (`:477`), `decoratePublic` (`:505`), `visibleTopicNames` (`:517`), `visibleTopicName` (`:533`), `approverNamesForRow` (`:546`) and `managedGroupIdsForUser` (`:552`).
- **Before it:** `toWireApproval` (`:77`) and `toWireRule` (`:86`).

### What to build
1. **A new `apps/server/src/approvals/api-reads.ts`** holds every helper from `:415` to the end, **moved byte-for-byte** with the imports they need, each exported.
2. **`api.ts`** imports them from `./api-reads` and keeps everything else, including `toWireApproval` and `toWireRule`.
3. **No behaviour change.** Every function body is identical; only `export` and import lines change.
4. **Line counts:** both files stay at most 400 lines. Paste `wc -l` in the Report.
5. **Tests** (permissions): run `apps/server/src/approvals/rules.test.ts` and `apps/server/src/approvals/service.test.ts`, and paste the results. Do not edit them.

### Read first
`AGENTS.md`, and `apps/server/src/approvals/api.ts`.

### Allowed files
`apps/server/src/approvals/api.ts`, `apps/server/src/approvals/api-reads.ts`, `work/T-1118-split-approvals-api.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/approvals/rules.test.ts src/approvals/service.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Both files are at most 400 lines.

---

## Report (written by the worker when done)

### What I did

Followed the Spec's items 1–3, then the lead's follow-up to also move the wire mappers
and the two interfaces so `api.ts` fits under 400.

- **New `apps/server/src/approvals/api-reads.ts`** holds, moved unchanged and each
  exported:
  - the read helpers from old `api.ts` `:412`–`:562` — `loadTopicRow`,
    `loadTopicsForGroup`, `AiOwnerRow`, `loadAiOwnerRow`, `loadApprovalRule`,
    `canManageRuleFor`, `decoratePublic`, `visibleTopicNames`, `visibleTopicName`,
    `approverNamesForRow`, `managedGroupIdsForUser`;
  - the wire mappers `toWireApproval` and `toWireRule` (old `:77`–`:97`);
  - the `ApprovalsRouteLogger` and `ApprovalsApiDependencies` interfaces (old `:54`–`:82`).
- **`apps/server/src/approvals/api.ts`** keeps the header, `ApprovalsApi` and
  `createApprovalsApi` (all six handlers, audit calls, layer and mount) unchanged. It
  imports the moved names from `./api-reads` and re-exports both interfaces so external
  importers keep working:
  `export type { ApprovalsRouteLogger, ApprovalsApiDependencies } from './api-reads';`
- No function body changed. Only import lines, the added `export` keywords, and two
  Prettier re-wraps (`approverNamesForRow`, `managedGroupIdsForUser`, whose one-line
  form passes 100 columns once `export ` is prepended).
- `api-reads.ts` no longer imports from `./api`, so the short-lived import cycle is gone.

### Files changed

- `apps/server/src/approvals/api.ts`
- `apps/server/src/approvals/api-reads.ts` (new)
- `work/T-1118-split-approvals-api.md` (this file)

### Size (`wc -l`)

```
old: apps/server/src/approvals/api.ts   562
new:
  368  apps/server/src/approvals/api.ts
  222  apps/server/src/approvals/api-reads.ts
```

Both files are under 400.

### Commands run

- `pnpm install` — "Done in 14s", 1172 packages added, one mobile peer warning
  (`@types/react-dom` unmet peer `@types/react@^19.3.0`). No lockfile change.
- `grep -rn "ApprovalsApiDependencies\|ApprovalsRouteLogger" apps/server/src` — only
  `api.ts` (imports + re-export + uses) and `api-reads.ts` (definitions); no other
  importer to update.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/approvals/rules.test.ts src/approvals/service.test.ts` — **2 files passed,
  77 tests passed** (9.53s).
- `pnpm gate` (repo root) — **GATE PASS** (summary below). One earlier gate run failed
  at lint with `no-unused-vars` on a stale `ServerDatabase` import in `api.ts`; I
  removed it and the final run below is green.

### Gate

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.0s)
PASS  lint  (0.6s)
PASS  typecheck  (2.2s)
PASS  effect  (0.4s)
PASS  tests @zilar/server  (9.5s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The 3 changed files are the two sources plus this task file. Nothing outside the
Allowed files. `api-reads.ts` classifies as `effect` (it imports `Effect`/`SqlClient`
as values), so no `effect-plain` marker was needed.

### Deviations from the spec

- `api-reads.ts` holds more than the read helpers (the wire mappers and the two
  interfaces), per the lead's follow-up; this is what brings `api.ts` under 400.
- `approverNamesForRow` and `managedGroupIdsForUser` signatures are wrapped over
  several lines (added `export ` pushed them past 100 columns). Bodies unchanged.

## Review (written by Claude)

**Lead, 2026-10-11: approved after one lead reply. The pre-review is clean, with 1 nit (comment wording).**
- **The split:** `approvals/api.ts` goes from 562 to 367 lines. `approvals/api-reads.ts` (222) holds the read helpers, `toWireApproval`/`toWireRule` and the two dependency interfaces, which `api.ts` re-exports. `createApprovalsApi` and its handlers are unchanged.
- **The lead's line check:** the lines removed from `api.ts` that are missing from `api-reads.ts` are only import lines and the declarations that gained `export`.
- **Tests:** the lead ran `approvals/rules.test.ts` and `approvals/service.test.ts` on the branch: 77 green. The gate passed.
