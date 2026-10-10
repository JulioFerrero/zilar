---
id: T-0849
title: "One migration: indexes for lookups by user_id / ai_id on membership tables, lower(xmpp_accounts.jid) and contacts.contact_user_id"
status: merged
milestone: M5
branch: task/T-0849-membership-indexes
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0849: One migration: indexes for lookups by user_id / ai_id on membership tables, lower(xmpp_accounts.jid) and contacts.contact_user_id

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding C-F9 in `docs/audit/simplify-2026-10-09/C-server.md`, checked by the lead.
- **The keys:** the membership tables have composite primary keys that lead with the group or topic: `group_members` PK(group_id,user_id), `topic_members` PK(topic_id,user_id), `topic_ais` PK(topic_id,ai_id), `group_ais` PK(group_id,ai_id) and `group_member_roles` PK(role_id,user_id) (see `apps/server/drizzle/*.sql`).
- **The queries that miss them:** many queries filter by the second column, for example `FROM group_members WHERE user_id = …` (`topics/rooms.ts:472`, `approvals/service.ts:802`, `directory/service.ts:302`), `topic_ais WHERE ai_id` (`agents/gateway/db.ts`), `group_member_roles … user_id` (`topics/access.ts:230`), and `lower(jid) = …` (`blocks/service.ts`). The unique index on raw `jid` cannot serve `lower(jid)`.
- **`contacts.contact_user_id`** has no index either.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Add ONE new hand-written migration, following the latest file in `apps/server/drizzle/` and how `apps/server/src/db/migrate.ts` discovers and runs migrations; read the hand-written-migration convention there. Use `CREATE INDEX IF NOT EXISTS` for `group_members(user_id)`, `topic_members(user_id)`, `topic_ais(ai_id)`, `group_ais(ai_id)`, `group_member_roles(user_id)`, `xmpp_accounts (lower(jid))` and `contacts(contact_user_id)` (check the real column names first).
2. If the migrator keeps a journal or list of migrations, update it. `db/rows.ts` needs no change.
3. Add a test in `apps/server/src/db/migrate.test.ts` that the new indexes exist after migrating (query `pg_indexes`).

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/server/drizzle/**`, `apps/server/src/db/migrate.ts`, `apps/server/src/db/migrate.test.ts`, `apps/server/src/effect/sql.test.ts` (lead, after the combined check: its migration counts must include the new migration), `apps/server/src/topics/backfill.test.ts` (lead: its pre-topics migration list must skip 0046, which indexes `topic_members`), `work/T-0849-membership-indexes.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=30000 --hookTimeout=30000 src/db/migrate.test.ts
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: The next deploy runs the migration (backup first, as in the release recipe).

---

## Report (written by the worker when done)

- **Changed:** `apps/server/drizzle/0046_membership-indexes.sql` (new, 7 x `CREATE INDEX IF NOT EXISTS`, one per `--> statement-breakpoint`): `group_members(user_id)`, `topic_members(user_id)`, `topic_ais(ai_id)`, `group_ais(ai_id)`, `group_member_roles(user_id)`, `xmpp_accounts(lower(jid))`, `contacts(contact_user_id)`. Index names end in `_idx`.
- **Changed:** `apps/server/drizzle/meta/_journal.json` (one entry, idx 46, tag `0046_membership-indexes`, same shape as 0045). Hand-written migrations 0034, 0035 and 0038 have journal entries, so I followed them. No snapshot file, as for 0039-0044.
- **Changed:** `apps/server/src/db/migrate.test.ts`: one new test, `creates the membership lookup indexes`, reads `pg_indexes` for the 7 names. The file had 9 tests before and has 10 now.
- **Not changed:** `migrate.ts` (the migrator discovers `*.sql` files itself, `effect/sql.ts:152`, so no list needs updating) and `db/rows.ts` (no column change).
- **Column names checked** in the DDL: `group_members`, `topic_members`, `topic_ais`, `group_ais`, `group_member_roles` as in the spec; `xmpp_accounts.jid`, `contacts.contact_user_id` as in the spec. `contacts` has no existing index on `contact_user_id`. `xmpp_accounts_jid_unique` is on raw `jid`, as the audit says.
- **Audit line numbers:** `blocks/service.ts` has `lower(jid)` at line 75, not ~62. `topics/rooms.ts:472` is `SELECT group_id FROM group_members` (WHERE clause on the next line; I did not re-read the rest). The audit file is only in galena (`docs/audit/simplify-2026-10-09/C-server.md`), not in this worktree.
- **Test counts:** before 9 tests (migrate.test.ts), after 10 (10 of 10 passed in run 1).
- **Checks:**
  - `pnpm --filter @zilar/server typecheck`: clean (exit 0).
  - `pnpm exec oxlint apps/server/src/db/migrate.test.ts`: clean (exit 0). Prettier ran on the .ts and .json files (unchanged). Prettier cannot parse `.sql`, and the existing `.sql` migrations are not formatted by it either.
  - `migrate.test.ts` run 4 times (the spec asks for 3 after the last commit):
    - run 1: 10 passed, 226 s.
    - run 2: 8 passed, 2 failed (`creates the auth and invite tables`, my new test); both pass when run alone (`-t` filter).
    - run 3: 2 passed, 8 failed, all `Test timed out in 30000ms`, 303 s.
    - run 4: 7 passed, 3 failed, all `Test timed out in 30000ms`, 264 s.
  - The migration applied fine in every run (run 1 log: `database migrations applied: 1 ... 47`; file 0046 is id 47).
- **Why the timeouts:** each test migrates an empty PGlite from all 47 files, about 20-25 s on an idle run (run 1). The machine's load average was 62-67 during runs 2-4 (other workers), so tests hit the 30 s timeout. The failing tests are old ones too, so this is load, not the new index SQL. The new migration adds a few small `CREATE INDEX` statements on empty tables; I did not measure the migration alone.
- **Behaviour differences:** none at runtime for the app. New indexes only change query plans.
- **Unsure:**
  - The acceptance says 3 of 3 clean runs. I have 1 clean run of 4, and the other runs failed on timeouts under load. I did not change the test harness (it runs all migrations per test, and the spec does not ask for a change). The lead can re-run `migrate.test.ts` on an idle machine, or decide whether the harness should use the cached snapshot (`freshMigratedPglite` in `effect/sql.ts`).
  - I did not run `EXPLAIN` to confirm the planner uses the indexes (the audit says this is unverified).
  - Live check: the next deploy runs migration 0046 (take a backup first, per `docs/RELEASING.md`).

## Review (written by Claude)

**Lead, 2026-10-10: approved after 2 fix rounds.**
- **What changed:** migration 0046 adds the membership, jid and contact indexes that the composite primary keys could not serve.
- **Fix rounds:** `effect/sql.test.ts` counts the committed migrations from the folder, and a drizzle-adopted DB now runs 0046 as a new migration. `topics/backfill.test.ts` skips 0046 in its pre-topics setup.
- **Live:** the migration runs on deploy. Index creation on the small live tables is quick.
