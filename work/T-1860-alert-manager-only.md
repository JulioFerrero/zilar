---
id: T-1860
title: "Alert card A4: an alert answer on a card linked to a routine is allowed only for that routine's manager (anyone else gets the card's same 404, nothing recorded); the pause/resume it causes is audited (routine.paused / routine.resumed, ids only)"
status: merged
milestone: M5
branch: task/T-1860-alert-manager-only
model: auto
effort: default
depends_on: [T-1856]
estimate: 30 min
---

# T-1860: Only the routine's manager answers a linked alert (alert plan A4)

## Spec (written by Claude, do not edit)

### Why
**Julio's answer to the plan's question 3 (2026-10-17):** only the routine's manager may toggle an alert.
- **T-1856 made a linked alert answer** pause or resume the routine and set its threshold, but any card member may still answer, and nothing is audited.
- **This must merge before anything can set a link** (a later task lets `post_blocks` name the routine).

### Facts (read by the lead on 2026-10-17)
- **`respondToCard`** (`apps/server/src/message-blocks/respond.ts:314-357`; the file has 357 lines):
  1. `findCard`;
  2. `requireCardAccess` (a stranger gets `cardNotFound()`, the same 404 as an unknown card);
  3. finds the block and calls `recordedResponse`;
  4. upserts;
  5. for an `alert` block, calls `applyAlertToRoutine(deps, card, input.blockId, userId, recorded.value)` (T-1856);
  6. merges and corrects.

  `CardRespondDeps` is `{ db, logger, correctInRoom? }` (`:66-71`).
- **`findAlertRoutine(db, cardId, blockId)`** is in `apps/server/src/routines/alert-link.ts`.
- **`applyAlertToRoutine`** is in `apps/server/src/message-blocks/alert-routine.ts` (58 lines). It calls `pauseRoutine(db, id, actorId, now)` and `resumeRoutine(db, id, actorId, now)` without the optional `audit` argument. Those two functions audit `routine.paused`/`routine.resumed` when `audit` is given (`apps/server/src/routines/support.ts:160-207, 213-275`).
- **`routineAccess(db, routineId, userId)`** (`apps/server/src/routines/access.ts:18-28`) returns `{ routine, manager }` or `null`. The manager is the AI's owner, or a group owner/admin who can see the topic.
- **The API:** `createMessageBlocksApi` (`apps/server/src/message-blocks/api.ts:52-90`) builds `respondToCard` deps as `{ db: deps.db, logger, correctInRoom? }`. It's mounted at `apps/server/src/app/routes-messaging.ts:117-120` with `{ ...base, ...opt('getGateway', …) }`. Other APIs in that file get `audit` explicitly, e.g. `createBlocksApi({ ...base, adminClient, audit })` at `:65`.

### Steps
1. **The manager check:** in `respondToCard`, for an `alert` block, **before** recording anything:
   - look up `findAlertRoutine(deps.db, card.originId, input.blockId)`;
   - if one exists, require `(await routineAccess(deps.db, routine.id, userId))?.manager === true`. Otherwise throw `cardNotFound()`, and write nothing;
   - an unlinked alert keeps today's behaviour.

   Put the check in `alert-routine.ts` (e.g. `requireAlertManager`) so `respond.ts` grows by 3 lines at most.
2. **The audit:**
   - add `audit?: AuditRecorder` to `CardRespondDeps` and pass it through `applyAlertToRoutine` to `pauseRoutine`/`resumeRoutine`;
   - in `createMessageBlocksApi`, accept `audit?: AuditRecorder` and pass it;
   - mount with `audit` in `routes-messaging.ts`.
3. **Test (permissions):** one test in `apps/server/src/message-blocks/respond.test.ts`, next to the T-1856 alert test. With a routine linked to the alert card:
   - a plain group member who is not a manager answers `{ done: false }` and gets a 404 with no response row written, and the routine stays `active`;
   - the AI's owner answers the same and the routine becomes `paused`, with one `routine.paused` audit entry if the test setup exposes audit rows. Otherwise just assert the status.
4. **Every source file stays at most 400 lines.**

### Allowed files
- `apps/server/src/message-blocks/respond.ts`
- `apps/server/src/message-blocks/alert-routine.ts`
- `apps/server/src/message-blocks/api.ts`
- `apps/server/src/app/routes-messaging.ts`
- `apps/server/src/message-blocks/respond.test.ts`
- `work/T-1860-alert-manager-only.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/message-blocks/respond.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **On a linked alert,** only the routine's manager can answer; anyone else gets the same 404 with nothing recorded.
- **Pause and resume** from an alert are audited.
- **Unlinked alerts** behave as before.
- The test passes, and so does the gate.

---

## Report (written by the worker when done)

### What I did
- Added `requireAlertManager(db, cardId, blockId, userId)` to `alert-routine.ts`: it looks up the alert's linked routine; when one exists it requires `routineAccess(...).manager === true`, otherwise throws the card's usual 404 (`card_not_found`). Unlinked alerts pass through unchanged.
- `respondToCard` calls that check for an `alert` block after the card access check and before anything is recorded (2 added lines, no change to the rest of the flow).
- Added optional `audit?: AuditRecorder` to `CardRespondDeps`, threaded it through `applyAlertToRoutine` into `pauseRoutine` / `resumeRoutine`, accepted it in `createMessageBlocksApi`, and mounted the API with the app's existing `audit` recorder in `routes-messaging.ts`. Audit entries keep ids only (`reason: 'user'` detail comes from the existing routine helpers).
- Tests in `respond.test.ts`: the test setup now builds a real `createAuditRecorder({ db })`; the T-1856 linked-routine test answers as the AI's owner instead of a plain member (the previous member answer is now correctly refused); added a test where a plain member gets a 404 with no response row, no card correction and the routine still `active`, then the owner pauses it and exactly one `routine.paused` audit entry appears with `subjectId` = routine id and `actorUserId` = owner.
- All changed source files are within 400 lines (`respond.ts` 362, `respond.test.ts` 380, `alert-routine.ts` 88, `api.ts` 116, `routes-messaging.ts` 174).

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/message-blocks/respond.test.ts` → 1 file passed, 7 tests passed.
- `pnpm gate` (first run failed only on Prettier in `respond.test.ts`; fixed formatting on that file, no logic change) → final run:
  ```
  PASS  install (frozen)  (2.2s)
  PASS  format  (1.3s)
  PASS  lint  (1.6s)
  PASS  typecheck  (8.4s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/server  (11.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- Deviation in the test file: the existing T-1856 test ("drives the linked routine…") used a plain member as the actor, which contradicts the new rule, so it now answers as the AI's owner. Its assertions are otherwise unchanged.
- `respond.ts` already had a private `cardNotFound()`; `alert-routine.ts` now has the same small factory to keep the import direction one-way (no circular import). Both produce the identical `404 card_not_found "Card not found"`.
- No changes outside the Allowed files. No new dependencies or migrations.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `cf2249e0c`.
- **The manager check:** `requireAlertManager` runs before anything is recorded. A linked alert needs `routineAccess(...).manager`, and anyone else gets the same `card_not_found` 404 as `respond.ts:79-81`. Unlinked alerts are unchanged.
- **The audit:** it is threaded from the mount (`routes-messaging.ts`) through the API into `pauseRoutine` and `resumeRoutine`.
- **The test** covers a plain member (404, nothing recorded, the routine stays active) and the AI owner (paused).
- **Linking can now be enabled safely:** `post_blocks` naming a routine is the next alert task.

