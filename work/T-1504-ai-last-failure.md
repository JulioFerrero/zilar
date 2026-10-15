---
id: T-1504
title: "AI health data (approved AI health canvas): PublicAi gains lastFailure {kind, at} — the AI's latest logged turn error with no answer after it, last 7 days, one query for the whole list; the mock seeds a failing and a paused AI"
status: merged
milestone: M5
branch: task/T-1504-ai-last-failure
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1504: AI last failure on the AI list

## Spec (written by Claude, do not edit)

### Why
Julio approved the AI health design on 2026-10-15. Its README is parked for the web task; the rules are repeated here.

Each AI on My AIs shows a health dot on its picture:
- green: working;
- red: failing, with the reason (for example "Key rejected");
- amber: paused by its daily limit.

The client can already tell "paused": `usage.todayUsd >= limits.perDayUsd`. "Failing" is known only to the server's task log, so this task puts it on the AI view.

### Facts (the lead read them on main, 2026-10-15)
- **The task log:** each failed turn logs a task event `kind = 'error'` whose `data` is `failureLogFields(error)`, `{ kind: AiFailureKind, status? }`. See:
  - `apps/server/src/agents/failure-class.ts:10-18` (the kinds: `budget`, `key_rejected`, `rate_limited`, `model_not_found`, `context_too_long`, `timeout`, `provider_error`, `other`) and `:63-66`;
  - the writers: `apps/server/src/agents/group-turn.ts:221,312`, `apps/server/src/agents/dm-turn.ts:151`, `apps/server/src/agents/dm-tool-turn.ts:286,362`, `apps/server/src/agents/gateway/turn-defect.ts:31`, `apps/server/src/agents/gateway/group-turn.ts:293`.
- **A successful answer** logs `kind = 'answer'`. The event kinds are in `packages/api-contract/src/agent-tasks.ts:11-19`.
- **The table** is `agent_task_events` (`apps/server/drizzle/0060_agent_task_events.sql`), with columns `ai_id`, `kind`, `at` and `data` (jsonb). Its indexes are on `(task_id, seq)` and `at` only. Rows older than 30 days are deleted (`apps/server/src/agents/log/retention.ts:11`).
- **The AI list and detail** are built in `apps/server/src/ais/api.ts` (362 lines): `withAvatars` (one query for the list, `:114-127`), then `withUsage` per AI (`:131-140`), used at `:162-165` (list) and `:186-187` (detail).
- **The contract:** `PublicAi` is in `packages/api-contract/src/ais.ts:152-172`, and `usage` there is `Schema.optional(Schema.NullOr(AiUsage))`.
- **The mock seed:** `packages/mock-backend/src/domains/ais/seed.ts:16-62` has Dev-1, QA-1 (limit $2 a day, `usage: null`) and Marketing AI (limit $5 a day, today $1.70).

### Steps
1. **New file `apps/server/src/ais/health.ts`:** `lastFailures(db, aiIds): Promise<Map<string, { kind: string; at: string }>>`.
   - With no ids, return an empty map and run no query.
   - **One** query for all ids, the latest `error` event per AI from the last 7 days that has no `answer` event for the same AI after it:
     ```sql
     SELECT DISTINCT ON (e.ai_id) e.ai_id, e.data->>'kind' AS kind, e.at
     FROM agent_task_events e
     WHERE e.ai_id IN (...) AND e.kind = 'error' AND e.at > now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM agent_task_events a
         WHERE a.ai_id = e.ai_id AND a.kind = 'answer' AND a.at > e.at)
     ORDER BY e.ai_id, e.at DESC
     ```
     Use the same `runSql` + `SqlClient` style as the rest of `apps/server/src/ais/`.
   - A row whose `kind` is null is left out. `at` goes out as an ISO string.
   - Also export a list decorator, `withLastFailures(db, list)`, that adds `lastFailure` (the entry, or `null`). Any failure of the read gives every AI `lastFailure: null`: this is best-effort decoration, like usage.
2. **`apps/server/src/ais/api.ts`:** the list and the detail run through `withLastFailures` (one call for the whole list). Keep the file under 400 lines.
3. **`packages/api-contract/src/ais.ts`:** `PublicAi` gains `lastFailure: Schema.optional(Schema.NullOr(Schema.Struct({ kind: Schema.String, at: Schema.String })))`. `kind` stays a plain string, so a newer kind still decodes.
4. **Mock (`packages/mock-backend/src/domains/ais/seed.ts`):**
   - QA-1 gets `lastFailure: { kind: 'key_rejected', at: CREATED_AT }`;
   - Marketing AI's usage becomes `{ todayUsd: 5, windowUsd: 9.4 }`, so its $5 daily limit is reached;
   - Dev-1 stays healthy (`lastFailure: null`).
   - Keep `seed.ts` and the routes compiling; add the field wherever the mock builds a `PublicAi`.
