---
id: T-2155
title: "Server: merge back small sibling splits (AI turn budget/send/stop into turn.ts, push api-util, AI usage store, health status) — fewer files and imports; no behaviour change"
status: merged
milestone: M5
branch: task/T-2155-server-merge-splits
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2155: Merge small server sibling splits back into their base file

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: 400 lines is a soft limit, and files split only for size may be merged back when that saves lines. Each row is a base file plus small `<base>-<part>` siblings that are imported together. The lead listed them at `a11878682`. Every merged file stays under 650 lines.

| # | Merge these | Into | Lines today |
| --- | --- | --- | --- |
| 1 | `apps/server/src/agents/turn-budget.ts`, `turn-send.ts`, `turn-stop.ts` | `apps/server/src/agents/turn.ts` | 12 + 52 + 33 into 51 |
| 2 | `apps/server/src/push/api-util.ts` | `apps/server/src/push/api.ts` | 26 into 65 |
| 3 | `apps/server/src/ais/usage-store.ts` | `apps/server/src/ais/usage.ts` | 125 into 103 |
| 4 | `apps/server/src/health-status.ts` | `apps/server/src/health.ts` | 64 into 123 |

Row 1: `turn-send.ts` and `turn-stop.ts` import only types from `./dm-turn` and `./group-turn`, and `turn.ts` already imports from `./turn-stop`. Merging adds no runtime import cycle.

### Steps
For each row:
1. Move the siblings' code into the base file (types first, then helpers, then exports). Keep each file's `// effect-plain:` directive once, and every "why" comment.
2. Delete the siblings.
3. Point every importer at the base file. Where a file imported from both, merge them into one import.
4. **Cycles.** If a merge would create a runtime import cycle (a value import going both ways), skip that row and say why.

### Rules
- No behaviour change: the same SQL, log texts, limits and exported names.
- **Tests.** Change only the import or `vi.mock` path; no new tests.

### Allowed files
- `apps/server/src/agents/dm-tool-turn.ts`
- `apps/server/src/agents/dm-turn.ts`
- `apps/server/src/agents/gateway-group.test.ts`
- `apps/server/src/agents/gateway/budget.ts`
- `apps/server/src/agents/gateway/dm-turn-input.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway/memory.ts`
- `apps/server/src/agents/gateway/turn-rounds.test.ts`
- `apps/server/src/agents/group-turn.ts`
- `apps/server/src/agents/tool-rounds.ts`
- `apps/server/src/agents/turn-budget.ts`
- `apps/server/src/agents/turn-send.ts`
- `apps/server/src/agents/turn-stop.ts`
- `apps/server/src/agents/turn.ts`
- `apps/server/src/ais/usage-store.test.ts`
- `apps/server/src/ais/usage-store.ts`
- `apps/server/src/ais/usage.ts`
- `apps/server/src/health-status.ts`
- `apps/server/src/health.test.ts`
- `apps/server/src/health.ts`
- `apps/server/src/main.test.ts`
- `apps/server/src/push/api-handlers.ts`
- `apps/server/src/push/api-test.ts`
- `apps/server/src/push/api-util.ts`
- `apps/server/src/push/api.ts`
- `apps/server/src/push/component.ts`
- `apps/server/src/push/delivery.ts`
- `apps/server/src/startup/components.ts`
- `apps/server/src/startup/lifecycle.ts`
- `work/T-2155-server-merge-splits.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, including the server tests it runs.
- Product lines go down (`git diff main --numstat -- apps/server`, new files included); give the net in the Report.
- The Report lists each row: merged (lines saved) or skipped (why).

---

## Report (written by the worker when done)

### What I did

| # | Row | Result |
| --- | --- | --- |
| 1 | `turn-budget.ts`, `turn-send.ts`, `turn-stop.ts` → `turn.ts` | **Merged**, 9 lines saved (148 → 139 across the four files). Deleted the three siblings and repointed `dm-tool-turn.ts`, `dm-turn.ts`, `group-turn.ts`, `tool-rounds.ts`, `gateway-group.test.ts` and `gateway/turn-rounds.test.ts`. The single `// effect-plain:` directive and every why-comment moved over. |
| 2 | `push/api-util.ts` → `push/api.ts` | **Skipped: runtime import cycle.** `api.ts` already imports `createPushGroupLayer` (a value) from `api-handlers.ts`; after the merge `api-handlers.ts` would import `STRICT_DECODE`, `TEST_WAKE_CHAT_ID` and `createRequirePush` (values) from `api.ts`, so the value imports go both ways. Merging into `api-handlers.ts` instead would avoid the cycle, but the spec names `api.ts`. |
| 3 | `ais/usage-store.ts` → `ais/usage.ts` | **Skipped: needs a file outside Allowed files.** `budget.test.ts` does `vi.mock('../../ais/usage', …)` with only `getAiUsage` in the factory. After the merge `budget.ts` imports `settlePendingUsage` from that same mocked module, so it is undefined. I ran the merge and `budget.test.ts`: 2 failed / 4 passed (the two monthly-limit tests got the daily-limit notice instead of the monthly one). `budget.test.ts` is not in Allowed files, so I reverted this row. |
| 4 | `health-status.ts` → `health.ts` | **Merged**, 1 line saved (187 → 186). Deleted the sibling and repointed `health.test.ts`, `main.test.ts`, `startup/lifecycle.ts`, `startup/components.ts`, `push/delivery.ts`, `push/component.ts`. |

