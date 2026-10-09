---
id: T-0791
title: "S1: AI gateway part 1 on Effect — gateway/budget.ts, gateway/memory.ts, gateway/group-ingest.ts, gateway/live.ts and agents/memory/compactor.ts (async/try/fire-and-forget as Effects behind the same factory interfaces); gateway suite unchanged"
status: todo
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

## Review (written by Claude)
