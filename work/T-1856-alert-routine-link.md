---
id: T-1856
title: "Alert card A2: migration 0074 adds routines.alert_card_id / alert_block_id with a partial unique index; an alert answer on a linked card updates that routine — the threshold into input.threshold, off pauses (paused_reason user), on resumes only a user-paused routine"
status: merged
milestone: M5
branch: task/T-1856-alert-routine-link
model: auto
effort: default
depends_on: [T-1848]
estimate: 40 min
---

# T-1856: Link an alert card to its routine (alert plan A2)

## Spec (written by Claude, do not edit)

### Why
**Julio took option B of `docs/plan/alert-card.md` (2026-10-17):** the alert card drives one routine row (`:176-200`). T-1848 records the answer.
- **This task** stores the card↔routine link and makes an answer on a linked card change that routine.
- **Nothing sets the link yet:** a later task lets `post_blocks` name the routine. So this is inert on live until then, and a later task (A4) makes the answer manager-only before the link can be set.
- **It is a DB-schema task.**

### Facts (read by the lead on 2026-10-17)
- **The latest migration** is `apps/server/drizzle/0073_card-media.sql`, which starts with `SET lock_timeout = '5s';--> statement-breakpoint`. The new one is **0074**.
- **`RoutineRow`** (`apps/server/src/db/rows-agents.ts:153-180`) has:
  - `input: unknown` (free JSON);
  - `status: 'active' | 'paused' | 'needs_approval'`;
  - `pausedReason: 'user' | 'failures' | 'hosts_changed' | null`;
  - `deletedAt`.

  The file has 276 lines.
- **`apps/server/src/routines/support.ts`** (324 lines):
  - `pauseRoutine(db, id, actorId, now, audit?)` (`:160-207`) sets `status = 'paused', paused_reason = 'user'` only when it is active, and audits `routine.paused`;
  - `resumeRoutine(db, id, actorId, now, audit?)` (`:213-275`) refuses `needs_approval` with a `RoutineServiceError`, resets the failures and recomputes `next_run_at`, and audits `routine.resumed`.
- **`respondToCard`** (`apps/server/src/message-blocks/respond.ts:303-354`; the file has 354 lines):
  1. finds the card;
  2. checks access;
  3. calls `recordedResponse`, which for an `alert` returns `value: { on?: boolean; threshold?: string }` (T-1848);
  4. upserts;
  5. merges and corrects the card.

  `CardRespondDeps` is `{ db, logger, correctInRoom? }` (`:66-71`). `card.originId` is the card id.
- **The threshold text** is checked by `isNumberText` in `respond.ts`: strip spaces and commas and one leading `$€£`, then `Number(...)` must be finite.

### Steps
1. **Migration `apps/server/drizzle/0074_alert-card-link.sql`:** start with the lock timeout line, then:
   - `ALTER TABLE "routines" ADD COLUMN "alert_card_id" text, ADD COLUMN "alert_block_id" text;`
   - `CREATE UNIQUE INDEX "routines_alert_card_idx" ON "routines" ("alert_card_id", "alert_block_id") WHERE "alert_card_id" IS NOT NULL AND "deleted_at" IS NULL;`
2. **`RoutineRow`:** add `alertCardId: string | null` and `alertBlockId: string | null`.
3. **New `apps/server/src/routines/alert-link.ts`:**
   - `linkAlertCard(db, routineId, cardId, blockId)` sets the two columns. On a unique violation it fails with a typed `AlertLinkTaken` error.
   - `findAlertRoutine(db, cardId, blockId)` returns the non-deleted routine or `undefined`.
   - `setRoutineThreshold(db, id, threshold: number, now)` sets `input = jsonb_set(coalesce(input,'{}'::jsonb), '{threshold}', to_jsonb(threshold))` and `updated_at`.
4. **New `apps/server/src/message-blocks/alert-routine.ts`:** `applyAlertToRoutine(deps, card, blockId, actorId, value)`, called from `respondToCard` right after the upsert, only for an `alert` block.
   - **No linked routine:** nothing happens.
   - **`threshold` present:** call `setRoutineThreshold` with the parsed number (the same strip rule).
   - **`on === false`:** `pauseRoutine`.
   - **`on === true`:** `resumeRoutine` only when `pausedReason === 'user'`. A routine paused for `failures` or `hosts_changed`, or one that `needs_approval`, is left as it is, and the card's `on` stays as the person set it.
   - **Errors are logged** (ids only) and never fail the answer.
5. **Test (permissions / the message pipeline):** one test, next to the alert case in `apps/server/src/message-blocks/respond.test.ts`. Link a routine to the alert card with `linkAlertCard`, then answer:
   - `{ done: false, fields: { value: '$95,000' } }` leaves the routine `paused`/`user` with `input.threshold === 95000`;
   - `{ done: true }` makes it `active` again;
   - a second `linkAlertCard` of another routine to the same card and block fails with `AlertLinkTaken`.
6. **Every source file stays at most 400 lines.** `respond.ts` grows by at most 3 lines.

