---
id: T-0470
title: "Listener S1 (schema): groups.listener_enabled/eagerness, ais.can_delegate/accepts_delegation, ai_delegations table"
status: todo
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

## Review (written by Claude)
