---
id: T-1871
title: "Alert link task 2: routine.schedule takes an optional alert_card {card, block} (both forms); prepareArgs checks the card is this AI's, in this group/topic, and has that alert block; describe says it links the alert card; execute passes alertCard to createRoutine/createPromptRoutine; one test"
status: merged
milestone: M5
branch: task/T-1871-schedule-alert-card
model: auto
effort: default
depends_on: [T-1869, T-1870]
estimate: 40 min
---

# T-1871: `routine.schedule` links the alert card (alert link plan, task 2)

## Spec (written by Claude, do not edit)

### Why
**This is task 2 of `docs/plan/alert-card-link.md` §6** (option (a)).
- **T-1869:** the AI learns the card id from `post_blocks`.
- **T-1870:** `createRoutine` and `createPromptRoutine` accept `alertCard` and write it in the `INSERT`.
- **This task lets the model pass the card on `routine.schedule`.** The pair lives in the hashed approval args, so the approved card and the executed action can't disagree (plan §3, §5). This is a permission edge (who may link which card), so it gets one test.

### Facts (read by the lead on 2026-10-17)
- **`apps/server/src/tools/tool-arg-schemas.ts`:**
  - `routineToolScheduleArgsSchema` (`:102-108`) and `routinePromptScheduleArgsSchema` (`:111-115`) are strict structs;
  - `routineScheduleArgsSchema` is their union (`:120-123`).
- **`apps/server/src/tools/routine-adapters.ts`** (323 lines), `routineScheduleAdapter` (`:88`):
  - `prepareArgs` (`:100-117`) returns the args early unless it binds hosts;
  - `describe` (`:118-136`);
  - `execute`: the prompt branch calls `createPromptRoutine` (`:158-170`), and the tool branch calls `createRoutine` (`:206-221`). A `RoutineServiceError` becomes `serviceFailure(error)`, which falls back to `error.message` (`apps/server/src/tools/adapter-support.ts:108-128`). So `alert_card_taken` reaches the approver's outcome as "That alert card already drives another routine".
- **`apps/server/src/message-blocks/cards.ts:83`:** `findCard(db, id)` returns `BlockCardRow | null`, which is `{ originId, aiId, groupId, topicId, roomJid, data }` (`apps/server/src/db/rows-agents.ts:188-198`).
- **Decoding the card data:** `Schema.decodeUnknownOption(BlocksDataSchema)(card.data)` (`apps/server/src/message-blocks/respond.ts:92`). An alert block is `{ kind: 'alert', id, … }` (`packages/protocol/src/blocks-choices.ts:147-158`).
- **`ActionContext`** carries `aiId`, `groupId` and `topicId` (used at `routine-adapters.ts:206-214`).
- **Existing tests** for this adapter are in `apps/server/src/tools/routine-schedule-prompt.test.ts` (237 lines).

### Steps
1. **`tool-arg-schemas.ts`:** add `alert_card: Schema.optional(struct({ card: IdSchema-like string 1..128, block: same }))` to **both** forms, using the existing id-string helpers in that file or `IdSchema` from `@zilar/protocol`.
2. **`routine-adapters.ts` `prepareArgs`:** when `alert_card` is present, run these checks first, before the existing early returns:
   - `findCard(state.db, card)`;
   - throw `new Error('no such alert card')` unless all of these hold:
     - the row exists;
     - `row.aiId === actionCtx.aiId`;
     - `row.groupId` equals `actionCtx.groupId` and `row.topicId` equals `actionCtx.topicId` (null-safe);
     - the decoded blocks contain an `alert` block with `id === block`.

   One fixed message for every case. The gateway answers a `prepareArgs` throw as `failed` (see the comment at `:96-99`).
3. **`describe`:** when `alert_card` is present, append " It also links the alert card above, so its switch and threshold drive this routine." to `details`. Don't print raw ids.
4. **`execute`:** pass `alertCard: { cardId: card, blockId: block }` to whichever create call runs.
5. **Test** (one new `it` in `routine-schedule-prompt.test.ts`, using its existing setup):
   - `prepareArgs` with an `alert_card` naming a card recorded for **another AI** rejects;
   - with this AI's card and a real alert block id, it passes, and `execute` creates a routine whose row has `alert_card_id` and `alert_block_id` set. Record the cards with `recordCard` (`apps/server/src/message-blocks/cards.ts:24`).
6. **Every file stays at most 400 lines.**

### Allowed files
- `apps/server/src/tools/tool-arg-schemas.ts`
- `apps/server/src/tools/routine-adapters.ts`
- `apps/server/src/tools/routine-schedule-prompt.test.ts`
- `work/T-1871-schedule-alert-card.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/tools/routine-schedule-prompt.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`routine.schedule` with `alert_card`** links the card only when it is this AI's, in this chat, and holds that alert block.
- **The approval card** says it links the alert card.
- **The created routine** carries the link.
- The test passes, and so does the gate.

---

## Report (written by the worker when done)

### What I did
- `tool-arg-schemas.ts`: both `routine.schedule` forms now take an optional
  `alert_card: { card, block }`, both fields validated with `IdSchema` from
  `@zilar/protocol`.
- `routine-adapters.ts` `prepareArgs`: when `alert_card` is present, before any
  existing early return, `findCard` loads the card and a single check requires
  that it exists, belongs to this AI, has the same group and topic (null-safe),
  and its decoded `BlocksData` holds an `alert` block with the named id. Every
  failure throws `new Error('no such alert card')`.
- `describe`: when `alert_card` is present, both the prompt and tool forms
  append " It also links the alert card above, so its switch and threshold
  drive this routine." to `details`; no raw ids are printed.
- `execute`: passes `alertCard: { cardId, blockId }` to `createPromptRoutine`
  and `createRoutine`.
- One new `it` in `routine-schedule-prompt.test.ts` using the existing setup and
  `recordCard`: a card recorded for another AI is rejected, a missing alert
  block on this AI's card is rejected, and this AI's card with `alert-1` passes
  `prepareArgs`, gets the linking sentence on the approval card, and creates a
  routine whose row has `alertCardId`/`alertBlockId` set.

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools/routine-schedule-prompt.test.ts`
  → `Test Files 1 passed (1)`, `Tests 8 passed (8)`.
- `pnpm gate` (first run failed only on `format` for
  `routine-adapters.ts`; fixed with `prettier --write` on that file, then reran):
  ```
  PASS  install (frozen)  (2.4s)
  PASS  format  (0.9s)
  PASS  lint  (1.0s)
  PASS  typecheck  (1.0s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (16.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- The test also covers the "card has no such alert block" case in the same
  `it`, because the spec asks for one fixed message for every failure.
- Files stay within 400 lines (383, 156 and 302 lines).
- No deviations from the spec and no open questions.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `0564cd00c`.
- **`requireOwnAlertCard`** runs in `prepareArgs`, before the args are hashed. It requires:
  - the card row exists;
  - same AI, same group and topic;
  - a decoded `alert` block with that id.

  Every miss throws the same `no such alert card`.
- **`describe`** appends the link sentence without ids, and both create paths get `alertCard`.
- **The test** covers another AI's card (refused) and this AI's card (the routine row carries the link).
- **A `null`/`undefined` mismatch** between the action context and the card row can only refuse, never over-allow.
