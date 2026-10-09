---
id: T-0791
title: "S1: AI gateway part 1 on Effect — gateway/budget.ts, gateway/memory.ts, gateway/group-ingest.ts, gateway/live.ts and agents/memory/compactor.ts (async/try/fire-and-forget as Effects behind the same factory interfaces); gateway suite unchanged"
status: merged
milestone: M5
branch: task/T-0791-gateway-s1
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0791 (S1): AI gateway part 1 on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 2 of `docs/audit/effect-100-plan.md` (task S1), accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files** (`apps/server/src/agents/`), with their lines, signals and first non-Effect line from `pnpm effect:map` on main:
  - `gateway/budget.ts` (172, H1 W4): `createBudgetGate(ctx)` at line 17; first hit `async function checkDailyLimit`;
  - `gateway/memory.ts` (145, H1 W4): `createMemoryRunner(ctx)` at line 33; first hit `async function loadMemoryContext`;
  - `gateway/group-ingest.ts` (186, H1 W4): `createGroupIngest(ctx)` at line 35; first hit `void pumpRoom(session, roomJid).catch(...)`;
  - `gateway/live.ts` (229, H1 W4): `createLiveSession(ctx)` at line 20; first hit `return Promise.resolve({ id: '' })`;
  - `memory/compactor.ts` (66, H1): `export async function compactMemory` at line 42, tested in `memory/compactor.test.ts`.
- **Their callers** are the other gateway modules and `agents/gateway.ts` (find them with `git grep`). Those are converted in S2-S4, so keep the factory return types (Promise-returning methods) unchanged.

### The server conversion pattern
- **The goal:** after this task each listed file imports Effect for its async work. Async control flow, try/catch, timers and fire-and-forget calls are written as Effects. A Promise edge stays where a caller outside this task still awaits a function (a Tier B edge, `docs/EFFECT_GUIDE.md:12-32`): implement it as an Effect and export `Effect.runPromise(...)` or keep the Promise-typed factory method.
- **Fire-and-forget** (`void x().catch(log)`) becomes `Effect.runFork(effect.pipe(Effect.catchCause(logCause)))` with the same log message and fields; never swallow silently. Timers become forked `Effect.sleep` fibers that are interrupted instead of `clearTimeout`. See the finished pattern in `apps/server/src/drafts/hub.ts` (T-0764) and `packages/xmpp-core/src/timers.ts` (T-0769).
- **Errors:** the same error classes and messages reach the same callers; logs keep the same messages, fields and redaction (no secrets, no message bodies). Check how `runPromise` surfaces failures in 4.0.2 (it rejects with the squashed cause, so a failed typed error reaches the caller as the same instance).
- **The order of side effects and the timing are identical.** The gateway runs AI turns in live chats: when in doubt, keep the structure and change only the mechanics.
- **Tests:** the gateway suite must pass unchanged: `apps/server/src/agents/gateway.test.ts` (7,242 lines) plus `rounds.test.ts`, `context.test.ts`, `reply.test.ts`, `reply.effect.test.ts`, `stream.test.ts` and `tools.test.ts`. `integration.test.ts` is gated and is not run. Run `pnpm --filter @zilar/server test --maxWorkers=4 --reporter=dot src/agents` three times to catch flakiness.
- **Check APIs in `node_modules/effect/dist/*.d.ts`** (Effect 4.0.2), not from memory.

### What to build
Convert the five files with the pattern.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.7, `apps/server/src/drafts/hub.ts`, the five files, `apps/server/src/agents/gateway/contracts.ts`, and how `apps/server/src/agents/gateway.ts` wires them.

### Allowed files
`apps/server/src/agents/gateway/budget.ts`, `apps/server/src/agents/gateway/memory.ts`, `apps/server/src/agents/gateway/group-ingest.ts`, `apps/server/src/agents/gateway/live.ts`, `apps/server/src/agents/memory/compactor.ts`, `work/T-0791-gateway-s1.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=4 --reporter=dot src/agents
pnpm gate
```
Paste the three `src/agents` run counts and each file's `pnpm effect:map` kind into the Report.

### Acceptance
- The five files are Effect files; their factory interfaces are unchanged.
- The gateway suite passes unchanged, 3 of 3 runs.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Converted the five files to Effect. Every factory interface and every returned method keeps its Promise type; `Effect.runPromise` sits at each public method, so `dm-turn.ts`, `group-turn.ts`, `tool-exec.ts` and `gateway.ts` are untouched. Effect 4.0.2 APIs checked in `node_modules/effect/dist` (`runFork` evaluates the first step synchronously, `Effect.promise` keeps a rejection or a synchronous throw as the original value, `runPromise` rejects with the squashed cause).

