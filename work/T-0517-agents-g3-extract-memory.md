---
id: T-0517
title: "Agents G3: move loadMemoryContext and startCompaction (+ runningCompactions) out of createAgentGateway into agents/gateway/memory.ts; zero behaviour change"
status: merged
milestone: M5
branch: task/T-0517-agents-g3-extract-memory
model: auto
effort: low
depends_on: [T-0512]
estimate: 0.5 day
---

# T-0517: agents G3, extract memory context and compaction

## Spec (written by Claude, do not edit)

### Why
Plan `docs/audit/effect-agents-plan.md` §3, "G3". G1 (T-0512, merged) started the split; G2 (T-0516) moves the budget gate **in parallel**. **This is a pure extraction: no logic change and no Effect.**

### Verified facts (do not re-derive; G1 moved the lines, so find these by name inside `createAgentGateway` in `apps/server/src/agents/gateway.ts`)
- **`async function loadMemoryContext(input: { aiId, chatKey, archiveOwner, scope, aiBareJid, ownerName?, now, virtualKey? }): Promise<MemoryContext>`** indexes the chat when `deps.archive` is set, then reads the pinned facts and the memory block. **It never throws and never logs text.**
- **`const runningCompactions = new Set<string>()`** plus **`function startCompaction(session, chatKey, virtualKey): void`**:
  - the key is `` `${session.aiId}:${chatKey}` ``, and it returns early when one is already running;
  - **a fire-and-forget `void (async () => …)()`:** if `(await checkDmRoundGate(session)) !== null` it returns; it calls `compactMemory({ db, aiId, chatKey, complete: (prompt) => completeChat({...}) })`, logs `'AI memory compacted'` when `built > 0`, and on error logs `'AI memory compaction failed'` with `toRedactedError(error, secretsFor(virtualKey))`;
  - `finally` deletes the key.
- **What they close over:** `deps` (`db`, `archive`, `fetchImpl`), `logger`, `baseUrl`, `modelNameForAi`, `secretsFor`, `nowMs`, `toRedactedError`, and **`checkDmRoundGate`, which G2 (T-0516) is moving to `agents/gateway/budget.ts` at the same time.** Take it as an injected callback, so the two tasks don't depend on each other.
- **The pinning tests** (`apps/server/src/agents/gateway.test.ts`, by name): "reads pinned facts into a second system message", "still replies when the memory index fails, logging a redacted warning", "summarises a pending block after the reply…", "skips compaction when the daily limit is crossed…".

### What to build
1. **Create `apps/server/src/agents/gateway/memory.ts`** exporting `createMemoryRunner(ctx)`. `ctx` holds exactly what the two functions close over, with `checkDmRoundGate` as a callback. It returns `{ loadMemoryContext, startCompaction }`, and `runningCompactions` lives inside the runner, one per gateway.
2. **In `createAgentGateway`,** create the runner once and replace the two functions with its methods. **Every call site is unchanged** (the same arguments, and `startCompaction` is still not awaited).
3. **Move the bodies verbatim:** no logic edits and no renames.
4. **Tests:** every `apps/server/src/agents/**/*.test.ts` passes **unchanged**.
5. **Merge note:** T-0516 edits other regions of `gateway.ts` in parallel. Keep your edits to your two functions, the creation line and the imports.

### Read first
`AGENTS.md`, `docs/audit/effect-agents-plan.md` §1.9, §2 and §3 "G3", `apps/server/src/agents/gateway.ts` (the two functions and their call sites), `apps/server/src/agents/gateway/contracts.ts`.

### Allowed files
`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway/memory.ts`, `work/T-0517-agents-g3-extract-memory.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents
pnpm gate
```

### Acceptance
- The memory context and compaction live in `agents/gateway/memory.ts`, moved verbatim.
- The agents tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- Created `apps/server/src/agents/gateway/memory.ts` exporting `createMemoryRunner(ctx)`.
  It holds exactly what the two functions close over: `deps` (`db`, `archive`, `fetchImpl`),
  `logger`, `baseUrl`, `modelNameForAi`, `secretsFor`, `nowMs`, `toRedactedError` and
  `checkDmRoundGate` (injected as a callback, so this task does not depend on T-0516).
  `runningCompactions` now lives inside the runner, one `Set` per gateway. Both function
  bodies were moved verbatim; only the enclosing function changed.
- In `createAgentGateway` the two function declarations were replaced by one creation line
  `const { loadMemoryContext, startCompaction } = createMemoryRunner({ ... })`. Every call
  site is unchanged (same arguments; `startCompaction` is still not awaited).
- Dropped the imports that are now only used by the moved code (`compactMemory`,
  `indexMemory`/`MemoryScope`, `listFacts`, `renderMemoryBlock`, `MemoryContext`) and added
  the `createMemoryRunner` import. `toRedactedError` and `modelNameForAi` stay imported in
  `gateway.ts` because other regions still use them.

### Files changed
- `apps/server/src/agents/gateway.ts` (imports, runner creation, removed two function bodies)
- `apps/server/src/agents/gateway/memory.ts` (new)
- `work/T-0517-agents-g3-extract-memory.md` (this task file)

### Commands run
- `pnpm install` → Done, 0 errors (peer-dependency warning only).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents` →
  Test Files 16 passed | 1 skipped (17); Tests 430 passed | 1 skipped (431). Agents tests unchanged.
- `pnpm gate` (from repo root) →
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Rebase onto T-0516 (G2)
- Main gained `gateway/budget.ts` (`createBudgetGate`) while this branch moved the memory
  functions. Conflict in `gateway.ts` resolved by keeping both: `budgetGate` is created
  first, then `createMemoryRunner({ ..., checkDmRoundGate: budgetGate.checkDmRoundGate })`.
  Removed the now-duplicated inline `startCompaction`/`runningCompactions` and inline
  `checkDmRoundGate`, and dropped the `getAiUsage`/`AiUsage` plus `listFacts`/
  `renderMemoryBlock` imports. Imports keep both `./gateway/budget` and `./gateway/memory`.
  `status: merged` kept.
- Post-rebase `pnpm install` → Done, 0 errors.
- Post-rebase `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents` →
  Test Files 16 passed | 1 skipped (17); Tests 430 passed | 1 skipped (431).
- Post-rebase `pnpm gate` →
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- None. Pure extraction, no logic change, no Effect, no new dependencies, no test edits.

### Open questions
- None.

## Review (written by Claude)

Approved (lead, 2026-10-08). G3 is a pure extraction: loadMemoryContext, startCompaction and runningCompactions moved verbatim into agents/gateway/memory.ts (createMemoryRunner), with checkDmRoundGate injected. The agents tests are unchanged. Pre-review clean. It may need a rebase after T-0516 (both edit gateway.ts).