### Allowed files
- `apps/server/drizzle/0074_alert-card-link.sql`
- `apps/server/src/db/rows-agents.ts`
- `apps/server/src/routines/alert-link.ts`
- `apps/server/src/message-blocks/alert-routine.ts`
- `apps/server/src/message-blocks/respond.ts`
- `apps/server/src/message-blocks/respond.test.ts`
- `work/T-1856-alert-routine-link.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/message-blocks/respond.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **Migration 0074** applies.
- **On a linked card,** an alert answer sets the routine's threshold and pauses or resumes it (a user pause only).
- **One card block** links to at most one live routine.
- **An unlinked card** behaves as before.
- The test passes, and so does the gate.

---

## Report (written by the worker when done)

### What I did

- **Migration `apps/server/drizzle/0074_alert-card-link.sql`** (new): lock timeout line, `routines.alert_card_id` + `routines.alert_block_id`, and the partial unique index `routines_alert_card_idx` on `(alert_card_id, alert_block_id)` where `alert_card_id IS NOT NULL AND deleted_at IS NULL`.
- **`apps/server/src/db/rows-agents.ts`**: `RoutineRow` now has `alertCardId` and `alertBlockId`.
- **`apps/server/src/routines/alert-link.ts`** (new): `linkAlertCard` (UPDATE of the two link columns; a unique violation maps to the typed `AlertLinkTaken` error via `isUniqueViolation`), `findAlertRoutine` (live routine for one card block, `deleted_at IS NULL`), and `setRoutineThreshold` (`jsonb_set(coalesce(input,'{}'),'{threshold}',to_jsonb(...))` plus `updated_at`).
- **`apps/server/src/message-blocks/alert-routine.ts`** (new): `applyAlertToRoutine` — no linked routine does nothing; a threshold string becomes a number with the same strip rule and is written to the routine; `on === false` pauses; `on === true` resumes only a `pausedReason === 'user'` routine. All errors are caught, logged with card/block ids only, and never fail the answer. Carries `// effect-plain:` because it is the Promise edge over the async routine helpers.
- **`apps/server/src/message-blocks/respond.ts`**: one import and a 2-line call right after the response upsert, only when the block is an alert. `respond.ts` went 354 → 357 lines (+3).
- **`apps/server/src/message-blocks/respond.test.ts`**: new test after the existing alert case — links a prompt routine to (`alert-origin`, `alert-1`), answers `{ done: false, fields: { value: '$95,000' } }` and checks `status = paused`, `pausedReason = 'user'`, `input.threshold === 95000`, then answers `{ done: true }` and checks the routine is `active`/`pausedReason = null` with the threshold kept, and finally checks that a second `linkAlertCard` of another routine to the same card block rejects with `AlertLinkTaken`.

### Checks run

- `pnpm --filter @zilar/server exec vitest run src/message-blocks/respond.test.ts --reporter=dot` → `Test Files 1 passed (1)`, `Tests 6 passed (6)` (ran twice, same result).
- `pnpm gate` from the repo root (final run):
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.9s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/server  (9.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The 7 changed files are the 6 allowed source/migration files plus this task file.
- The migration applies: the test context builds a fresh PGlite database from `drizzle/`, so `0074` (and the `jsonb_set` update) ran in the passing test.

### Deviations / notes for the lead

- **`RoutineRow.alertCardId` / `alertBlockId` are optional** (`?: string | null`) instead of required. With them required, typecheck failed in `apps/server/src/agents/gateway/routine-send.test.ts` and `apps/server/src/routines/blocks-post.test.ts`, whose local `routineRow()` fixtures build a complete `RoutineRow` and are outside this task's Allowed files. Real rows always carry the columns (null when unlinked); the first task allowed to edit those two fixtures can make the fields required again. Flagging it because the spec wrote them as required.
- Link changes do **not** audit: `pauseRoutine`/`resumeRoutine` receive no `AuditRecorder` because `CardRespondDeps` has none. If the lead wants `routine.paused`/`routine.resumed` audit rows from a card answer, that needs an audit recorder threaded into the block deps — out of scope here.
- `linkAlertCard` is a plain UPDATE scoped by routine id and `deleted_at IS NULL`; a missing/deleted routine silently links nothing (the spec asked for no error there). Atomicity of "one live routine per card block" comes from the partial unique index, not a pre-check.
- `applyAlertToRoutine` is called only for `alert` blocks; an unlinked card behaves exactly as before (the pre-existing alert answer test still passes).

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `887706474`.
- **Migration 0074:** the lock timeout, the two text columns, and the partial unique index on `(alert_card_id, alert_block_id)` for live rows.
- **`applyAlertToRoutine`:**
  - no link → nothing happens;
  - the threshold → `input.threshold`;
  - off → `pauseRoutine`;
  - on → `resumeRoutine` only after a user pause;
  - errors are logged with ids only.
- **The test** covers pause plus threshold, resume, and the second link being refused.
- **Next, A4:** manager-only answers on a linked alert, with the pause and resume audited (no audit is passed yet). It must merge before anything can set a link.
- **Follow-up:** make `alertCardId`/`alertBlockId` required in `RoutineRow` when a task may edit the two test fixtures.

