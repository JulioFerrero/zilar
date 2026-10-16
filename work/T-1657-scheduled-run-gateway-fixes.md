---
id: T-1657
title: "Scheduled-run fixes, gateway side (audit docs/audit/scheduled-path-trace.md G2, G3, G5): the 20-minute timeout starts when the turn starts (with a separate 60-minute queue wait cap), a turn whose session stopped settles 'stopped' instead of 'replied', and a scheduled DM item always runs as its own turn"
status: merged
milestone: M5
branch: task/T-1657-scheduled-run-gateway-fixes
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1657: Scheduled runs: timeout start, stopped sessions, DM batching

## Spec (written by Claude, do not edit)

### Why
The end-to-end trace (T-1656, `docs/audit/scheduled-path-trace.md` §4) found three gateway-side gaps that can record a wrong outcome for Julio's first real 08:00 run:
- **G2:** `ROUTINE_TIMEOUT_MS` (20 minutes) starts at **enqueue** (`apps/server/src/agents/gateway/routine-run.ts:77`). A run queued behind a 15-minute computer turn is settled `failed` at 20 minutes, and its real `replied` is dropped by the once-only settle. Three such days pause a healthy routine.
- **G3:** a deploy mid-run can record `ok` with nothing posted. `liveSendMessage` fakes success on a stopped session (`apps/server/src/agents/gateway/live.ts:39-58`), so the turn returns `replied` and `settle('replied')` runs (`apps/server/src/agents/gateway/dm-turn.ts:312`, `apps/server/src/agents/gateway/group-turn-body.ts:357`).
- **G5:** the DM pump runs the whole pending batch as one turn (`dm-turn.ts:94-95`). A scheduled item can be answered inside the owner's own later message's turn, unlike the room, which gives a scheduled item its own turn (`apps/server/src/agents/gateway/group-ingest.ts`, the T-1646 batch rule).

### Facts (the lead read them on 2026-10-16, main after T-1656)
- **`apps/server/src/agents/gateway/pending.ts`** (51 lines): `PendingMessage.scheduled` and `RoomPendingMessage.scheduled` are `{ routineId; onOutcome }`.
- **`apps/server/src/agents/gateway/routine-run.ts`** (116 lines): `const timer = setTimeout(() => settle('failed'), timeoutMs);` (`:77`), cleared in `finally`.
- **`apps/server/src/agents/gateway/dm-turn.ts`:**
  - the pump loop (`:93-100`): `const batch = session.pending.splice(0, session.pending.length); const settle = settleFor(batch); yield* runSessionTurnEffect(session, batch, settle).pipe(Effect.ensuring(...settle('failed')))`;
  - after the turn, `turnDrafts.end(outcome.kind === 'replied' && sessionIsLive(session) ? 'sent' : 'failed'); settle(outcome.kind);` (`:311-312`).
- **`apps/server/src/agents/gateway/group-turn.ts`:** `runGroupSessionTurnEffect(session, roomJid, batch, settle)` (`:110-…`).
- **`apps/server/src/agents/gateway/group-turn-body.ts`** (391 lines): `settle(turnOutcome.kind);` (`:357`). **Keep this file within 400 lines.**
- **`sessionIsLive(session)`** is available in both turn bodies (DM: `ctx`; group: through `ctx` as well; check).

### Steps
1. **G2:**
   - **`pending.ts`:** both `scheduled` shapes gain `onStart?: () => void`, with a comment: called once when the turn that carries this item starts.
   - **`dm-turn.ts`:** at the start of `runSessionTurnEffect`, call `onStart` for each scheduled item in the batch.
   - **`group-turn.ts`:** do the same at the start of `runGroupSessionTurnEffect`.
   - **`routine-run.ts`:**
     - start the 20-minute `timeoutMs` timer inside `onStart` (once);
     - add `queueWaitMs` (default `60 * 60 * 1000`) started at enqueue, which settles `'failed'` if the turn never starts;
     - clear both timers in `finally`.
2. **G3:** where the turn's outcome is settled (`dm-turn.ts:312`, `group-turn-body.ts:357`), settle `'stopped'` when `outcome.kind === 'replied'` but `!sessionIsLive(session)`; otherwise `outcome.kind`. Keep `group-turn-body.ts` within 400 lines: one short expression, no new comment block.
3. **G5, `dm-turn.ts` pump:** if the pending queue's first item is scheduled, take just that item as the batch. Otherwise take items up to (not including) the first scheduled one. So a scheduled DM item is always its own turn, the same as the room rule.
4. **Tests** in `apps/server/src/agents/gateway-stop.test.ts` (message pipeline). It's at 388 lines but tests are exempt from the cap.
   - a scheduled DM item queued behind a busy turn is **not** failed by `timeoutMs` while it waits (a short `timeoutMs` and a held first turn), and resolves with its own outcome;
   - a scheduled DM item pushed together with an owner message runs as a separate turn;
   - a session stopped before the final send settles `'stopped'`.

