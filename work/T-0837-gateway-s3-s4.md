---
id: T-0837
title: "S3 + S4: AI gateway part 3 and 4 on Effect — gateway/dm-turn.ts, gateway/tool-exec.ts, gateway/group-turn.ts and agents/gateway.ts (pumps, turns and fire-and-forget as Effects behind the same factories); gateway suite unchanged"
status: todo
milestone: M5
branch: task/T-0837-gateway-s3-s4
model: auto
effort: default
depends_on: [T-0792, T-0801]
estimate: 1 day
---

# T-0837 (S3 + S4): AI gateway parts 3 and 4 on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 2 of `docs/audit/effect-100-plan.md` (rows S3 and S4, lines 342-343), accepted by Julio on 2026-10-09; one worker per chain. S1 (T-0791) and S2 (T-0792) are merged. The plan flags "Julio: AI replies in live chats", so Julio checks a DM reply and a group reply live before the next deploy.

### Verified facts (do not re-derive; re-read lines before editing)
- **`apps/server/src/agents/gateway/dm-turn.ts`** (309 lines): `createDmTurn(ctx)` at line 56, `async function pumpSession` at 80 (try at 85), `async function runSessionTurn` at 95.
- **`apps/server/src/agents/gateway/tool-exec.ts`** (368 lines): `createToolExec(ctx)` at line 53, `return async (call) => …` at 73, try at 175, and `void pumpRoom(worker, context.roomJid).catch(...)` at 220.
- **`apps/server/src/agents/gateway/group-turn.ts`** (528 lines): `createGroupTurn(ctx)` at line 98, `async function runGroupSessionTurn` at 121, `await loadActiveAi(...).catch(() => null)` at 128, and `await disconnectAi(...).catch(() => undefined)` at 130.
- **`apps/server/src/agents/gateway.ts`** (311 lines): it imports `createXmppCore` from `@zilar/xmpp-core` (line 1); `createAgentGateway(...)` is at 54; `const createCore = deps.createCore ?? createXmppCore` is at 62; `void pumpSession(session).catch(...)` is at 291.
- **The model to follow** is S1 and S2, in `gateway/memory.ts`, `group-ingest.ts`, `sessions.ts`, `lifecycle.ts` and `listener.ts` (T-0791, T-0792): `runFork` with `catchDefect` and the same log text, `Effect.ensuring` for the busy flags, timers as fibers, and the factory methods keeping their Promise types via `Effect.runPromise`.
- **`XmppCoreEffect`** (T-0801) is exported, but the gateway tests inject `deps.createCore` with fake Promise cores. So **keep the Promise `XmppCore` seam** in this task; moving the gateway to `XmppCoreEffect` is a later step (X8). Say in the Report whether it would be simple.
- **The tests:** `apps/server/src/agents/gateway.test.ts` (7,242 lines), plus `rounds`, `context`, `reply`, `reply.effect`, `stream` and `tools` in `apps/server/src/agents/`, must pass unchanged. `src/agents` had 431 passed and 1 skipped after S2.

### What to build, in two commits
1. **S3:** `dm-turn.ts`, `tool-exec.ts` and `gateway.ts`.
2. **S4:** `group-turn.ts`.

Keep identical: the order of side effects, every log message and its fields, the error values, the round limits, the streaming order of the AI's reply, the busy flags, and when a turn starts.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the four files, the S1 and S2 files named above, `apps/server/src/agents/gateway/contracts.ts`, and the parts of `gateway.test.ts` that drive DM and group turns.

### Allowed files
`apps/server/src/agents/gateway/dm-turn.ts`, `apps/server/src/agents/gateway/tool-exec.ts`, `apps/server/src/agents/gateway/group-turn.ts`, `apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway/contracts.ts`, `work/T-0837-gateway-s3-s4.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server test --maxWorkers=4 --reporter=dot src/agents
pnpm --filter @zilar/server typecheck
```
Run the tests 3 times after each commit.

### Acceptance
- **The files:** all four are `effect` in `pnpm effect:map`, with no `async`, `try` or `.catch(` of their own (a Tier B Promise edge is fine).
- **The tests:** the gateway suite passes unchanged, 3 of 3 runs, and the typecheck is clean.
- **Scope:** only Allowed files change.

---

## Report (written by the worker when done)

## Review (written by Claude)
