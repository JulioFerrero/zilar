---
id: T-1714
title: "Routine live message, step 2: a scheduled routine's turn posts ONE message and later runs edit it — a routine-send wrapper (first run sends and stores the id, later runs send an XEP-0308 correction to the stored id while it is under 24 h old), no reply quote or @mention, and no progress card on scheduled runs (Julio 2026-10-16)"
status: merged
milestone: M5
branch: task/T-1714-routine-send
model: auto
effort: default
depends_on: [T-1713]
estimate: 50 min
---

# T-1714: A routine edits its one message

## Spec (written by Claude, do not edit)

### Why
Julio approved on 2026-10-16 (`docs/design/mockups/routines/README.md`, decisions 1 and 3):
- a routine posts **one** message, and every later run **edits** it;
- a scheduled run is exactly one message, with no working card and no @mention.

The plan is `docs/plan/routine-live-message.md`. T-1713 added the storage (`routines/message-store.ts`). This task wires it into the send path at the gateway's wiring layer, so `turn-send.ts` and the turn loops stay unchanged.

### Facts (the lead read them on 2026-10-16)
- **The room turn**, in `apps/server/src/agents/gateway/group-turn-body.ts` (362 lines):
  - `trigger` is in scope (`:93`), and `scheduledTrigger` comes from `groupTurnAccess` (`:196-198`);
  - the progress card is `const groupProgress = liveProgressReporter(…)` (`:233`), passed as `reportProgress: groupProgress.reportProgress, finishProgress: groupProgress.finishProgress` (`:282-283`), and `turnDesk.waiting` posts a stage through `groupProgress.reportProgress` (`:222-226`);
  - the room `sendMessage` dep (`:300-305`) is ``async (to, kind, text, opts) => { const sent = await liveSendMessage(session, to, kind, text, opts); rememberRoomSentId(session, roomJid, sent.id); return sent; }``. Every send of the turn goes through it, the failure texts included (`apps/server/src/agents/group-turn.ts:177`, `apps/server/src/agents/turn-send.ts:44`).
- **The DM turn**, in `apps/server/src/agents/gateway/dm-turn-input.ts` (144 lines):
  - `DmTurnInput.scheduled?: boolean` (`:31-36`);
  - `const dmProgress = liveProgressReporter(…)` (`:62`), passed as `reportProgress`/`finishProgress` (`:97-98`);
  - `sendMessage: (to, kind, text) => liveSendMessage(session, to, kind, text)` (`:125`);
  - the caller `apps/server/src/agents/gateway/dm-turn.ts:329` passes `scheduled: trigger.scheduled !== undefined`, and `trigger.scheduled` holds `routineId` (`apps/server/src/agents/gateway/pending.ts:23-29`).
- **The live send** is `liveSendMessage(session, …)` (`apps/server/src/agents/gateway/live.ts:47-67`). It returns `{ id: '' }` without sending once the session is stopped (`sessionIsLive`, `:39-41`).
- **A correction** is `session.core.sendCorrection(chatJid, kind, originalId, text, opts?)` and returns `{ id }` (`packages/xmpp-core/src/types.ts:276-282`), used the same way at `live.ts:134`. It names the **origin id** that `sendMessage` returns (plan §1(b)).
- **The store** (T-1713) is `apps/server/src/routines/message-store.ts`: `loadRoutineMessage(db, routineId)` returns `{ messageId, at } | null`, and `recordRoutineMessage(db, routineId, messageId, at)`.

### Steps
1. **New `apps/server/src/agents/gateway/routine-send.ts`:** `createRoutineSend({ db, session, routineId, isLive, now, maxAgeMs = 24 * 60 * 60 * 1000 })` returns `send(to, kind, text): Promise<{ id: string }>`. It keeps a `targetId` across calls in the same run:
   - on the first call, load the stored message, and use its id as `targetId` only when `now() - at < maxAgeMs`;
   - when the session is not live (`isLive(session)` is false), return `{ id: '' }` and send nothing;
   - with a `targetId`, call `session.core.sendCorrection(to, kind, targetId, text)` with no opts, so no reply quote and no mention; refresh the stored time with `recordRoutineMessage(db, routineId, targetId, now())`; return `{ id: targetId }`;
   - without one, call `session.core.sendMessage(to, kind, text)` with no opts; set `targetId = sent.id` and record it; return `sent`;
   - a store read or write that fails is caught: the send still happens, and the log line carries ids only.
2. **`group-turn-body.ts`:** when `trigger.scheduled !== undefined`:
   - build a `routineSend` for `trigger.scheduled.routineId`;
   - the `sendMessage` dep calls `routineSend.send(to, kind, text)` (ignoring `opts`), then `rememberRoomSentId(session, roomJid, sent.id)`;
   - pass **no** `reportProgress`/`finishProgress`, and skip the waiting-stage post, so a scheduled run shows no card.

   Live turns don't change. Keep the file under 400 lines; if it would pass 400, move the scheduled-run wiring into `routine-send.ts`.
3. **`dm-turn-input.ts` and `dm-turn.ts:329`:** add `scheduledRoutineId?: string` to `DmTurnInput`, passed as `trigger.scheduled?.routineId`. When it's set, use the routine send for `sendMessage` and pass no progress hooks.
4. **Test** (message pipeline): new `apps/server/src/agents/gateway/routine-send.test.ts`, with a fake `session.core` (recording `sendMessage`/`sendCorrection` calls) and a fake store passed in as deps. Make the store functions injectable with the real ones as defaults. Cases:
   - no stored id: `sendMessage` is called once and the id is recorded;
   - a stored id younger than 24 h: `sendCorrection` targets it, and `sendMessage` isn't called;
   - a stored id older than 24 h: a new `sendMessage`;
   - two sends in one run: the second is a correction of the first's id;
   - not live: nothing is sent.

