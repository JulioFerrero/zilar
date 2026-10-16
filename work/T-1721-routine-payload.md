---
id: T-1721
title: "Routine live message, step 3 (server + protocol): a new `routine` payload {id, title, schedule} rides on the routine's message and every edit of it (so clients can draw the header and bump the chat), and a scheduled run's failure fallbacks post nothing (no extra @mention message)"
status: merged
milestone: M5
branch: task/T-1721-routine-payload
model: auto
effort: default
depends_on: [T-1714]
estimate: 45 min
---

# T-1721: The routine message carries a routine payload

## Spec (written by Claude, do not edit)

### Why
The approved board (`docs/design/mockups/routines/WebRoutineLive.dc.html`) draws the routine message with a header: the repeat icon, the routine title and the schedule. Julio also chose that each routine edit **bumps the chat**.

Clients can only do either when the message says it belongs to a routine. T-1714 made a scheduled run post one message and edit it (`apps/server/src/agents/gateway/routine-send.ts`); this task adds the payload. The client side (the header and the bump) is the next task.

T-1714's pre-review also found two failure fallbacks that still post an extra message, with an @mention and a quote, on a scheduled run. This task silences them.

### Facts (the lead read them on 2026-10-16)
- **Payloads:** `packages/protocol/src/payload.ts` (127 lines). `PayloadSchema` is a `Schema.Union` of `{ v: 0, type: <literal>, data: <schema> }` members (`:17-54`); `question` (`:53`, schema in `packages/protocol/src/question.ts` via `struct({...})` from `./common`) is the latest one added.
- **Sending with a payload:**
  - `session.core.sendMessage(to, kind, text, opts)` takes `SendMessageOptions` (with `payload`);
  - `session.core.sendCorrection(to, kind, id, text, opts?)` takes `SendCorrectionOptions { mentions?; payload? }` (`packages/xmpp-core/src/types.ts:210-216`, "so a correction can update a task card in place").
- **`apps/server/src/agents/gateway/routine-send.ts`** (112 lines, T-1714) is `createRoutineSend({ db, session, routineId, isLive, now, logger, … })`. It calls `sendCorrection(to, kind, existing, text)` and `sendMessage(to, kind, text)` with no opts.
- **The routine row:** `findRoutineById(db, id)` (`apps/server/src/routines/reads.ts`) returns `title` and `schedule`. `describeSchedule(schedule)` is exported from `apps/server/src/tools/routine-adapters.ts:42`, for example "every 5 minutes". The raw schedule needs `parseRoutineSchedule` (`apps/server/src/routines/schedule.ts`) first.
- **The failure fallbacks:**
  - room: `apps/server/src/agents/gateway/group-turn.ts:338-344` posts `` `@${name} ${GROUP_FAILURE_REPLY}` `` with `replyTo` and `mentions` through `liveSendMessage`; `trigger` is in scope;
  - DM: `apps/server/src/agents/gateway/turn-defect.ts:32-36` posts `mapFailureToReply(error)`. It's called from `apps/server/src/agents/gateway/dm-turn.ts:351-360` (`reportDmTurnDefect({...})`), where `trigger` is in scope.

### Steps
1. **Protocol:**
   - new `packages/protocol/src/routine.ts` with `RoutinePostSchema = struct({ id: string 1-64, title: string 1-80, schedule: string 1-80 })` and its type;
   - add the union member `{ v: 0, type: 'routine', data: RoutinePostSchema }` to `payload.ts`, and export it from the package index the way `question` is;
   - add one decode case to `packages/protocol/src/payload.test.ts`.
2. **`routine-send.ts`:**
   - load the routine once per run (with the message lookup) and build `{ v: 0, type: 'routine', data: { id, title, schedule: describeSchedule(parsed) } }`, truncating the title to 80 characters;
   - pass it as `{ payload }` on both `sendMessage` and `sendCorrection`;
   - when the routine can't be loaded or parsed, send without a payload, as today;
   - keep the file under 400 lines, and extend `routine-send.test.ts` to check that the payload rides on both the send and the correction.
3. **The fallbacks:**
   - in `group-turn.ts`, when `trigger.scheduled !== undefined`, skip the fallback send entirely;
   - in `turn-defect.ts`, add an optional `scheduled?: boolean` to the input, skip the send when it's true, and pass `scheduled: trigger.scheduled !== undefined` from `dm-turn.ts`.

   A failed run is still recorded by the scheduler; it just posts no extra message.

