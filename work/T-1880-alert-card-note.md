---
id: T-1880
title: "Alert card note (alert link plan task 6): each run of a routine linked to an alert card writes the alert block's note 'Checked <schedule> · now <value>' (≤40 chars), saves the card and corrects the card message in the room through a new optional correctCard routine port wired to the gateway's correctInRoom; a missing card or failed correction leaves the run as it was"
status: merged
milestone: M5
branch: task/T-1880-alert-card-note
model: auto
effort: default
depends_on: [T-1878]
estimate: 40 min
---

# T-1880: The alert card shows when it last checked (alert link plan, task 6)

## Spec (written by Claude, do not edit)

### Why
**The board's alert card says "Checked every 5 min · now $82,302"** under the switch (`docs/plan/alert-card.md` §1 and §5 step 4). T-1878 made a linked routine quiet below its threshold, so the card is the only sign the check is running. This is task 6 of `docs/plan/alert-card-link.md` §6.

### Facts (read by the lead on 2026-10-17)
- **`apps/server/src/routines/execute.ts`:**
  - `ExecuteRoutinePorts` is `{ runTool, post, runPrompt? }` (`:66-84`);
  - T-1878's `alertVerdict(row.input, outputData)` branch runs after the tool step. Its verdicts carry `value` for `post` and `quiet` (`apps/server/src/routines/alert-run.ts`).
- **The ports are passed through** `apps/server/src/routines/scheduler.ts` (`runPrompt` at `:36`, `:117`) and `apps/server/src/routines/wiring.ts` (`:20-37`, `:56-62`). They are built in `apps/server/src/startup/components.ts:83-95` (`post` via `postAsAi(() => running.gateway)`, `runPrompt` via `running.gateway`).
- **Card storage** (`apps/server/src/message-blocks/cards.ts`): `findCard(db, id)` (`:83`) and `saveCardData(db, originId, data)` (`:194`).
- **Card correction:**
  - `respond.ts:258-285` corrects a card with `correctInRoom({ aiId, roomJid, originalId, text: data.fallback, payload: { v: 0, type: 'blocks', data } })`;
  - `cardCorrectorOf(gateway)` (`apps/server/src/message-blocks/api.ts:36-48`) narrows the gateway to that call, and returns `null` without one.
- **The data decode:** `Schema.decodeUnknownOption(BlocksDataSchema)(card.data)` (as in `respond.ts:92`).
- **The alert block's `note`** is `ShortText`, at most 40 characters (`packages/protocol/src/blocks-choices.ts:157`, `MAX_SHORT = 40` in `blocks-numbers.ts:12`).
- **`describeSchedule(schedule)`** (`apps/server/src/tools/routine-adapters.ts:45`) words a schedule, and `parseRoutineSchedule` (`apps/server/src/routines/schedule.ts:131`) parses `row.schedule`.

### Steps
1. **`execute.ts`:**
   - add an optional port `correctCard?: (input: CorrectCardInput) => Promise<boolean>` (import the type from `../message-blocks/respond`);
   - after a `post` or `quiet` verdict, call `await refreshAlertNote(...)` with `{ db, ports, row, value, logger }`, before the existing `markOk` or post step.
2. **New `apps/server/src/routines/alert-note.ts`:** `refreshAlertNote(...)`.
   1. `findCard(db, row.alertCardId)`; decode its data; find the `alert` block with `id === row.alertBlockId`.
   2. Set `note` to `Checked ${describeSchedule(schedule)} · now ${value.toLocaleString('en-US')}`, cut to 40 characters.
   3. `saveCardData`, then `ports.correctCard?.(...)` as `respond.ts` does.
   - Any missing piece or thrown error is logged with the routine id only and swallowed. The run's outcome never changes.
3. **Pass `correctCard` through** `scheduler.ts` and `wiring.ts` like `runPrompt`, and build it in `components.ts`: `(input) => cardCorrectorOf(running.gateway)?.correctInRoom(input) ?? Promise.resolve(false)`.
4. **Test** (message pipeline): in `apps/server/src/routines/execute.test.ts`, one `it`. A linked routine with a recorded alert card and a quiet run → the saved card's alert block `note` starts with `Checked ` and contains `now 82,302`, and the fake `correctCard` was called once.
5. **Every file stays at most 400 lines.**

