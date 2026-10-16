---
id: T-1642
title: "Scheduled AI jobs step 4b: the DM queue accepts a scheduled item (PendingMessage.scheduled) — admitted like an owner message, no read marker — and reports exactly one outcome (replied, failed, stopped, limited or offline) through its onOutcome callback; nothing queues one yet"
status: merged
milestone: M5
branch: task/T-1642-dm-scheduled-item
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1642: A scheduled run can ride the DM queue

## Spec (written by Claude, do not edit)

### Why
In scheduled AI jobs (plan `docs/plan/scheduled-ai-jobs.md` §2.2, T-1614), a prompt routine runs as a normal turn on the AI's own per-chat queue. It never overlaps a live turn, and it reuses the same persona, history, memory, tools and computer.

**This task makes the DM queue accept such an item and report its outcome.** The runner that queues it is a later task (4d). The group side is 4c.

### Facts (the lead read them on 2026-10-16, main after T-1639)
- **`apps/server/src/agents/gateway/contracts.ts`** (362 lines): `export interface PendingMessage { id: string; body: string; fromJid: string; }` (`:144-148`).
- **`apps/server/src/agents/gateway/dm-turn.ts`** (317 lines), `runSessionTurnEffect(session, batch)` (`:107-314`):
  - `ai === null` → disconnect and return (`:115-122`);
  - the batch filter keeps owner messages only (`:126-141`), so a batch with none returns;
  - `trigger` is the last owner message (`:142`);
  - `liveMarkDisplayed(session, ownerJid, 'chat', trigger.id)` (`:152`);
  - the daily limit: `if (dmBudget.limited) { return; }` (`:158-168`);
  - no provider connection (`target === null`) sends `TRANSIENT_FAILURE_REPLY` and returns (`:180-193`);
  - the batch is merged into the model history as owner messages (`:229-243`, `fromJid: ownerJid`, `body: item.body`);
  - `const outcome = yield* runDmTurnInput({...})` (`:275-285`), then `turnDrafts.end(outcome.kind === 'replied' && … ? 'sent' : 'failed')` (`:286`);
  - `turnBody.pipe(Effect.catchDefect(... reportDmTurnDefect ...))` (`:300-312`).
- **`DmTurnOutcome`** (`apps/server/src/agents/dm-turn.ts:121`) is now `replied | failed | stopped` (T-1639).

### Steps
1. **`contracts.ts`:**
   - add `export type ScheduledTurnOutcome = 'replied' | 'failed' | 'stopped' | 'limited' | 'offline';`;
   - add an optional field to `PendingMessage`: `scheduled?: { routineId: string; onOutcome: (outcome: ScheduledTurnOutcome) => void };`, with a T-1642 comment: a routine's synthetic trigger, never from the network.
