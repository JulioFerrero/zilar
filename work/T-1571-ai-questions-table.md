---
id: T-1571
title: "AI questions step 3 (plan docs/audit/handoff-questions-plan.md): migration 0066_ai_questions.sql (expand-only), AiQuestionRow in db/rows-agents.ts, and apps/server/src/questions/service.ts with createQuestion, closeQuestion, findOpenQuestionByMessage and listOpenQuestions; a few service tests"
status: merged
milestone: M5
branch: task/T-1571-ai-questions-table
model: auto
effort: default
depends_on: []
estimate: 60 min
---

# T-1571: The ai_questions table and service

## Spec (written by Claude, do not edit)

### Why
Julio approved "a question with reply chips" on the AI work boards. `docs/audit/handoff-questions-plan.md` §3 and §7 step 3 plan its storage, and the lead's answers are in `work/T-1566-audit-handoff-questions.md` › Review:
- a new table, not `approvals`;
- closed by the first reply or after 24 h;
- the asking AI's turn ending does not close it.

This task adds the table and a small service only. The tool, cards and answer path come later. **This is the only schema task running.**

### Facts (the lead read them on main, 2026-10-15)
- **Migrations:** hand-written SQL in `apps/server/drizzle/`, run by `migrateSql` (`apps/server/src/db/migrate.ts`).
  - The latest is `0065_topic_follower.sql`. It starts `SET lock_timeout = '5s';--> statement-breakpoint`, and statements are separated by `--> statement-breakpoint`.
  - Commit `577531f9e` added it with only the `.sql` file plus `db/rows.ts`; no journal entry was added (`meta/_journal.json` ends at `0046`).
- **The model table:** `approvals` (`apps/server/drizzle/0011_silky_groot.sql:1-24`), with indexes `approvals_ai_status_idx` and `approvals_group_status_idx`.
- **Row types:**
  - `ApprovalRow` and `ApprovalInsert` are in `apps/server/src/db/rows-agents.ts` (161 lines; `:2`, `:23`);
  - `apps/server/src/db/rows.ts` is 379 lines, so **add the new row to `rows-agents.ts`**.
- **The service pattern:** `apps/server/src/approvals/service.ts:104-140` (an Effect `sql` template `INSERT … RETURNING *`, typed as the row). Its tests are in `apps/server/src/approvals/service.test.ts`.

