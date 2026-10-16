---
id: T-1646
title: "Scheduled AI jobs step 4c: the room queue accepts a scheduled item (RoomPendingMessage.scheduled) as its own turn, admitted past the member checks, run without request_action / ask_people / delegation, and reports exactly one outcome; the once-only settle helper moves to a shared module used by DM and room"
status: merged
milestone: M5
branch: task/T-1646-room-scheduled-item
model: auto
effort: default
depends_on: []
estimate: 50 min
---

# T-1646: A scheduled run can ride the room queue

## Spec (written by Claude, do not edit)

### Why
This is scheduled AI jobs, plan `docs/plan/scheduled-ai-jobs.md` §2.2 and §2.5 (T-1614). T-1642 (merged) did the DM side: `PendingMessage.scheduled`, settled once through `settleFor`.

**This task does the same for topic routines on the room queue.** The runner that queues items is the next task.
- **The runner's synthetic room item** will carry `fromJid` = the AI owner's JID, `fromResolved: true`, `fromNick` = the owner's name, a random `id`, `timestamp` = now, and `scheduled`.
- **What that gives for free:** the reply's leading `@owner` mention and the owner's time zone (`timeZoneForJid` on the trigger) work unchanged.
- **The owner may not be a room member,** so the member checks must admit it.

### Facts (the lead read them on 2026-10-16, main after T-1645)
- **`apps/server/src/agents/gateway/contracts.ts`:** `ScheduledTurnOutcome` (`:148`), `PendingMessage.scheduled` (`:155-160`) and `RoomPendingMessage` (`~:163-178`, with `wake?`, `handoff?` and `delegationId?`).
- **`apps/server/src/agents/gateway/dm-turn.ts`:** `function settleFor(batch: PendingMessage[])` (`:82-97`) is a closure-free helper that settles each scheduled item once.
- **`apps/server/src/agents/gateway/group-ingest.ts`, `pumpRoomEffect`** (`:312-352`): a `delegationId` item is always its own batch, and others coalesce only with the same sender (`:330-346`). Then `yield* Effect.promise(() => runGroupSessionTurn(session, roomJid, batch))`.
- **`apps/server/src/agents/gateway/group-turn.ts`** (338 lines), `runGroupSessionTurnEffect(session, roomJid, batch)` (`:107-…`):
  - `ai === null` → disconnect and return (`:117-122`);
  - `room === undefined` → return (`:123-126`);
  - `gate === null` → return (`:130-133`);
  - the eligible filter (`:134-163`): an AI sender only for a handoff, then `!item.fromResolved` → skip, then `!gate.memberJids.has(fromBare)` → skip;
  - the daily limit `groupBudget.limited` → return (about `:212`);
  - the rate/round budget drop → return (about `:239`);
  - `yield* runGroupTurnBody({...}).pipe(Effect.catchDefect(...))` (about `:272-330`);
  - `runGroupSessionTurn` wraps it at `:332-337`.
- **`apps/server/src/agents/gateway/group-turn-body.ts`** (375 lines):
  - `runGroupTurnBody(input)` (`:77`);
  - `allowedForAction` from the trigger's role (`:199`), `askPeople = trigger.handoff !== true` (`:205`), `delegateTargets` (`:209-212`);
  - `const turnOutcome = yield* Effect.promise(() => runGroupTurn({...}))` (`:267`).