No behaviour, SQL, log text, limit or exported name changed. Only import paths changed in tests.

### Checks run

- `pnpm install` — Done in 18.7s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-group.test.ts` — 1 file passed, 21 tests passed.
- `… src/agents/gateway/turn-rounds.test.ts` — 1 file passed, 5 tests passed.
- `… src/ais/usage.test.ts src/ais/usage-store.test.ts` — 2 files passed, 19 tests passed.
- `… src/health.test.ts src/main.test.ts` — 2 files passed, 2 tests passed.
- `… src/agents/gateway-stop.test.ts src/agents/turn-stop-gate.test.ts src/agents/dm-turn.fake-provider.test.ts src/agents/group-turn-card.test.ts` — 4 files passed, 16 tests passed.
- `… src/agents/gateway/budget.test.ts` — run only while testing row 3 (2 failed / 4 passed); with row 3 reverted it passes in the gate.
- `pnpm gate` — summary:
  ```
  gate: 19 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.3s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.5s)
  PASS  effect  (0.9s)
  PASS  build @zilar/server  (0.4s)
  PASS  tests @zilar/server  (15.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  WARN  size: apps/server/src/startup/components.ts: 639 lines (main 639); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```

### Notes for the lead

- `git diff main --numstat -- apps/server` totals: 183 added, 185 deleted, **net −2 product lines** across the 18 changed files (deletions included). The saving is small because each sibling's code mostly moved one-for-one; the win is 4 fewer files and fewer imports.
- To unblock row 3, add `apps/server/src/agents/gateway/budget.test.ts` to Allowed files (one extra line in its `vi.mock` factory: `settlePendingUsage: async () => {}`). The merge itself is mechanical and I verified the rest of the suite with it in place.
- `startup/components.ts` keeps its pre-existing 639-line soft-limit warning; it was touched only to repoint one import.

## Review (written by Claude)

Approved; the pre-review was clean. Net −2, four files fewer:
- `agents/turn-budget`, `turn-send` and `turn-stop` merged into `agents/turn.ts` (139 lines), with one combined `effect-plain:` directive;
- `health-status` merged into `health.ts`.

**Two rows skipped, both sound:**
- `push/api-util`: merging creates a runtime import cycle through `api-handlers`.
- `ais/usage-store`: a `vi.mock('../../ais/usage')` factory outside scope would have to grow.

The gate ran the server tests. The lead runs the route probe after the push.