2. **`dm-turn.ts`, `runSessionTurnEffect`:**
   - **(a)** At the top, collect `const scheduled = batch.filter((item) => item.scheduled !== undefined);` and a local `settle(outcome)` that calls each item's `onOutcome` **at most once per item** (a `Set` of settled ids, or a flag).
   - **(b)** `ai === null`: `settle('offline')` before returning.
   - **(c)** In the batch filter, keep an item when `item.scheduled !== undefined` **or** it is from the owner (a scheduled item counts as the owner's).
   - **(d)** Skip `liveMarkDisplayed` when `trigger.scheduled !== undefined` (there's no real message to mark).
   - **(e)** `dmBudget.limited`: `settle('limited')` before returning.
   - **(f)** No provider connection: `settle('failed')` after the failure text.
   - **(g)** After `runDmTurnInput` returns: `settle(outcome.kind)`.
   - **(h)** Make sure every other exit settles too: wrap the whole body so a defect or early return ends with `settle('failed')` (for example `Effect.ensuring(Effect.sync(() => settle('failed')))`, harmless because settle is once-only).
3. **Tests** (message pipeline), in the nearest gateway test file that drives DM turns (`apps/server/src/agents/gateway-stop.test.ts` or `apps/server/src/agents/dm-turn.fake-provider.test.ts`; pick the one whose harness can push onto `session.pending`):
   - a scheduled item alone runs a turn and settles `'replied'` exactly once, with no displayed marker sent;
   - with the daily limit reached, it settles `'limited'`.
4. **Change nothing for normal owner messages.**

### Allowed files
- `apps/server/src/agents/gateway/contracts.ts`
- `apps/server/src/agents/gateway/dm-turn.ts`
- `apps/server/src/agents/gateway-stop.test.ts`
- `apps/server/src/agents/dm-turn.fake-provider.test.ts`
- `work/T-1642-dm-scheduled-item.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway-stop.test.ts src/agents/dm-turn.fake-provider.test.ts src/agents/gateway-desk.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A scheduled item runs as an owner turn and settles exactly once.**
- **Normal DM turns are unchanged.**
- **Every file stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did

Implemented the DM queue's scheduled-item path (plan §2.2, step 4b). Nothing
queues a scheduled item yet (that is 4d); this only teaches the queue to accept
one.

- `apps/server/src/agents/gateway/contracts.ts`
  - Added `export type ScheduledTurnOutcome = 'replied' | 'failed' | 'stopped' | 'limited' | 'offline';`.
  - Added the optional `scheduled?: { routineId: string; onOutcome: (outcome: ScheduledTurnOutcome) => void }`
    field to `PendingMessage`, with a T-1642 comment (a routine's synthetic
    trigger, never from the network; counts as the owner's; no read marker;
    reports once).
- `apps/server/src/agents/gateway/dm-turn.ts`
  - Added `settleFor(batch)`: filters the batch's scheduled items, keeps a
    `Set` of settled ids, and returns a `settle(outcome)` that calls each
    item's `onOutcome` at most once.
  - `pumpSessionEffect` now builds one `settle` per batch and runs each turn as
    `runSessionTurnEffect(session, batch, settle).pipe(Effect.ensuring(Effect.sync(() => settle('failed'))))`,
    so a defect or any unrecognised exit reports the catch-all `'failed'`
    (harmless: a settled item is skipped).
  - `runSessionTurnEffect` takes that `settle` and calls it on every exit:
    `'offline'` when the AI row is gone, `'limited'` at the daily-limit gate,
    `'failed'` after the no-provider failure text, and `outcome.kind`
    (`replied`/`failed`/`stopped`) after `runDmTurnInput`.
  - The batch filter keeps an item when `item.scheduled !== undefined` or it is
    from the owner, so a scheduled item is admitted like an owner message
    (`fromJid` is ignored for it).
  - `liveMarkDisplayed` is skipped when `trigger.scheduled !== undefined`
    (there is no real incoming message to mark).
  - Normal owner-message turns take the same code path as before; the only new
    work for them is the no-op `settle` (empty scheduled list).
- `apps/server/src/agents/gateway-stop.test.ts`
  - Added a `describe('a scheduled item rides the DM queue (T-1642)')` with two
    tests: a scheduled item alone runs a turn and settles `'replied'` exactly
    once with no displayed marker, and with the daily limit reached it settles
    `'limited'`.

Deviation (see Notes): the tests build the DM turn factory directly instead of
going through `core.receive`.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-stop.test.ts`
  → Test Files 1 passed (1), Tests 3 passed (3).
- `pnpm --filter @zilar/server exec vitest run src/agents/gateway-stop.test.ts src/agents/dm-turn.fake-provider.test.ts src/agents/gateway-desk.test.ts --reporter=dot`
  → Test Files 3 passed (3), Tests 5 passed (5).
- `pnpm gate` (from the repo root), real summary lines:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (1.0s)
  PASS  lint  (1.3s)
  PASS  typecheck  (6.5s)
  PASS  effect  (2.0s)
  PASS  tests @zilar/server  (18.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  Changed files (all inside Allowed files): `gateway/contracts.ts` (375 lines),
  `gateway/dm-turn.ts` (348), `gateway-stop.test.ts` (266), this task file.

### Notes for the lead

- Test seam deviation. The spec suggested `gateway-stop.test.ts` or
  `dm-turn.fake-provider.test.ts` "whose harness can push onto
  `session.pending`". Neither can: the gateway harness only drives turns
  through `core.receive`, which routes a `ChatMessage` through
  `handleIncoming`, and `createAgentGateway` does not expose its `sessions`
  map. Reaching a session would mean changing `gateway.ts` or
  `gateway.test-harness.ts`, both outside the Allowed files (and hot files
  other workers hold).
  So the two new tests build the DM turn directly with `createDmTurn` in
  `gateway-stop.test.ts`, wiring the real `createLiveSession`,
  `createBudgetGate` and `createMemoryRunner` against a real `TestContext`
  database and a seeded AI (same shapes `createAgentGateway` uses), and drive
  `pumpSessionEffect` with a hand-built `AiSession` whose `pending` holds one
  scheduled item. The real budget gate is used for the `'replied'` test; the
  `'limited'` test injects a gate that answers `limited: true` so the turn's
  branch is exercised without writing usage rows.
- I did not add a test for the `'offline'` path: it needs the AI row removed
  after seeding and is not in the spec's two required cases. Say the word if
  you want it.
- Security checklist: the change adds no route, no log line that carries
  message text (existing logs are ids only), no secret handling and no delete
  or update. `onOutcome` runs in the gateway fiber and is the routine runner's
  own callback; a throwing callback would surface as a pump defect (already
  caught and logged by `handleIncoming`'s `catchDefect`).

## Review (written by Claude)

**Approved and merged.** This is scheduled AI jobs step 4b.

- **Pre-review:** clean, 3 nits.
- **How it works:** `PendingMessage.scheduled` counts as the owner's message and gets no read marker. `settleFor(batch)` reports once per item: offline, limited, failed (no connection), the turn's own outcome, and a catch-all `failed` through `Effect.ensuring`.
- **The tests:** the lead ran `gateway-stop`, `dm-turn.fake-provider` and `gateway-desk`: 5 passed. `dm-turn.ts` is 348 lines and `contracts.ts` 375.
- **For the runner (step 4d):**
  - items still queued when a session stops never settle, so the runner's timeout guard is required;
  - in a coalesced batch whose last item is scheduled, the owner's real message gets no read marker (nit 3). The runner task marks the last non-scheduled owner message instead.

