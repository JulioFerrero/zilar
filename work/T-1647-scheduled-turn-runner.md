---
id: T-1647
title: "Scheduled AI jobs step 4d: AgentGateway.runScheduledTurn queues a routine's synthetic trigger on the AI's own DM or room queue and resolves with its outcome (replied, failed, stopped, limited, offline, not_in_room; failed on a 20-minute timeout); a scheduled DM turn offers no request_action; the DM read marker goes to the last real owner message"
status: merged
milestone: M5
branch: task/T-1647-scheduled-turn-runner
model: auto
effort: default
depends_on: [T-1646]
estimate: 50 min
---

# T-1647: The scheduled-turn runner in the gateway

## Spec (written by Claude, do not edit)

### Why
This is scheduled AI jobs, plan `docs/plan/scheduled-ai-jobs.md` §2.2 (T-1614).
- **Done so far:** T-1642 (DM) and T-1646 (room) let a queue item carry `scheduled: { routineId, onOutcome }` and settle once. T-1645 gave the routine executor a `runPrompt` port.

**This task adds the gateway method the port will call.** The wiring into the scheduler is the next task.

### Facts (the lead read them on 2026-10-16, main after T-1646 — re-check line numbers)
- **`apps/server/src/agents/gateway/live.ts`** (339 lines) defines `loadOwnerId(aiId)` (`:235`), `loadTopicRoomJid(topicId)` (`:253`) and `loadRoomJid(groupId)` (used at `:309`). These are Effects returning `string | null`. `postToChatEffect` (`:278-318`) shows how they resolve a DM owner JID (`jidFor(localpartFor(ownerId), deps.xmpp.domain)`), a topic room or General, and the `session.rooms.has(roomJid)` guard. `live.ts` returns `{ sessionIsLive, liveSendMessage, …, postToChat }` (`:329-338`).
- **`apps/server/src/agents/gateway.ts`** (325 lines):
  - a DM message is queued as `session.pending.push({...})`, then `Effect.runFork(pumpSessionEffect(session).pipe(Effect.catchDefect(...)))` (`:280-297`);
  - `pumpRoom` comes from `createGroupIngest` (`:196`);
  - the returned object holds `postToChat` and `stopTurn` (`:305-324`).
- **`apps/server/src/agents/gateway/group-ingest.ts`, `queueRoomTurn`** (`:276-307`): it pushes onto `session.roomPending.get(roomJid) ?? []`, sets it back, and forks `pumpRoomEffect`.
- **`apps/server/src/agents/gateway/contracts.ts`:** `ScheduledTurnOutcome` and `PendingMessage`/`RoomPendingMessage.scheduled` (T-1642, T-1646). `AgentGateway` is at about `:279-311`. The file is near 390 lines.
- **`apps/server/src/agents/gateway/dm-turn.ts`:**
  - `liveMarkDisplayed` is skipped when `trigger.scheduled !== undefined` (T-1642), so in a coalesced `[owner msg, scheduled]` batch the real owner message isn't marked;
  - `const dmActionsList = deps.actions?.listActions() ?? [];` (about `:292`) decides the tool guide.
- **`apps/server/src/agents/gateway/dm-turn-input.ts:78`:** `tools: buildTools(deps.actions?.listActions() ?? [], { desk: deskEnabled })`.
- **`loadOwnerName(db, ownerId)`:** `apps/server/src/agents/gateway/db.ts:91`.

### Steps
1. **`live.ts`:** also return `loadOwnerId`, `loadTopicRoomJid` and `loadRoomJid`.
2. **New file `apps/server/src/agents/gateway/routine-run.ts`,** with `createRoutineRunner(deps)`:
   - **deps:** `sessions`, `sessionIsLive`, the three loaders, `loadOwnerName`, `domain`, `kickDm(session)`, `kickRoom(session, roomJid)`, and optional `timeoutMs` (default `20 * 60 * 1000`; a computer turn is capped at 15 minutes, T-1611).
   - **It returns** `runScheduledTurn(input: { aiId: string; groupId: string | null; topicId: string | null; routineId: string; title: string; prompt: string }): Promise<ScheduledRunOutcome>`.
   - **`ScheduledRunOutcome = ScheduledTurnOutcome | 'not_in_room'`** is exported from `contracts.ts`.
   - **The body text** is `Scheduled run "${title}".\n${prompt}`.
   - **Steps:**
     1. No session, or `!sessionIsLive(session)` → `'offline'`.
     2. Owner id is null → `'offline'`. `ownerJid` is built as in `postToChatEffect`.
     3. **DM** (`groupId === null`): push `{ id: randomUUID(), body, fromJid: ownerJid, scheduled: { routineId, onOutcome } }` onto `session.pending`, then `kickDm(session)`.
     4. **Room:** `roomJid` comes from the topic, or General when `topicId` is null. If it's null or `!session.rooms.has(roomJid)` → `'not_in_room'`. Otherwise push `{ id: randomUUID(), body, fromJid: ownerJid, fromResolved: true, fromNick: ownerName, timestamp: new Date(), scheduled }` onto `session.roomPending` (like `queueRoomTurn`), then `kickRoom(session, roomJid)`.
     5. Resolve with the first `onOutcome`, or `'failed'` after `timeoutMs`. Clear the timer on settle.