5. **One test,** `apps/server/src/ais/health.test.ts`, against the test database the other `apps/server/src/ais/*.test.ts` files use, checking that:
   - an AI with an `error` event and no later `answer` gets its kind;
   - an `answer` after the error clears it;
   - an error older than 7 days is ignored;
   - two AIs come back from one call.

### Not in scope
- the web and mobile UI (next tasks);
- connections;
- any new table or index.

### Allowed files
- `apps/server/src/ais/health.ts` (new)
- `apps/server/src/ais/health.test.ts` (new)
- `apps/server/src/ais/api.ts`
- `packages/api-contract/src/ais.ts`
- `packages/mock-backend/src/domains/ais/seed.ts`
- `packages/mock-backend/src/domains/ais/routes.ts`
- `packages/mock-backend/src/domains/ais/state.ts`
- `work/T-1504-ai-last-failure.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/ais/health.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The AI list and detail carry `lastFailure`: `null` for a healthy AI, and `{ kind, at }` after a failed turn that no answer has followed.
- The list does one failure query, never one per AI.
- The mock shows QA-1 failing (`key_rejected`) and Marketing AI at its daily limit.

---

## Report (written by the worker when done)

### What I did

- **New `apps/server/src/ais/health.ts`:** `lastFailures(db, aiIds)` runs one
  `runSql` + `SqlClient` query for the whole list — `DISTINCT ON (e.ai_id)` of
  the latest `error` event per AI in the last 7 days that no later `answer`
  followed (the spec's SQL, via `sql.in`). No ids → empty map, no query. A row
  whose `data->>'kind'` is null is skipped; `at` goes out as an ISO string.
  `withLastFailures(db, list)` decorates a list in one read; a failed read (or an
  empty list) gives every AI `lastFailure: null`.
- **`apps/server/src/ais/api.ts`:** the list and the detail run their rows
  through `withLastFailures` (one call for the whole list, a one-element list for
  the detail). File is 367 lines, under 400.
- **`packages/api-contract/src/ais.ts`:** `PublicAi` gains
  `lastFailure: Schema.optional(Schema.NullOr(Schema.Struct({ kind: Schema.String, at: Schema.String })))`,
  so a newer `kind` still decodes and an older server's payload still parses.
- **Mock:** QA-1 gets `lastFailure: { kind: 'key_rejected', at: CREATED_AT }`,
  Marketing AI's usage becomes `{ todayUsd: 5, windowUsd: 9.4 }` (its $5 daily
  limit reached), Dev-1 stays `lastFailure: null`; `createAi` in `routes.ts`
  builds new AIs with `lastFailure: null`.
- **New `apps/server/src/ais/health.test.ts`:** 6 tests on the shared test
  database — no-ids empty map, an error with no later answer, an answer clearing
  the error, an error older than 7 days ignored, two AIs in one call, and the
  `withLastFailures` decorator giving a healthy AI null.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/health.test.ts`
  → 1 file passed, 6 tests passed.
- `pnpm gate` (repo root) summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.9s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.9s)
  PASS  effect  (1.0s)
  SKIP tests @zilar/api-contract (no nearby test files)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (10.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- No deviations from the spec. No new dependency, table or index.
- `state.ts` was in the allowed list but needed no change (`cloneAi` spreads the
  object, so the new field is copied for free).
- The 7 changed files are the 6 source/doc files plus this task file.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 2 nits (a test name that says more than it asserts; the mock's shallow clone), for head `c01d0bde1`.
- **The lead read the code:**
  - `health.ts` runs the spec's single `DISTINCT ON` query;
  - an empty list runs no query;
  - a failed read gives every AI `lastFailure: null`;
  - the list does one read and the detail one;
  - the ids come only from the caller's own AIs;
  - the contract field is optional and nullable, with a plain-string kind;
  - the mock has QA-1 failing and Marketing AI at its limit.
- **Follow-up:** `agent_task_events` has no `ai_id` index, so the `NOT EXISTS` scan grows with the log. Watch it, and add an `(ai_id, kind, at)` index if the AI list gets slow.
