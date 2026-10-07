---
id: T-0517
title: "Agents G3: move loadMemoryContext and startCompaction (+ runningCompactions) out of createAgentGateway into agents/gateway/memory.ts; zero behaviour change"
status: todo
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

## Review (written by Claude)
