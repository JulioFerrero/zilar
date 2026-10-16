---
id: T-1638
title: "Scheduled AI jobs step 1 (DB): migration 0067 lets a routine be a prompt (kind tool|prompt, nullable tool_id, prompt column, checks) and adds the routine_prompt_runs daily counter; RoutineRow follows; tool routines behave exactly as before"
status: merged
milestone: M5
branch: task/T-1638-routine-kind-migration
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1638: Routines can hold a prompt (schema only)

## Spec (written by Claude, do not edit)

### Why
Julio wants scheduled AI jobs, for example "every morning post gold, S&P 500 and BTC". The AI does it with its own tools or computer, which today's tool-only routines can't.

The plan (T-1614, `docs/plan/scheduled-ai-jobs.md` §2.1 and §4 task 1) adds a `prompt` kind to `routines`. **This task is the schema only.** Nothing creates a prompt routine yet. This is the only DB task in flight.

### Facts (the lead read them on 2026-10-16)
- **Migrations** are hand-written SQL in `apps/server/drizzle/`, run at startup by `migrateSql` (`apps/server/src/effect/sql.ts:301`). The last is `0066_ai_questions.sql`, which starts with `SET lock_timeout = '5s';--> statement-breakpoint`. Its task (T-1571) didn't touch `drizzle/meta/_journal.json`.
- **`RoutineRow`** is at `apps/server/src/db/rows-agents.ts:152-172` (197 lines), with `toolId: string;`.
- **Readers of a routine's `toolId`** (non-test):
  - `apps/server/src/routines/execute.ts:133` (`WHERE id = ${row.toolId}`), `:143` (`readCurrentHosts(db, row.toolId, …)`) and `:158` (`runToolVersion(… { toolId: row.toolId, … })`);
  - `apps/server/src/routines/queries.ts:138`, in `toPublicRoutine`, `toolId: row.toolId`;
  - `apps/server/src/routines/schemas.ts:65`, `PublicRoutine.toolId: string`;
  - `apps/server/src/routines/wire.ts:9` (`toolId: routine.toolId`). The API contract already has `toolId: Schema.optional(Schema.String)` (`packages/api-contract/src/routines.ts:14`).

### Steps
1. **New file `apps/server/drizzle/0067_routine_kind.sql`,** exactly (expand-only):
   ```sql
   SET lock_timeout = '5s';--> statement-breakpoint
   ALTER TABLE "routines" ADD COLUMN "kind" text DEFAULT 'tool' NOT NULL;--> statement-breakpoint
   ALTER TABLE "routines" ALTER COLUMN "tool_id" DROP NOT NULL;--> statement-breakpoint
   ALTER TABLE "routines" ADD COLUMN "prompt" text;--> statement-breakpoint
   ALTER TABLE "routines" ADD CONSTRAINT "routines_kind_check" CHECK ("kind" IN ('tool', 'prompt'));--> statement-breakpoint
   ALTER TABLE "routines" ADD CONSTRAINT "routines_tool_kind_needs_tool" CHECK (("kind" = 'tool') = ("tool_id" IS NOT NULL));--> statement-breakpoint
   ALTER TABLE "routines" ADD CONSTRAINT "routines_prompt_kind_needs_prompt" CHECK (("kind" = 'prompt') = ("prompt" IS NOT NULL));--> statement-breakpoint
   CREATE TABLE "routine_prompt_runs" (
   	"ai_id" text NOT NULL REFERENCES "ais"("id") ON DELETE CASCADE,
   	"day" date NOT NULL,
   	"count" integer DEFAULT 0 NOT NULL,
   	PRIMARY KEY ("ai_id", "day")
   );
   ```
   Follow `0066_ai_questions.sql`'s format for anything else (the statement-breakpoint style). If the migration gate or `migrateSql` needs a journal entry, add it the way 0066 did (it didn't).
2. **`RoutineRow`:** `kind: 'tool' | 'prompt';`, `toolId: string | null;` and `prompt: string | null;`. Add one comment line (T-1638) saying a prompt routine has no tool.
3. **Typecheck fallout, behaviour unchanged for tool routines:**
   - **`execute.ts`:** right before step 2 (`:128`), narrow once with `const toolId = row.toolId;`. If it's `null`, take the same branch as a missing tool (`await pauseForFailures(db, options, ports, row, at, startedAt, true); return;`), with a comment that prompt runs come in a later task. Then use `toolId` at `:133`, `:143` and `:158`.
   - **`PublicRoutine.toolId`** becomes `string | null` (`schemas.ts:65`); `toPublicRoutine` passes it through; `wire.ts:9` sends `routine.toolId ?? undefined`.
   - If SQL reads list columns explicitly and miss `kind`/`prompt`, add them. Grep `FROM routines` in `apps/server/src/routines/`.