### Steps
1. **New file `apps/server/src/agents/gateway/scheduled-settle.ts`:** move `settleFor` there, generic over `{ id: string; scheduled?: { onOutcome: (o: ScheduledTurnOutcome) => void } }`. `dm-turn.ts` imports it, with no behaviour change.
2. **`contracts.ts`:** add `scheduled?` to `RoomPendingMessage`, the same shape and comment as `PendingMessage.scheduled` (T-1646).
3. **`group-ingest.ts` pump:** a scheduled item is always its own batch, exactly like `delegationId`. Take one when the first is scheduled, and stop coalescing at a scheduled item.
4. **`group-turn.ts`:**
   - `runGroupSessionTurn` builds `settle = settleFor(batch)`, passes it to `runGroupSessionTurnEffect`, and adds `Effect.ensuring(Effect.sync(() => settle('failed')))`;
   - settle at each exit: `ai === null` → `'offline'`, `room === undefined` → `'offline'`, `gate === null` → `'failed'`, daily limit → `'limited'`, the rate/round budget drop → `'limited'`, `catchDefect` → `'failed'`;
   - in the eligible filter, an item with `scheduled !== undefined` is pushed **before** the AI-sender, `fromResolved` and member checks (comment: a routine's trigger, never from the network, its owner may not be a member);
   - pass `settle` into `runGroupTurnBody`.
5. **`group-turn-body.ts`:**
   - add `settle: (outcome: ScheduledTurnOutcome) => void` to the input;
   - after `turnOutcome` is known, call `settle(turnOutcome.kind)`;
   - for a scheduled trigger (`trigger.scheduled !== undefined`): `allowedForAction` is false, so no `request_action`; `askPeople` is false; `delegateTargets` is `undefined`. The desk/computer tools stay as they are.

   The plan's §2.5 recommendation: an unattended run must not ping people, park a card or start a delegation.
6. **Tests** in `apps/server/src/agents/gateway-group.test.ts` (message pipeline):
   - a scheduled item with the owner's JID runs a room turn even when the owner isn't a room member, and settles `'replied'` once;
   - a scheduled turn offers no `request_action` and no `ask_people`;
   - a scheduled item queued behind a mention from the same JID runs as its own turn.

### Allowed files
- `apps/server/src/agents/gateway/scheduled-settle.ts`
- `apps/server/src/agents/gateway/contracts.ts`
- `apps/server/src/agents/gateway/dm-turn.ts`
- `apps/server/src/agents/gateway/group-ingest.ts`
- `apps/server/src/agents/gateway/group-turn.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway-group.test.ts`
- `work/T-1646-room-scheduled-item.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway-group.test.ts src/agents/gateway-stop.test.ts src/agents/handoff.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The three test cases pass.**
- **Mentions, handoffs and delegations behave as before.**
- **Every file stays within 400 lines** (`group-turn-body.ts` is the tight one).

---

## Report (written by the worker when done)

### What I did

- **New `apps/server/src/agents/gateway/scheduled-settle.ts`:** the once-only `settleFor` moved out of `dm-turn.ts`, generic over `ScheduledSettleItem` (`{ id: string; scheduled?: { onOutcome } }`) so both `PendingMessage[]` and `RoomPendingMessage[]` fit. `dm-turn.ts` imports it; no behaviour change.
- **`contracts.ts`:** added `scheduled?` to `RoomPendingMessage` (same shape as `PendingMessage.scheduled`), with a room-appropriate comment (always its own turn, admitted before the member checks, reports its outcome once).
- **`group-ingest.ts` pump:** a scheduled item is always its own batch, exactly like `delegationId`: take only it when first, and stop coalescing when one is reached inside the run.
- **`group-turn.ts`:** `runGroupSessionTurn` builds `settle = settleFor(batch)`, runs the effect under `Effect.ensuring(Effect.sync(() => settle('failed')))`, and passes `settle` into `runGroupSessionTurnEffect`. Settles every listed exit: `ai === null` → `'offline'`, `room === undefined` → `'offline'`, `gate === null` → `'failed'`, daily limit → `'limited'`, rate/round drop → `'limited'`, `catchDefect` → `'failed'`. In the eligible filter a `scheduled !== undefined` item is pushed before the AI-sender, `fromResolved` and member checks. `settle` is passed to `runGroupTurnBody`.
- **`group-turn-body.ts`:** `settle` added to the input; `settle(turnOutcome.kind)` fires once the turn's outcome is known. For a scheduled trigger the interactive tools are suppressed: `allowedForAction` false (no `request_action`), `askPeople` false, `delegateTargets` undefined; the desk/computer tools stay as they were.
- **Tests** in `apps/server/src/agents/gateway-group.test.ts` (new `describe`, builds `createGroupTurn`/`createGroupIngest` directly like the DM T-1642 test): (1) a scheduled item from a non-member owner runs and settles `'replied'` once; (2) a scheduled turn advertises neither `request_action` nor `ask_people` even with an owner trigger and actions available; (3) a scheduled item behind a same-sender mention runs as its own batch.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-group.test.ts` → 1 file, 20 passed (17 existing + 3 new).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-stop.test.ts src/agents/handoff.test.ts` → 2 files, 7 passed.
- `pnpm gate` (run twice; the first run flagged a Prettier issue in the new test block, fixed with `pnpm exec prettier --write` on that one file, then re-run):
  ```
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.4s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/server  (26.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

Files changed: `gateway/scheduled-settle.ts` (new, 27 lines), `gateway/contracts.ts` (383), `gateway/dm-turn.ts` (331), `gateway/group-ingest.ts` (366), `gateway/group-turn.ts` (364), `gateway/group-turn-body.ts` (386), `gateway-group.test.ts`; all inside the Allowed files.

### Notes for the lead

- **Deviation (small):** the `RoomPendingMessage.scheduled` comment is worded for the room case rather than a byte-for-byte copy of `PendingMessage.scheduled` ("counts as the owner's message, gets no read marker" does not apply to rooms). Same shape, tagged T-1646.
- The `eligible.length === 0` early return in `group-turn.ts` is left without a settle: a batch holding a scheduled item can never be empty (it is always admitted), so no scheduled item can exit there.
- Tests build the turn factories directly because the gateway harness only injects network messages; the wiring mirrors `createAgentGateway`. `pnpm gate` scope confirms nothing outside the Allowed files.
- Nothing else outstanding; no blocked items.

## Review (written by Claude)

**Approved and merged.** This is scheduled AI jobs step 4c.

- **Pre-review:** clean, 1 nit.
- **What changed:**
  - `settleFor` moved to `gateway/scheduled-settle.ts`, shared by DM and room;
  - a scheduled room item is its own batch, admitted before the AI-sender and member checks, and settles at every exit (offline, failed, limited, the turn's outcome, and a catch-all `failed` through `ensuring`);
  - a scheduled trigger gets no `request_action`, `ask_people` or delegation tools, and keeps the computer.
- **The tests:** the lead ran `gateway-group`, `gateway-stop`, `handoff` and `dm-turn.fake-provider`: 28 passed.
- **File sizes:** `group-turn-body.ts` is 386 lines and `contracts.ts` 383. T-1647 must move the pending types to `pending.ts` if `contracts.ts` grows past 395.
