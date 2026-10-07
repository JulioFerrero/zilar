---
id: T-0470
title: "Listener S1 (schema): groups.listener_enabled/eagerness, ais.can_delegate/accepts_delegation, ai_delegations table"
status: merged
milestone: M5
branch: task/T-0470-listener-schema
model: auto
effort: low
depends_on: [T-0468]
estimate: 0.25 day
---

# T-0470: listener and delegation schema

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/listener-delegation-plan.md` §5.1 and §8, task S1. The plan has one migration for the whole feature, and it comes first, alone. **Schema only:** no routes, no gateway changes and no behaviour change.

### Verified facts (do not re-derive)
- **`groups`** is `apps/server/src/db/schema.ts:216`. It has text enums with `check(...)` constraints, for example `groups_visibility_check`, and T-0463 added the background columns and checks.
- **`ais`** is `apps/server/src/db/schema.ts:539` and **`topics`** is line 346.
- **Migrations:** run `pnpm --filter @zilar/server db:generate`. The head is `apps/server/drizzle/0044_demonic_gressill.sql`, so yours is `0045_*`. Never hand-edit the SQL.
- **The migration test** is `apps/server/src/db/migrate.test.ts`.
- **The plan's delegation table** is §4.4 of `docs/audit/listener-delegation-plan.md` (lines 170-186), with statuses `working`, `completed`, `failed` and `canceled`.
- **Julio's decision (2026-10-07, plan §8):** any AI in the group may receive a delegated task **if its owner allowed receiving**. That needs a second AI flag besides `can_delegate`.

### What to build
1. **`groups`:**
   - `listenerEnabled: boolean('listener_enabled').notNull().default(false)`;
   - `listenerEagerness: text('listener_eagerness', { enum: ['quiet','normal','eager'] }).notNull().default('normal')`, with the check `groups_listener_eagerness_check`.
2. **`ais`:**
   - `canDelegate: boolean('can_delegate').notNull().default(false)`;
   - `acceptsDelegation: boolean('accepts_delegation').notNull().default(false)`.
   
   Each gets a one-line comment.
3. **New `aiDelegations` table, `ai_delegations`:**
   - `id` text PK;
   - `fromAiId` and `toAiId` text, not null, FK `ais.id` with cascade delete;
   - `groupId` text, not null, FK `groups.id` with cascade delete;
   - `topicId` text, nullable, FK `topics.id` with cascade delete;
   - `objective` text not null;
   - `contextSummary` text;
   - `acceptance`, `constraints` and `artifacts` as `jsonb` arrays, defaulting to `[]`;
   - `budgetCurrency` text, nullable;
   - `budgetMax` numeric or a `real`, nullable. Match how `ai_limits` stores money and say which in the Report;
   - `returnFormat` text;
   - `replyTo` text;
   - `status` text enum `('working','completed','failed','canceled')`, not null, default `'working'`, with a check;
   - `resultSummary` text;
   - `createdAt` and `updatedAt`.
   
   Add the indexes `ai_delegations_to_status_idx` on `(toAiId, status)` and `ai_delegations_group_created_idx` on `(groupId, createdAt)`. Add a check that `fromAiId <> toAiId`. Give the table a short comment pointing to the plan §4.4.
4. **Generate the migration** `0045_*`.
5. **`migrate.test.ts`:** after migrating, check that:
   - a new group has `listener_enabled` false and `listener_eagerness` `'normal'`;
   - an unknown eagerness value is rejected by the check;
   - a new AI has `can_delegate` and `accepts_delegation` false;
   - an `ai_delegations` row with `from = to` is rejected;
   - a valid row defaults to status `working`.

   Follow the file's existing style.

### Read first
`AGENTS.md`, `docs/audit/listener-delegation-plan.md` §4.4, §5.1 and §8, `apps/server/src/db/schema.ts:216-275`, `:346-380` and `:539-580`, `apps/server/src/db/migrate.test.ts`, `work/T-0463-server-group-backgrounds.md` (the last migration task).

### Allowed files
`apps/server/src/db/schema.ts`, `apps/server/drizzle/0045_*.sql` (generated), `apps/server/drizzle/meta/_journal.json`, `apps/server/drizzle/meta/0045_snapshot.json`, `apps/server/src/db/migrate.test.ts`, `work/T-0470-listener-schema.md`.

If any other test breaks (for example a snapshot of the AI or group row shape), stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot db/migrate
pnpm gate
```

### Acceptance
- One generated migration adds the listener columns to `groups`, the two delegation flags to `ais`, and the `ai_delegations` table with its checks and indexes. Defaults keep today's behaviour (everything off).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