- `agents/memory/compactor.ts`: new exported `compactMemoryEffect` (`Effect.fnUntraced`, DB and `complete` calls lifted with plain `Effect.promise`); `compactMemory` is now `Effect.runPromise(compactMemoryEffect(input))`. A failing `complete` still rejects with the original error (existing test passes unchanged).
- `gateway/budget.ts`: `checkDailyLimit`, `sendBudgetWarnings` and `checkDmRoundGate` are `Effect.fnUntraced` programs. Each old `try/catch` is `Effect.promise(...)` plus `Effect.catchDefect`, through a local `attempt` helper that logs with the same message and fields and answers a private `FAILED` symbol (so a resolved value can never be mistaken for a failure). `checkDmRoundGate` still swallows a failed usage read silently (null, as before). The three methods return Promises via `runPromise`; `utcDay` is unchanged.
- `gateway/memory.ts`: `loadMemoryContext` is an Effect (index failure and read failure each logged with the same messages; `Promise.all` became `Effect.all` with `concurrency: 'unbounded'`). `startCompaction` stays sync and fire-and-forget.
- `gateway/group-ingest.ts`: `pumpRoom` is `pumpRoomEffect` (busy flag set, loop, `Effect.ensuring` releases `roomBusy`), exported as a Promise function through `runPromise`.
- `gateway/live.ts`: `liveSendMessage` uses `liveSendMessageEffect` (`Effect.succeed({ id: '' })` when the session is not live); `reportProgress`, `clearProgress` and `postToChat` are Effect programs behind Promise methods. `sessionIsLive`, `liveSendTyping` and `liveMarkDisplayed` are sync and unchanged.

### Fire-and-forget, timer and try sites
- `memory.ts` `startCompaction` (`void (async () => { try ... finally ... })()`): now `Effect.runFork(compactionEffect(...).pipe(Effect.catchDefect(log 'AI memory compaction failed'), Effect.ensuring(delete from runningCompactions)))`. The set entry is still added synchronously before the fork and removed after the log. It uses the `compactMemoryEffect` directly.
- `group-ingest.ts` `void pumpRoom(...).catch(log)`: now `Effect.runFork(pumpRoomEffect(...).pipe(Effect.catchDefect(log 'AI group pump failed')))`, same message and fields (`err` redacted, `aiId`).
- No timer in these five files (the `setTimeout` code of the gateway lives in files for S2 to S4).
- try/catch: budget.ts (4 blocks + the silent one), memory.ts (3), live.ts (2) all became `Effect.promise` + `catchDefect` with the same log lines.

### effect:map after the change (`pnpm effect:map`, data.json)
All five are `effect`, tier B false, no signals left: `gateway/budget.ts`, `gateway/memory.ts`, `gateway/group-ingest.ts`, `gateway/live.ts`, `memory/compactor.ts`. Before: all five were `needs-effect` (H1 W4, compactor H1).

### Commands and results
- Before (untouched code): `pnpm --filter @zilar/server test --maxWorkers=4 --reporter=dot src/agents`: 16 files passed, 1 skipped; 431 passed, 1 skipped (432).
- Rerun after each file (compactor, budget, memory, group-ingest, live): all 431 passed, 1 skipped.
- Final 3 runs: 431 passed | 1 skipped (432), 431 passed | 1 skipped (432), 431 passed | 1 skipped (432). No test file was changed.
- `pnpm gate`: `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.

### Behaviour differences
- `liveSendMessage` is no longer a plain function returning the core's promise: if `core.sendMessage` threw synchronously (not by rejecting) the old code threw synchronously; now the returned promise rejects with the same error. The real `XmppCore.sendMessage` is async, so nothing changes in practice.
- `loadMemoryContext` reads facts and the memory block with `Effect.all` concurrently instead of `Promise.all`. Both calls still start together. If one fails, the other fiber is interrupted, but the underlying query is not aborted (no signal is passed), so the outcome is the same: one warning, the empty memory context.
- Each `runPromise` adds a few microtask ticks before a method settles, compared to a bare `await`. No test depends on it (3 of 3 green).
- Otherwise none: same order of side effects, same log messages and fields, same error values reaching callers.

### Open questions
None. One point I checked rather than assumed: I used `Effect.catchDefect` (as the guide says) instead of `Effect.catchCause`, because these Promise calls fail only as defects and `catchCause` would also log a normal interruption.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Sonnet 5.5. The lead reviewed the Report.
- **The files:** all five are Effect files behind the same factory interfaces.
- **Fire-and-forget sites:** they use `runFork` with `catchDefect` and the same log text. `catchDefect` instead of `catchCause` is correct, because it does not log interruption (EFFECT_GUIDE line 169).
- **Results:** `src/agents` gave 431 passed and 1 skipped before and in all 3 runs after; the gate passed.
