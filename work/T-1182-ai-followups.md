---
id: T-1182
title: "AI follow-ups from T-1167/T-1168: a plain (no-tools) DM reply cut by max_tokens also says so; a listener wake cannot start a room turn while the gateway drains; the drain test asserts no restart notice"
status: merged
milestone: M5
branch: task/T-1182-ai-followups
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1182: AI follow-ups

## Spec (written by Claude, do not edit)

### Why
These come from the reviews of T-1167 and T-1168.
1. **The plain DM path drops the cut-short note:** `completeChat` (`apps/server/src/agents/dm-turn.ts:30-41`) returns `result.content` without `cutShortSuffix(result.finishReason)`. The tool paths already append it (`apps/server/src/agents/dm-tool-turn.ts:136`, `apps/server/src/agents/group-turn.ts:329`; the helper is `apps/server/src/agents/replies.ts:19-21`).
2. **The listener can start a turn mid-drain:** `wakeListenerAis` (`apps/server/src/agents/gateway/listener.ts:213-230`) gates only on `sessionIsLive`, which stays true during the T-1168 drain. A listener wake can start a room turn while the gateway stops. `handleIncoming` already refuses with `lifecycle.isStarted()` (`apps/server/src/agents/gateway.ts`, T-1168).
3. **The drain test is incomplete:** `apps/server/src/agents/gateway-drain.test.ts` checks that the reply arrived, but not that the restart notice (`AI_RESTART_REPLY`) was **not** sent.

### What to build
1. **`dm-turn.ts`:** `completeChat` returns `result.content + cutShortSuffix(result.finishReason)`.
2. **`listener.ts`:** the listener context gets an `isStarted: () => boolean`, wired where `gateway.ts` builds it from `lifecycle.isStarted`. `wakeListenerAis` skips every wake when it is false.
3. **`gateway-drain.test.ts`:** also assert that no sent message equals `AI_RESTART_REPLY`.

### Read first
`AGENTS.md`, `apps/server/src/agents/dm-turn.ts`, `apps/server/src/agents/replies.ts`, `apps/server/src/agents/gateway/listener.ts`, `apps/server/src/agents/gateway.ts` and `apps/server/src/agents/gateway-drain.test.ts`.

### Allowed files
`apps/server/src/agents/dm-turn.ts`, `apps/server/src/agents/gateway/listener.ts`, `apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway-drain.test.ts`, `work/T-1182-ai-followups.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway-drain.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.

---

## Report (written by the worker when done)

### What I did
1. **`dm-turn.ts`:** imported `cutShortSuffix` from `./replies`; `completeChat` now returns `result.content + cutShortSuffix(result.finishReason)`, so a plain no-tools DM reply cut at `max_tokens` carries the same cut-short note as the tool paths.
2. **`gateway/listener.ts`:** added `isStarted: () => boolean` to `RoomListenerContext` and destructured it; `wakeListenerAis` returns early when `isStarted()` is false, so a listener wake cannot queue a room turn while the gateway drains. **`gateway.ts`:** passed `isStarted: () => lifecycle.isStarted()` into `createRoomListener` (a lazily-read arrow, TDZ-safe exactly like the session lifecycle gate at `gateway.ts:115`).
3. **`gateway-drain.test.ts`:** imported `AI_RESTART_REPLY` from `./gateway/contracts` and added `expect(core.sent.some((m) => m.text === AI_RESTART_REPLY)).toBe(false)` to the drain test.

### Files changed
- `apps/server/src/agents/dm-turn.ts`
- `apps/server/src/agents/gateway/listener.ts`
- `apps/server/src/agents/gateway.ts`
- `apps/server/src/agents/gateway-drain.test.ts`
- `work/T-1182-ai-followups.md` (status + this Report)

All inside the task's Allowed files.

### Commands and real results
- `pnpm install` → `Done in 24.4s using pnpm v10.32.1`.
- `pnpm --filter @zilar/server exec vitest run src/agents/gateway-drain.test.ts --maxWorkers=2 --reporter=dot` → `Test Files 1 passed (1)`, `Tests 1 passed (1)`.
- `pnpm gate` (first run) → `FAIL format`, `[warn] apps/server/src/agents/gateway/listener.ts`. Fixed with `pnpm exec prettier --write apps/server/src/agents/gateway/listener.ts`.
- `pnpm gate` (final) → summary lines:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.6s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.6s)
  PASS  effect  (1.3s)
  PASS  tests @zilar/server  (8.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- None beyond the first-run format warning above, which was fixed. No deviations from the spec.

### Security checklist
- No new secrets, routes, deletes, caps or audit entries; the change only gates an existing wake path and appends a fixed public suffix. No raw server text reaches users. Nothing to flag.

### Open questions
- None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits.**
- **`completeChat`** appends `cutShortSuffix(finishReason)`.
- **`wakeListenerAis`** returns early when `isStarted()` is false, wired lazily from `lifecycle.isStarted`.
- **The drain test** also asserts no `AI_RESTART_REPLY`. 1 of 1 in the branch, run by the lead.