4. **Change nothing else:** no creator, no scheduler change, no UI.

### Allowed files
- `apps/server/drizzle/0067_routine_kind.sql`
- `apps/server/drizzle/meta/_journal.json`
- `apps/server/src/db/rows-agents.ts`
- `apps/server/src/routines/execute.ts`
- `apps/server/src/routines/queries.ts`
- `apps/server/src/routines/schemas.ts`
- `apps/server/src/routines/wire.ts`
- `apps/server/src/routines/reads.ts`
- `apps/server/src/routines/support.ts`
- `apps/server/src/routines/scheduler.ts`
- `work/T-1638-routine-kind-migration.md`

Touch `_journal.json`, `reads.ts`, `support.ts` and `scheduler.ts` only if step 3 needs them.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/routines/execute.test.ts src/routines/scheduler.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The migration applies** (the PGlite tests run it).
- **The existing routine tests pass unchanged.**
- **A tool routine runs exactly as before.**
- **Every file stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did

Schema-only change so a routine can later hold a prompt.

- **`apps/server/drizzle/0067_routine_kind.sql`** (new): the exact SQL from the spec, expanded only — adds `kind text DEFAULT 'tool' NOT NULL`, drops `NOT NULL` on `tool_id`, adds `prompt text`, adds the three named CHECK constraints, and creates `routine_prompt_runs` (`ai_id`, `day`, `count`, PK `(ai_id, day)`). Starts with `SET lock_timeout = '5s';` and uses `--> statement-breakpoint`, matching `0066_ai_questions.sql`.
- **`apps/server/src/db/rows-agents.ts`**: `RoutineRow` now has `kind: 'tool' | 'prompt'`, `toolId: string | null`, `prompt: string | null`, plus the one T-1638 comment line.
- **`apps/server/src/routines/execute.ts`**: right before step 2 I narrow once with `const toolId = row.toolId;`. If it is `null` (a prompt routine), it takes the same branch as a missing tool (`pauseForFailures(..., true)`), with a comment that prompt runs come in a later task. `toolId` is used at the tool lookup, `readCurrentHosts` and `runToolVersion`. Behaviour for a tool routine is byte-for-byte the same.
- **`apps/server/src/routines/schemas.ts`**: `PublicRoutine.toolId` is now `string | null`.
- **`apps/server/src/routines/wire.ts`**: `toListWire` sends `routine.toolId ?? undefined`, matching the API contract's `Schema.optional(Schema.String)`.
- **`apps/server/src/routines/queries.ts`**: no change needed — `toPublicRoutine` already passes `row.toolId` straight through (now `string | null`).

`_journal.json`, `reads.ts`, `support.ts` and `scheduler.ts` needed no changes: the journal stops at `0046` and never listed `0066` either, and the only SQL reads of `routines` are `SELECT *` (plus test-only column lists).

Files changed (6): `0067_routine_kind.sql` (new), `rows-agents.ts`, `execute.ts`, `schemas.ts`, `wire.ts`, `work/T-1638-routine-kind-migration.md`.

### Checks run

- `pnpm install` — Done in 18.5s (pnpm 10.32.1).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/execute.test.ts src/routines/scheduler.test.ts` — `Test Files 2 passed (2)`, `Tests 3 passed (3)`. These run PGlite with `migratePglite` (`src/test-support.ts:315`), so the new migration is applied on a real database.
- `pnpm gate` — summary:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.8s)
  PASS  lint  (1.2s)
  PASS  typecheck  (4.4s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/server  (11.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- No creator, scheduler or UI change (step 4 of the spec): nothing inserts a prompt routine yet.
- `git diff --stat main` also lists `model-client.ts`, `model-errors.ts`, `BOARD.md` and `T-1636-…md`, but those are commits on `main` this branch does not have — `git status` shows only my 6 files, and the gate's scope check agrees.

## Review (written by Claude)

**Approved and merged.** This is scheduled AI jobs step 1.

- **Pre-review:** clean, 1 nit (below).
- **Migration `0067_routine_kind.sql`** is expand-only:
  - `kind` defaults to `'tool'`, `tool_id` becomes nullable, and `prompt` is added;
  - three checks keep tool and prompt rows consistent;
  - the `routine_prompt_runs` counter table is added.
- **The row type:** `RoutineRow` has `kind`, `toolId: string | null` and `prompt`. Every routine read is `SELECT *`, so the new columns arrive.
- **`execute.ts`** narrows `toolId` once. A null takes the missing-tool branch, which is today's behaviour for that state. No prompt rows exist until the creator ships (plan task 6, after a drained release).
- **The tests:** the lead ran `execute.test.ts` and `scheduler.test.ts`: passed.
- **The nit, deferred:** no test covers the null branch. Plan task 5 replaces that branch with the prompt dispatch and tests it there.