3. **`contracts.ts`:**
   - add `runScheduledTurn` to `AgentGateway`, with a doc comment (T-1647: the routine scheduler's port, never reached from the network);
   - if `contracts.ts` would pass 395 lines, first move `PendingMessage`, `RoomPendingMessage`, `ScheduledTurnOutcome` and `ScheduledRunOutcome` into a new `apps/server/src/agents/gateway/pending.ts`, re-exported from `contracts.ts`.
4. **`gateway.ts`:**
   - create the runner after the pumps exist. `kickDm` is the same `Effect.runFork(pumpSessionEffect(session)…)` as `:288-297`; factor it into a local `kickDm` used by both places. `kickRoom` calls `pumpRoom`;
   - expose `runScheduledTurn`.
5. **`dm-turn.ts`:**
   - **(a)** Mark the last owner message whose `scheduled` is undefined (if any) instead of skipping the marker whenever the trigger is scheduled.
   - **(b)** When the trigger is scheduled, `dmActionsList` is `[]`, so no tool guide.
   - **(c)** Pass `scheduled: true` to `runDmTurnInput`, so `dm-turn-input.ts` builds the tools with `[]` actions (`request_action` off; the computer/desk tools unchanged).

   Plan §2.5: an unattended run parks no approval card.
6. **Tests** in `apps/server/src/agents/gateway-stop.test.ts` or the gateway test that T-1642 extended (message pipeline):
   - a DM `runScheduledTurn` on a live session resolves `'replied'`, and the model saw the `Scheduled run "…"` text;
   - an unknown `aiId` → `'offline'`;
   - a topic routine for a room the session hasn't joined → `'not_in_room'`;
   - with `timeoutMs: 50` and a turn that never settles → `'failed'`.

### Allowed files
- `apps/server/src/agents/gateway/routine-run.ts`
- `apps/server/src/agents/gateway/pending.ts`
- `apps/server/src/agents/gateway/live.ts`
- `apps/server/src/agents/gateway/contracts.ts`
- `apps/server/src/agents/gateway.ts`
- `apps/server/src/agents/gateway/dm-turn.ts`
- `apps/server/src/agents/gateway/dm-turn-input.ts`
- `apps/server/src/agents/gateway-stop.test.ts`
- `work/T-1647-scheduled-turn-runner.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway-stop.test.ts src/agents/gateway-group.test.ts src/agents/dm-turn.fake-provider.test.ts src/agents/gateway-desk.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The four test cases pass.**
- **Normal DM and room turns are unchanged.**
- **Every file stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did

Implemented the gateway's scheduled-turn runner (plan §2.2, task 4d).

- **`gateway/live.ts`:** `createLiveSession` now also returns `loadOwnerId`, `loadRoomJid` and `loadTopicRoomJid`, so the runner resolves the owner JID and the room JID exactly as `postToChatEffect` does.
- **`gateway/pending.ts` (new):** moved `PendingMessage`, `RoomPendingMessage`, `ScheduledTurnOutcome` and the new `ScheduledRunOutcome = ScheduledTurnOutcome | 'not_in_room'` out of `contracts.ts` (which would otherwise pass 395 lines). `contracts.ts` re-exports all four, so existing imports keep working, and imports the three it still uses locally.
- **`gateway/routine-run.ts` (new):** `createRoutineRunner(deps)` returns `runScheduledTurn(input)`. Body text is `Scheduled run "${title}".\n${prompt}`. No/stopped session or a null owner id → `'offline'`. A DM routine pushes a `PendingMessage` with `scheduled` onto `session.pending` and calls `kickDm`. A room routine resolves the topic room (or General when `topicId` is null), returns `'not_in_room'` when the room is unknown or the session has not joined it, otherwise pushes a `RoomPendingMessage` (`fromResolved: true`, `fromNick` = owner name) and calls `kickRoom`. The first `onOutcome` wins; a turn that never settles resolves `'failed'` after `timeoutMs` (default `ROUTINE_TIMEOUT_MS` = 20 min). The timer is cleared in a `finally`.
- **`gateway.ts`:** destructures the three loaders; factored the pump fork out of `handleIncoming` into a local `kickDm` used by both places; added `kickRoom` (awaits nothing, logs a redacted line on rejection); creates the runner once the pumps exist and exposes `runScheduledTurn`.
- **`gateway/contracts.ts`:** added `runScheduledTurn` to `AgentGateway` with a doc comment (the routine scheduler's port, never reached from the network).
- **`gateway/dm-turn.ts`:** (a) marks the last owner message whose `scheduled` is undefined instead of skipping the marker whenever the trigger is scheduled; (b) a scheduled trigger yields an empty `dmActionsList`, so no tool guide; (c) passes `scheduled: trigger.scheduled !== undefined` to `runDmTurnInput`.
- **`gateway/dm-turn-input.ts`:** new optional `scheduled` input; when true the action list is `[]`, so `request_action` is off while the computer/desk tools are unchanged.
- **`gateway-stop.test.ts`:** four new cases — DM routine resolves `'replied'` and the model saw the `Scheduled run "Daily digest".\nSummarize the day.` text; unknown `aiId` → `'offline'`; a topic room the session has not joined → `'not_in_room'`; `timeoutMs: 50` with a model call that hangs past the timeout → `'failed'` (the call is then released so nothing stays pending). `dmPumpFor` gained an optional `fetchImpl`; the file stayed under 400 lines by sharing a `startGateway`/`runDm` helper.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-stop.test.ts` → 1 file, 7 tests passed (includes the two pre-existing T-1642 cases).
- Task Checks, with the required worker cap: `pnpm --filter @zilar/server exec vitest run --maxWorkers=2 src/agents/gateway-stop.test.ts src/agents/gateway-group.test.ts src/agents/dm-turn.fake-provider.test.ts src/agents/gateway-desk.test.ts --reporter=dot` → 4 files, 29 tests passed.
- `pnpm gate` from the repo root → `GATE PASS`. Summary lines:
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (1.2s)`
  - `PASS  lint  (0.9s)`
  - `PASS  typecheck  (3.5s)`
  - `PASS  effect  (0.8s)`
  - `PASS  tests @zilar/server  (17.9s)`
  - `scope: every changed file is inside the Allowed files`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

The first gate run failed typecheck (`contracts.ts` still referenced `PendingMessage`/`RoomPendingMessage` after the move); I added them to the local import and the second run passed.

### Notes for the lead

- The plan doc `docs/plan/scheduled-ai-jobs.md` is not in `HEAD` (only in T-1614's history). I read §2.2 and §2.5 from commit `0d14d8588:docs/plan/scheduled-ai-jobs.md` for context.
- Deviations from the spec, all within its letter: the runner's loader deps are the Effect-returning functions `live.ts` already exposes; the DM push uses a plain `new Date()` timestamp per the spec's room branch wording. I did not add a `now` port (the spec lists no such dep).
- Group/model behaviour for a scheduled trigger (`request_action`/`ask_people`/delegation off) is out of this task's Allowed files; only the DM tool list is changed here (step 5). The room side relies on T-1646's admission.
- Largest touched source file is `gateway.ts` at 364 lines; `gateway-stop.test.ts` is 388 lines; all within the 400-line cap.

## Review (written by Claude)

**Approved and merged.** This is scheduled AI jobs step 4d.

- **Pre-review:** clean, 2 nits.
- **`createRoutineRunner`** (`gateway/routine-run.ts`, 116 lines):
  - offline when there's no live session or no owner;
  - **DM:** queues a synthetic owner item;
  - **room:** `not_in_room` unless the session holds the room; otherwise queues a synthetic item from the owner;
  - resolves with the first settle, or `failed` after 20 minutes.
- **Plumbing:**
  - the pending types moved to `gateway/pending.ts`, so `contracts.ts` is 368 lines;
  - `gateway.ts` gained `kickDm` and `kickRoom` and exposes `runScheduledTurn`;
  - a scheduled DM turn gets no actions and no guide;
  - the read marker goes to the last real owner message.
- **The tests:** the lead ran `gateway-stop`, `gateway-group`, `dm-turn.fake-provider` and `gateway-desk`: 29 passed.
- **Nits, accepted:**
  - a rejected room or owner lookup rejects the promise, and T-1645's executor records a throw as `failed`;
  - a lookup that stalls past the timeout only delays a `not_in_room`.