### Steps
1. **`apps/server/drizzle/0066_ai_questions.sql`:**
   - `SET lock_timeout = '5s';`
   - `CREATE TABLE "ai_questions"`:
     - `id text PRIMARY KEY`;
     - `ai_id text NOT NULL REFERENCES "ais"("id") ON DELETE CASCADE`;
     - `group_id text`; `topic_id text`;
     - `room_jid text NOT NULL`;
     - `message_id text` (the posted card's stanza id, set after the send);
     - `question text NOT NULL`;
     - `options jsonb NOT NULL`;
     - `status text NOT NULL DEFAULT 'open'` (`open` | `answered` | `expired`);
     - `answer text`; `answered_by text`;
     - `expires_at timestamptz NOT NULL`;
     - `created_at timestamptz NOT NULL DEFAULT now()`;
     - `answered_at timestamptz`.
   - **Indexes:** `ai_questions_ai_status_idx (ai_id, status)`, `ai_questions_topic_status_idx (topic_id, status)` and `ai_questions_message_idx (message_id)`.
   - Match the column types the `approvals` table uses for `ai_id`, `group_id` and `topic_id`; read `0011` and say in the Report what you matched.
2. **`rows-agents.ts`:** `AiQuestionRow` and `AiQuestionInsert`, in the same style as `ApprovalRow`.
3. **New `apps/server/src/questions/service.ts`:**
   - `createQuestion(db, { aiId, groupId, topicId, roomJid, question, options, ttlMs = 24h })`;
   - `setQuestionMessageId(db, id, messageId)`;
   - `findOpenQuestionByMessage(db, messageId)`, which returns the row only when `status = 'open' AND expires_at > now()`;
   - `answerQuestion(db, id, { answer, answeredBy })`: open → answered, only if still open, and returns whether it changed;
   - `listOpenQuestions(db, { topicId })` for the activity read.
   - Validate: `question` 1–300 chars, 2–4 options of 1–40 chars each. Throw an `HttpError(400, …)` like the approvals service.
4. **A few tests** in `apps/server/src/questions/service.test.ts`, on the approvals test setup:
   - create + find by message;
   - answer once (a second answer returns false);
   - an expired question is not open;
   - bad options are refused.

### Not in scope
- the tool;
- the cards;
- the answer matching in ingest;
- activity;
- clients;
- the mock.

### Allowed files
- `apps/server/drizzle/0066_ai_questions.sql` (new)
- `apps/server/src/db/rows-agents.ts`
- `apps/server/src/questions/service.ts` (new)
- `apps/server/src/questions/service.test.ts` (new)
- `work/T-1571-ai-questions-table.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/questions/service.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The migration applies in the test database, the new tests pass, and the gate passes.
- The Report pastes the SQL.

---

## Report (written by the worker when done)

### What I did

Added the `ai_questions` table (expand-only) and a small server service, per
`docs/audit/handoff-questions-plan.md` §3d and the lead's answers 3, 6, 8.

- **`apps/server/drizzle/0066_ai_questions.sql`** (new): the table and its three
  indexes. Column types matched from `approvals`: `ai_id text NOT NULL`,
  `group_id text`, `topic_id text` (all `text`, as in
  `0011_silky_groot.sql`/`0021_eager_dark_beast.sql`). `ai_id` references
  `ais(id)`; `group_id`/`topic_id` have no FK, exactly as the spec's DDL block
  lists (the spec only writes `REFERENCES` for `ai_id`). The SQL:

  ```sql
  SET lock_timeout = '5s';--> statement-breakpoint
  CREATE TABLE "ai_questions" (
  	"id" text PRIMARY KEY NOT NULL,
  	"ai_id" text NOT NULL REFERENCES "ais"("id") ON DELETE CASCADE,
  	"group_id" text,
  	"topic_id" text,
  	"room_jid" text NOT NULL,
  	"message_id" text,
  	"question" text NOT NULL,
  	"options" jsonb NOT NULL,
  	"status" text DEFAULT 'open' NOT NULL,
  	"answer" text,
  	"answered_by" text,
  	"expires_at" timestamp with time zone NOT NULL,
  	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
  	"answered_at" timestamp with time zone
  );--> statement-breakpoint
  CREATE INDEX "ai_questions_ai_status_idx" ON "ai_questions" USING btree ("ai_id","status");--> statement-breakpoint
  CREATE INDEX "ai_questions_topic_status_idx" ON "ai_questions" USING btree ("topic_id","status");--> statement-breakpoint
  CREATE INDEX "ai_questions_message_idx" ON "ai_questions" USING btree ("message_id");
  ```

- **`apps/server/src/db/rows-agents.ts`**: added `AiQuestionRow` and
  `AiQuestionInsert` in the `ApprovalRow` style (status union
  `'open' | 'answered' | 'expired'`, nullable `answer`/`answeredBy`/`answeredAt`).
- **`apps/server/src/questions/service.ts`** (new): `createQuestion`,
  `setQuestionMessageId`, `findOpenQuestionByMessage`, `answerQuestion`,
  `listOpenQuestions`. `question` is validated 1–300 chars and `options` 2–4 of
  1–40 chars, each failure thrown as `HttpError(400, 'invalid_request', …)`.
  `findOpenQuestionByMessage`, `answerQuestion` and `listOpenQuestions` all carry
  the open predicate `status = 'open' AND expires_at > now()` (database clock).
  `options` is written as `::jsonb` (the `media/rows.ts` pattern) and reads back
  as a `string[]`.
- **`apps/server/src/questions/service.test.ts`** (new): four tests on the
  approvals test setup (`createTestContext` + `seedUser`/`seedAi`).

### Checks run

- `pnpm install`: done (12.2s; one pre-existing `@types/react` peer warning in `apps/mobile`).
- `pnpm --filter @zilar/server exec vitest run src/questions/service.test.ts --reporter=dot --maxWorkers=2`:
  4 passed (1 file). Run before the final gate.
- `pnpm gate` (from repo root), real output:

  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.6s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/server  (7.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

  The 5 changed files are `apps/server/drizzle/0066_ai_questions.sql`,
  `apps/server/src/db/rows-agents.ts`, `apps/server/src/questions/service.ts`,
  `apps/server/src/questions/service.test.ts` and
  `work/T-1571-ai-questions-table.md` — all Allowed.

### Notes for the lead

- The migration applies in the test database: the tests run against the
  `migrateSql` snapshot (`test-support.ts:311-324`), so a broken `0066` would
  have failed them; all six pass.
- **Title vs Steps:** the task title lists `closeQuestion`, but Step 3 lists
  `setQuestionMessageId` + `answerQuestion` instead, and the agreed status union
  is `open | answered | expired` with no `closed`. I followed Step 3 and did not
  add a `closeQuestion`; a free typed reply is covered by `answerQuestion`
  (lead's answer 6). Say if you want a separate close-without-answer path.
- **No `group_id`/`topic_id` FK:** the spec's `CREATE TABLE` block writes
  `REFERENCES` only for `ai_id`, so I matched it literally; `approvals` cascades
  on group/topic delete. Adding those FKs is expand-only — tell me if you want
  them and I will add them in this task.
- `answerQuestion`/`findOpenQuestionByMessage` use the database `now()`, not the
  app clock, matching the predicate in `ai-activity.ts`.
- Out of scope and untouched: the tool, the cards, the ingest answer match,
  activity, the mock.

### Fix round 1 (lead)

- **Blank text:** `validateQuestion`/`validateOptions` trim first and return the
  trimmed text, so blank question or option text is refused with `HttpError(400)`
  and the stored text is trimmed; added test `refuses a blank question or option`.
- **Open-question cap:** added `MAX_OPEN_QUESTIONS_PER_AI = 20`; `createQuestion`
  counts the AI's open, unexpired rows and refuses with
  `HttpError(429, 'too_many_questions', 'This AI has too many open questions')` at
  the cap (modelled on `MAX_PENDING_APPROVALS_PER_AI`); added test
  `refuses once the AI has too many open questions`.
- **Activity read:** `listOpenQuestions` now adds `message_id IS NOT NULL` (with
  a comment), so a question whose card was never posted is not returned; the
  create+find test now lists after `setQuestionMessageId`.
- Re-ran `pnpm --filter @zilar/server exec vitest run src/questions/service.test.ts
  --reporter=dot --maxWorkers=2`: 6 passed (1 file).
- Final `pnpm gate`:

  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.4s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.8s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/server  (5.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Fix round 2 (findings)

- **Finding 1 (should-fix, cap race):** `createQuestion` no longer counts and
  inserts in two separate `runSql` calls. The count and the insert now run in
  one `sql.withTransaction`, taking `pg_advisory_xact_lock(hashtext('ai-questions:' + aiId))`
  first, so concurrent creates for the same AI serialize and the second reads the
  first's row. The `too_many_questions` 429 is raised as an `Effect.fail` inside
  the transaction. Added test `admits only one create when two race for the last
  open slot`: 19 rows pre-seeded, two creates run together, exactly one resolves,
  the loser rejects with `{ status: 429, code: 'too_many_questions' }`, and the AI
  ends with exactly `MAX_OPEN_QUESTIONS_PER_AI` open rows.
- Nits 2 (AI-existence check), 3 (answer validation) and 4 (cap counting
  unposted rows) were left as they are: they are nits, outside the fix scope, and
  finding 4's remedy is explicitly future tool-task work.

Tests run: `pnpm --filter @zilar/server exec vitest run src/questions/service.test.ts
--reporter=dot --maxWorkers=2` → 1 file, 7 passed. Final `pnpm gate`:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.2s)
PASS  lint  (0.9s)
PASS  typecheck  (3.0s)
PASS  effect  (0.5s)
PASS  tests @zilar/server  (6.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

Commits this round: `T-1571: fix finding 1 - enforce the open-question cap atomically`.

## Review (written by Claude)

**Approved and merged after one lead fix round and one autopilot round.**

- **First packet:** clean, with 4 nits. The lead asked for three fixes:
  - trimmed text, refusing blanks;
  - a cap of 20 open questions per AI (`429 too_many_questions`);
  - `listOpenQuestions` hides rows whose card was never posted.
- **The autopilot's round:** made the cap atomic with `pg_advisory_xact_lock` on the AI.
- **What the lead checked:**
  - **The migration:** `0066_ai_questions.sql` is expand-only and starts with `SET lock_timeout`. The column types match `approvals`, and the 3 indexes are there.
  - **Tests:** the lead ran `src/questions/service.test.ts` on the branch, 7 passed.
- **Left for the later steps:**
  - nit 2: `listOpenQuestions` has no `LIMIT`; add one in step 7's activity read;
  - nit 3: `setQuestionMessageId` should only stamp an open row; fix it in step 4;
  - **the pre-review's permission note** (first packet, F1): the service takes no user id, so steps 6 and 7 must check that the person can see the topic.
- **Live:** after the deploy, the lead checks that the `ai_questions` table exists.