### Allowed files
- `apps/server/src/routines/alert-note.ts`
- `apps/server/src/routines/execute.ts`
- `apps/server/src/routines/execute.test.ts`
- `apps/server/src/routines/scheduler.ts`
- `apps/server/src/routines/wiring.ts`
- `apps/server/src/startup/components.ts`
- `apps/server/src/leader/start.ts` (lead answer to the question)
- `work/T-1880-alert-card-note.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/routines/execute.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **Every run of a linked alert routine** updates the card's note to "Checked … · now …" and corrects the card in the room.
- **A missing card or a failed correction** never changes the run's result.
- The test passes, and so does the gate.

---

## Report (written by the worker when done)

### What I did

- **`apps/server/src/routines/alert-note.ts`** (new): `refreshAlertNote({ db, ports, row, value, logger })`.
  It parses `row.schedule`, loads the card via `findCard(db, row.alertCardId)`, decodes
  its data with `BlocksDataSchema`, finds the `alert` block with `row.alertBlockId`, sets
  `note` to `Checked <describeSchedule(schedule)> · now <value.toLocaleString('en-US')>`
  cut to 40 characters, saves it with `saveCardData`, then calls
  `ports.correctCard({ aiId, roomJid, originalId, text: data.fallback, payload: { v: 0, type: 'blocks', data } })`
  exactly as `respond.ts` does. A missing card/block, unreadable schedule or data, a
  failed save, a `false` correction or a thrown error is logged with the routine id only
  and swallowed; the run's outcome never changes. For a long schedule the schedule wording
  is cut (with `…`) rather than the `now <value>` tail, which carries the point of the note.
- **`execute.ts`**: added the optional `correctCard?: (input: CorrectCardInput) => Promise<boolean>`
  port and call `refreshAlertNote(...)` for both `post` and `quiet` verdicts, before the
  quiet `markOk` or the post step.
- **`scheduler.ts` / `wiring.ts`**: `correctCard` travels like `runPrompt` (optional dep,
  passed only when defined).
- **`leader/start.ts`**: added `correctCard` to `LeaderWorkDeps` and forwarded it to
  `buildRoutineScheduler`. This file was added to Allowed files by the lead during the task
  (the spec listed only `scheduler.ts`/`wiring.ts`/`components.ts`, but the scheduler is
  built in `leader/start.ts`).
- **`startup/components.ts`**: built `correctCard` next to `runPrompt` as
  `cardCorrectorOf(running.gateway)?.correctInRoom(input) ?? Promise.resolve(false)` and
  passed it to `createLeaderWork`.
- **`execute.test.ts`**: extended the routine seed helper with `alertBlockId`, added one
  `it` under `executeRoutine alert card note`: a recorded alert card + linked quiet run →
  saved block `note` matches `^Checked .* now 82,302`, is ≤ 40 chars, the fake
  `correctCard` was called once with the card's origin/room, and the run is `ok` without
  posting.

### Checks run

- `pnpm --filter @zilar/server exec vitest run src/routines/execute.test.ts --reporter=dot`
  → `Test Files 1 passed (1)`, `Tests 3 passed (3)`.
- `pnpm gate` → exit 0, `GATE PASS`. Summary lines:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.3s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.6s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/server  (12.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Fix round: `pnpm --filter @zilar/server exec vitest run src/routines/execute.test.ts --reporter=dot`
  → `Test Files 1 passed (1)`, `Tests 4 passed (4)`; `pnpm gate` → exit 0, `GATE PASS`
  (format 1.5s, lint 0.8s, typecheck 3.4s, effect 0.6s, tests @zilar/server 11.3s, scope
  clean, `GATE PASS`).

### Notes for the lead

- Fix round: `refreshAlertNote` now returns early (logged with the routine id only) when the
  card's `aiId` differs from `row.aiId`, so a linked routine can never rewrite or correct
  another AI's card. Added one `it` in `execute.test.ts` ("leaves another AI's card
  untouched"): the run stays `ok`, the card note is unchanged and `correctCard` is never
  called.
- `leader/start.ts` was outside the original Allowed files; I asked, you confirmed and added
  it to the task file, and the change is the two-line pass-through plus its import.
- The note is written for a `post` run too (before the post attempt): the note records the
  check, not the delivery, so a later `skipped` post still leaves the last check visible.
- When a linked routine has an unreadable schedule, the note refresh is skipped (logged,
  swallowed); that case is not reachable through `createRoutine`, which validates the
  schedule before insert.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `d5742a109`.
- **The wiring:** I answered the worker's question; `correctCard` travels `components.ts` → `createLeaderWork` → `buildRoutineScheduler` → `executeRoutine`, like `post` and `runPrompt`.
- **One lead fix round** added the ownership guard: `refreshAlertNote` returns when `card.aiId !== row.aiId` (`alert-note.ts:66`), and a test covers it.
- **The note:** it keeps the value and cuts the schedule to fit 40 characters.
- **Failures:** a missing card or a failed correction is logged with the routine id only and never changes the run's outcome.