- **Schema (`apps/server/src/db/schema.ts`):**
  - `groups` gains `listenerEnabled` (boolean, not null, default false) and `listenerEagerness` (text enum `quiet`/`normal`/`eager`, not null, default `normal`) with the check `groups_listener_eagerness_check`.
  - `ais` gains `canDelegate` and `acceptsDelegation` (both boolean, not null, default false), each with a one-line comment.
  - New `aiDelegations` table `ai_delegations` (plan §4.4): `id` PK; `from_ai_id`/`to_ai_id` FKs to `ais` (cascade), `group_id` FK to `groups` (cascade), `topic_id` nullable FK to `topics` (cascade); `objective` not null; `context_summary`, `budget_currency`, `return_format`, `reply_to`, `result_summary` nullable; `acceptance`/`constraints`/`artifacts` `jsonb` arrays not null default `[]`; `budget_max` numeric nullable; `status` text enum `working`/`completed`/`failed`/`canceled` not null default `working`; `created_at`/`updated_at`. Indexes `ai_delegations_to_status_idx` on `(to_ai_id, status)` and `ai_delegations_group_created_idx` on `(group_id, created_at)`; checks `ai_delegations_different_ais_check` (`from_ai_id <> to_ai_id`) and `ai_delegations_status_check`. The table comment points at plan §4.4.
  - **`budget_max` type:** I matched `ai_limits` — `numeric(12, 2)`, following the file's "Money is numeric, never a float" comment — not `real`.
- **Migration:** generated with `pnpm --filter @zilar/server db:generate`, not hand-edited: `apps/server/drizzle/0045_remarkable_dragon_lord.sql`, plus `meta/0045_snapshot.json` and the `_journal.json` entry. It adds the four columns, the new table with its FKs, checks and indexes.
- **Tests (`apps/server/src/db/migrate.test.ts`):** added 5 tests to the existing `describe('runMigrations')`: a new group defaults to listener off and eagerness `normal`; an unknown eagerness is rejected by the check (raw query); a new AI has both flags false; an `ai_delegations` row with `from = to` is rejected; a valid row defaults to status `working` with empty array defaults. Added a `seedDelegationScope` helper (user + provider connection + two AIs + group) consistent with the file's per-test style.

### Files changed

`apps/server/src/db/schema.ts`, `apps/server/drizzle/0045_remarkable_dragon_lord.sql`, `apps/server/drizzle/meta/0045_snapshot.json`, `apps/server/drizzle/meta/_journal.json`, `apps/server/src/db/migrate.test.ts`, `work/T-0470-listener-schema.md` — all inside the Allowed files (6 changed vs `main`; gate confirmed the scope).

### Commands run (real results)

- `pnpm install` → done, no lockfile change.
- `pnpm --filter @zilar/server db:generate` → wrote `drizzle/0045_remarkable_dragon_lord.sql` (+ snapshot + journal entry).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot db/migrate` (first run) → 1 failed, 8 passed. The failure was my own self-delegation test: drizzle wraps the driver error and its message does not contain the constraint name. I switched that assertion to a raw `client.query` insert (the pattern the eagerness check already uses).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot db/migrate` (second run) → 1 file, 9 tests passed.
- `pnpm gate` (first run) → `FAIL format`: prettier wanted the two generated JSON files (`meta/_journal.json`, `meta/0045_snapshot.json`); fixed with `prettier --write` on those two only.
- `pnpm gate` (final, from repo root):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (13.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (7.4s)
  PASS  tests @zilar/server  (517.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations from the spec / open questions

- None. The spec left `budget_max`'s type open ("numeric or a `real`"); I chose `numeric(12, 2)` to match `ai_limits`.
- No behaviour change, no routes, no gateway changes, as required.

### Security checklist

- Schema only; defaults keep today's behaviour (listener off, eagerness `normal`, both delegation flags off, status `working`).
- All four foreign keys are `on delete cascade`; `from_ai_id <> to_ai_id` is enforced by a check, not application code.
- No secrets, logs, audit entries, new routes, new dependencies or env vars; the test seed uses the placeholder `CHANGE_ME`.

## Review (written by Claude)

Approved (lead, 2026-10-07). Migration 0045 (generated):
- groups gets listener_enabled (false) and listener_eagerness (normal, checked);
- ais gets can_delegate and accepts_delegation (false);
- the ai_delegations table has cascade FKs, a status check, a from<>to check, both indexes, and budget_max numeric(12,2).
Tests cover the defaults and the checks. Nit accepted: only the acceptance array default is asserted.
