---
id: T-1461
title: "AI spend: the budget gate waits for the AI's in-flight usage writes (bounded) before it reads ai_usage, so a fast tool loop or back-to-back turns can't run on stale spend (AI-15 remainder)"
status: merged
milestone: M5
branch: task/T-1461-await-pending-spend
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1461: The budget reads settled spend

## Spec (written by Claude, do not edit)

### Why
This is the remainder of AI-15 in `docs/audit/findings-sweep-server.md`. Every model call's spend is written fire and forget, while the budget gate reads `ai_usage` before each turn and round. A fast loop can therefore read spend that is missing the last call or calls, and run past a limit. This is money, a crucial area.

### Facts (the lead read them on main, 2026-10-15)
- **The spend write:** `recordUsage(deps, aiId, provider, model, usage, now)` (`apps/server/src/ais/usage-store.ts:29-63`, 63 lines):
  - it awaits `ensureModelPrices` (a network fetch on a cold process), then runs one `INSERT … ON CONFLICT` upsert;
  - it never rejects (errors are logged).
- **Fire-and-forget callers** (`void recordUsage(...)`):
  - `apps/server/src/agents/gateway/group-turn-body.ts:330`;
  - `apps/server/src/agents/gateway/dm-turn.ts:333`;
  - `apps/server/src/agents/gateway/memory.ts:126`.
- **The read:** the budget gate reads spend through `usageFor(aiId)` (`apps/server/src/agents/gateway/budget.ts:93-100`, which calls `getAiUsage`). It is used at `:118` (the turn gate) and `:257` (the round gate). `budget.ts` is 353 lines.

### What to build
1. **In `apps/server/src/ais/usage-store.ts`:**
   - track every in-flight `recordUsage` promise per AI in a module-level `Map<string, Set<Promise<void>>>`: add it on start, remove it when it settles;
   - export `settlePendingUsage(aiId: string, timeoutMs = 3000): Promise<void>`, which awaits that AI's current in-flight writes, or the timeout, whichever comes first. It never rejects.
   - The callers stay fire and forget; their code does not change.
2. **In `apps/server/src/agents/gateway/budget.ts`:** `usageFor` awaits `settlePendingUsage(aiId)` before `getAiUsage`. Nothing else changes: the gate's limits, notices and fail-closed behaviour stay as they are.
3. **Size:** both files stay at 400 lines or fewer.

### Tests (money)
In `apps/server/src/ais/usage-store.test.ts`:
1. A `settlePendingUsage` started while a write is in flight resolves only after that write's upsert is done. Use a deferred db or a stubbed `runSql` for ordering.
2. It resolves within the timeout when a write hangs.
3. It resolves at once when nothing is pending.

### Allowed files
- `apps/server/src/ais/usage-store.ts`, `apps/server/src/ais/usage-store.test.ts`
- `apps/server/src/agents/gateway/budget.ts`
- `work/T-1461-await-pending-spend.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/ais/usage-store.test.ts src/agents/gateway --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes and the tests pass.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/ais/usage-store.ts`: added a module-level `Map<string, Set<Promise<void>>>`
  (`pendingUsage`) that tracks every in-flight `recordUsage` promise per AI. `recordUsage`
  is no longer `async`; it calls a new inner `writeUsage` and tracks the returned promise,
  which is dropped when it settles (both outcomes). Exported
  `settlePendingUsage(aiId, timeoutMs = 3000)`: it returns at once when nothing is pending,
  otherwise awaits `Promise.allSettled` of the current in-flight writes versus a timeout,
  whichever first, and never rejects. The callers stay fire and forget; the three
  `void recordUsage(...)` sites are unchanged.
- `apps/server/src/agents/gateway/budget.ts`: `usageFor` now `await settlePendingUsage(aiId)`
  before `getAiUsage`. Limits, notices and fail-closed behaviour are unchanged.
- `apps/server/src/ais/usage-store.test.ts`: added a `settlePendingUsage` describe with the
  three required tests. `runSql` is stubbed via `vi.mock('../effect/sql')` (base
  implementation is the real one; `testSql` does not go through `runSql`, so the real test
  database is untouched).

### Files changed
- `apps/server/src/ais/usage-store.ts` (only source change: tracking + `settlePendingUsage`)
- `apps/server/src/ais/usage-store.test.ts` (3 new tests)
- `apps/server/src/agents/gateway/budget.ts` (await settle before the read)
- `work/T-1461-await-pending-spend.md` (this Report, status)

### Commands and results
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/usage-store.test.ts`
  — 1 file passed, 8 tests passed (5 existing + 3 new).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/budget.test.ts`
  — 1 file passed, 4 tests passed.
- `pnpm gate` (repo root) — `GATE PASS`:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (1.3s)
  PASS  lint  (1.0s)
  PASS  typecheck  (5.4s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/server  (16.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  First gate run FAILed lint on `unicorn(no-useless-spread)` for `Promise.allSettled([...inFlight])`;
  fixed by passing the `Set` directly (`Promise.allSettled(inFlight)`), then re-ran to GATE PASS.

### Deviations from the spec
- The task's Checks line is `pnpm --filter @zilar/server exec vitest run src/ais/usage-store.test.ts src/agents/gateway --reporter=dot`,
  which has no `--maxWorkers` cap. AGENTS.md forbids `vitest run` without the worker cap on
  this shared machine, so I ran the two touched test files individually with
  `--maxWorkers=2 --reporter=dot` (commands above) and let `pnpm gate` run the package tests.
- No other deviations. No new dependencies.

### Problems / open questions
- None. The tracking map is in-process only, matching the fire-and-forget writes; a write
  that hangs is bounded by the 3 s timeout, so a turn is never held open past it.

### Security checklist
- No secrets logged; no new queries, routes or deletes; nothing changed in the permission or
  audit paths. `settlePendingUsage` only awaits existing promises and never rejects.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 1.
- `recordUsage` stays fire and forget but is tracked per AI.
- `settlePendingUsage` waits for the in-flight writes, bounded at 3 s, and never rejects.
- The budget gate's `usageFor` awaits it before reading `ai_usage`.
- The usage-store and gateway tests (43) pass locally.