### Allowed files
- `apps/server/src/agents/gateway/routine-send.ts`
- `apps/server/src/agents/gateway/routine-send.test.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway/dm-turn-input.ts`
- `apps/server/src/agents/gateway/dm-turn.ts`
- `work/T-1714-routine-send.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway/routine-send.test.ts src/actions/args-example.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A routine's first run posts one message, and later runs edit it.** The edits carry no quote or mention.
- **A scheduled run shows no progress card.**
- **Live (unscheduled) turns are unchanged.**
- **The new tests pass.**

---

## Report (written by the worker when done)

### What I did

Wired the routine message store (T-1713) into the send paths at the gateway's
wiring layer, so the turn loops and `turn-send.ts` are unchanged.

- **New `apps/server/src/agents/gateway/routine-send.ts`:** `createRoutineSend({ db,
  session, routineId, isLive, now, logger, maxAgeMs = 24 h })` returns
  `send(to, kind, text)`. It keeps a `targetId` across the sends of one run: it
  loads the routine's stored message once per run and adopts its id when
  `now() - at < maxAgeMs`; with a target it calls `sendCorrection(to, kind,
  targetId, text)` (no opts) and refreshes the stored time; without one it calls
  `sendMessage(to, kind, text)`, stores the returned id and reuses it for later
  sends. When `isLive(session)` is false it returns `{ id: '' }` and sends
  nothing. Store reads/writes are best effort (`catchDefect`), logged with ids
  only, and never fail the send. `loadMessage`/`recordMessage` are injectable
  deps defaulting to the real store.
- **`group-turn-body.ts`:** when `trigger.scheduled !== undefined` it builds a
  `routineSend` for `trigger.scheduled.routineId`, the room `sendMessage` dep
  routes through `routineSend.send(to, kind, text)` (ignoring `opts`), and there
  is no `reportProgress`/`finishProgress` and no waiting-stage post, so a
  scheduled run shows no card. Live turns are untouched. The file is 387 lines.
- **`dm-turn-input.ts` / `dm-turn.ts`:** added `scheduledRoutineId?: string` to
  `DmTurnInput`, passed as `trigger.scheduled?.routineId` (via a conditional
  spread, because `exactOptionalPropertyTypes` is on). When set, the DM turn's
  `sendMessage` goes through the routine send and no progress hooks are passed.
- **New `routine-send.test.ts`:** fake `session.core` recording sends plus a fake
  store, covering the five spec cases and a store-read failure.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/agents/gateway/routine-send.test.ts` — 1 file passed, 6 tests passed.
- `pnpm --filter @zilar/server exec vitest run
  src/agents/gateway/routine-send.test.ts src/actions/args-example.test.ts
  --maxWorkers=2 --reporter=dot` (the task's check, with the required worker cap)
  — 2 files passed, 24 tests passed.
- `pnpm gate` — `GATE PASS`, summary lines:
  - `gate: 6 changed file(s) against main`
  - `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`,
    `PASS  effect`, `PASS  tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`

### Notes for the lead

- Deviations from the spec text:
  - `createRoutineSend` takes an extra required `logger: GatewayLogger` dep (the
    spec's signature omits it) because step 1 requires store failures to be
    logged with ids only. Both call sites pass the gateway `logger`.
  - `routine-send.ts` is written with `effect` (`Effect.gen` / `Effect.promise`),
    not `async`/`await`, because the gate's Effect ratchet fails a new counted
    source file that needs Effect.
  - `dm-turn.ts` is in the Allowed files and was changed to pass the new
    `scheduledRoutineId`; without it step 3 could not reach `dm-turn-input.ts`.
- The DM turn's last-resort failure path (`reportDmTurnDefect`) still uses
  `liveSendMessage` directly, which the spec did not ask to change; a scheduled
  run whose turn throws therefore posts a separate failure text rather than
  editing the routine's message. Flagging it in case it matters.
- The group turn's `sendMessage` ignores `opts` for a scheduled run as the spec
  says, so a scheduled run's card payload (never sent) and any quote/mention opts
  are dropped.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, plus 1 nit and 2 follow-ups.
- **The lead read `routine-send.ts`:**
  - it reads the stored message once per run;
  - it sends a correction to it while it's under 24 h old, and otherwise a new message, recording the id;
  - the correction carries no opts, so no quote and no mention;
  - store failures are logged with ids only;
  - nothing is sent once the session is stopped.
- **The wiring:**
  - the room and DM bodies swap in the routine send only for scheduled triggers;
  - a scheduled run gets no progress card;
  - live turns are unchanged.
- **The tests:** the lead ran `routine-send.test.ts` plus the `args-example` boot guard in the worktree: 24 tests passed.
- **Follow-ups, into the next routine task:**
  - the outer failure fallbacks (`group-turn.ts:339-344` with `@mention` and quote, and the DM `turn-defect.ts:34`) still post a new message on a scheduled run; route them through the routine send;
  - the daily-limit notices stay as they are.
- **Size:** `group-turn-body.ts` is now 387 lines, so the next change must not grow it. Put the logic in `routine-send.ts`.