### Allowed files
- `apps/server/src/agents/gateway/pending.ts`
- `apps/server/src/agents/gateway/routine-run.ts`
- `apps/server/src/agents/gateway/dm-turn.ts`
- `apps/server/src/agents/gateway/group-turn.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway-stop.test.ts`
- `work/T-1657-scheduled-run-gateway-fixes.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway-stop.test.ts src/agents/gateway-group.test.ts src/agents/dm-turn.fake-provider.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **G2, G3 and G5 are fixed,** with tests.
- **Normal turns are unchanged.**
- **Every source file stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did

**G2 — timeout starts at turn start, with a separate queue wait (audit G2).**
- `apps/server/src/agents/gateway/pending.ts`: both `scheduled` shapes (`PendingMessage` and `RoomPendingMessage`) gained the optional `onStart?: () => void`, documented as "called once when the turn that carries this item starts".
- `apps/server/src/agents/gateway/dm-turn.ts`: `runSessionTurnEffect` calls `item.scheduled?.onStart?.()` for every item in the batch as its first statement.
- `apps/server/src/agents/gateway/group-turn.ts`: `runGroupSessionTurnEffect` does the same.
- `apps/server/src/agents/gateway/routine-run.ts`: added `ROUTINE_QUEUE_WAIT_MS = 60 * 60 * 1000` and a `queueWaitMs?` dep. The queue-wait timer starts at enqueue; `onStart` (`startTurn`) clears it once and starts the 20-minute `timeoutMs` timer. `startTurn` is idempotent (`turnTimer !== undefined` guard), and the `finally` clears both timers.

**G3 — a stopped session settles `stopped`, not `replied`.**
- `apps/server/src/agents/gateway/dm-turn.ts`: `settle(outcome.kind === 'replied' && !live ? 'stopped' : outcome.kind)`, reusing one `sessionIsLive(session)` read for the existing draft `sent`/`failed` decision.
- `apps/server/src/agents/gateway/group-turn-body.ts`: same expression. `sessionIsLive` is not on `GroupTurnContext` (gateway.ts, not in my Allowed files, would have to pass it), so I computed the identical check from the `sessions` map already in `ctx`: `!session.stopped && sessions.get(session.aiId) === session`. File is 394 lines (cap 400).

**G5 — a scheduled DM item is always its own turn.**
- `apps/server/src/agents/gateway/dm-turn.ts` pump: if `pending[0]` is scheduled, `take = 1`; otherwise take the run of non-scheduled items up to (not including) the first scheduled one. Same shape as the room pump's T-1646 rule. Normal (all-owner) batches are unchanged: `take` runs to the end.

**Tests** (`apps/server/src/agents/gateway-stop.test.ts`, a new `T-1657` describe, 3 tests):
1. a scheduled item queued behind a held first turn with a short `timeoutMs: 50` is still unsettled after 120 ms and resolves `'replied'` once the queue frees;
2. a scheduled item pushed together with an owner message runs two turns (`fetches === 2`) and the scheduled item settles `'replied'`;
3. a session stopped after the model call but before the final send settles `'stopped'` and no reply is sent.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-stop.test.ts` → `1 passed`, `10 passed` (tests).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-group.test.ts` → `1 passed`, `20 passed`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-stop.test.ts src/agents/gateway-group.test.ts src/agents/dm-turn.fake-provider.test.ts` (the task's Checks command) → `3 passed`, `31 passed`.
- `pnpm gate` (first run) → `FAIL format` on `gateway-stop.test.ts`; fixed with `pnpm exec prettier --write` on that one file.
- `pnpm gate` (second run) → GATE PASS:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.7s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (23.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Deviation from the spec's parenthetical on G3 (`group`):** the spec says `sessionIsLive(session)` is "available … through `ctx` as well; check". It is not part of `GroupTurnContext`, and passing it in would require editing `apps/server/src/agents/gateway.ts` and `apps/server/src/agents/gateway-group.test.ts`, both outside my Allowed files. I used the exact definition `!session.stopped && sessions.get(session.aiId) === session` from the `sessions` map already destructured from `ctx` in `group-turn-body.ts`. Behaviour is identical to `live.ts`'s `sessionIsLive`.
- No dependencies added; no migrations; no registry files touched.
- `pnpm gate` after the earlier `pnpm install` reported nothing outside the Allowed files.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 0 nits, 1 follow-up.
- **The fixes:**
  - **G2:** `onStart` on the scheduled item starts the 20-minute turn timer when the turn begins. A separate 60-minute queue-wait timer covers a turn that never starts.
  - **G3:** both settle points map `replied` on a dead session to `stopped`.
  - **G5:** the DM pump takes a scheduled item alone and stops an owner batch before the next scheduled item.
- **The tests:** the lead ran `gateway-stop`, `gateway-group`, `dm-turn.fake-provider` and `gateway-desk`: 32 passed.
- **Follow-up, accepted for later:** `group-turn-body.ts:359` repeats `sessionIsLive` inline. That's harmless today.
- **Size note:** `group-turn-body.ts` is now 394 lines. **The next change to it must split the file first.**