### Allowed files
- `packages/protocol/src/routine.ts`
- `packages/protocol/src/payload.ts`
- `packages/protocol/src/payload.test.ts`
- `packages/protocol/src/index.ts`
- `apps/server/src/agents/gateway/routine-send.ts`
- `apps/server/src/agents/gateway/routine-send.test.ts`
- `apps/server/src/agents/gateway/group-turn.ts`
- `apps/server/src/agents/gateway/turn-defect.ts`
- `apps/server/src/agents/gateway/dm-turn.ts`
- `work/T-1721-routine-payload.md`

### Checks
```bash
pnpm --filter @zilar/protocol exec vitest run src/payload.test.ts --reporter=dot
pnpm --filter @zilar/server exec vitest run src/agents/gateway/routine-send.test.ts src/actions/args-example.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The routine message and every edit of it** carry the `routine` payload `{ id, title, schedule }`.
- **A scheduled run that fails** posts no extra message.
- **The tests pass.**

---

## Report (written by the worker when done)

### What I did

- **Protocol** (`packages/protocol`): added `src/routine.ts` with
  `RoutinePostSchema` (`{ id: 1-64, title: 1-80, schedule: 1-80 }`) and the
  `RoutinePost` type; added the `{ v: 0, type: 'routine', data: RoutinePostSchema }`
  union member in `payload.ts`; re-exported `./routine` from `index.ts` next to
  `./question`; added a `routine` example to the round-trip decode case in
  `payload.test.ts` (and its entry in `expectedTypes`).
- **`routine-send.ts`**: added an injectable `loadRoutine` (defaults to
  `findRoutineById`). The stored message and the routine are now read together
  once per run in `loadTarget`; the payload is built from the row as
  `{ v: 0, type: 'routine', data: { id, title: title.slice(0, 80), schedule: describeSchedule(parseRoutineSchedule(schedule)) } }`.
  A routine that cannot be loaded, whose schedule does not parse, or whose title
  is empty yields no payload and the send goes out exactly as before. The
  payload rides as `{ payload }` on both `sendMessage` and `sendCorrection`.
- **Failure fallbacks**: `group-turn.ts` now guards the `@name <failure>` send
  behind `trigger.scheduled === undefined`; `turn-defect.ts` takes an optional
  `scheduled?: boolean` and skips `liveSendMessage` when it is true, and
  `dm-turn.ts` passes `scheduled: trigger.scheduled !== undefined`. The failure
  is still logged and the scheduler still records it; the typing `paused` state
  and `endDrafts` are unchanged.
- Extended `routine-send.test.ts`: harness injects a fake routine; new cases
  cover the payload on the first send and on the edit, title truncation to 80,
  and the no-payload paths (routine missing, schedule unparseable).

### Checks run

`pnpm --filter @zilar/protocol test --maxWorkers=2 --reporter=dot src/payload.test.ts`
→ 1 file passed, 15 tests passed.

`pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway/routine-send.test.ts src/actions/args-example.test.ts`
→ 2 files passed, 27 tests passed.

`pnpm gate` (repo root) → GATE PASS. Summary lines:
```
gate: 10 changed file(s) against main
PASS  install (frozen)  (2.5s)
PASS  format  (2.0s)
PASS  lint  (1.1s)
PASS  typecheck  (3.9s)
PASS  effect  (1.0s)
PASS  tests @zilar/protocol  (1.2s)
PASS  tests @zilar/server  (14.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
(The first gate run failed on format for `routine-send.ts`; I ran
`pnpm exec prettier --write` on that one file and re-ran the gate.)

### Notes for the lead

- The routine header is posted with the message that everyone in the chat can
  see, so it carries only the routine id, title and the schedule in words — no
  prompt text or secrets.
- When the routine can't be loaded/parsed the message still posts (T-1714
  behaviour) but without the header payload; a client then shows it as a plain
  message.
- I left the typing `paused` state and `endDrafts` in the failure paths: only
  the extra message send is silenced.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 3 nits, accepted.
  - The owner's once-a-day failure DM (`notifyOwnerOfFailure`) stays on purpose: it's the owner's only signal that a routine fails, and it's capped at one a day per room.
- **The change:**
  - the `routine` payload `{ id, title, schedule }` (`packages/protocol/src/routine.ts`), with lengths checked;
  - `routine-send.ts` loads the routine once per run and attaches the payload to both the send and the correction;
  - the room @mention fallback and the DM failure reply are skipped for scheduled runs.
- **The tests:** the lead ran `routine-send.test.ts` plus the `args-example` boot guard in the worktree: 27 tests passed.
- **Next:** T-1722 is the client side (the header and the chat bump).
