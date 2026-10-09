---
id: T-0849
title: "One migration: indexes for lookups by user_id / ai_id on membership tables, lower(xmpp_accounts.jid) and contacts.contact_user_id"
status: todo
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
`apps/server/drizzle/**`, `apps/server/src/db/migrate.ts`, `apps/server/src/db/migrate.test.ts`, `work/T-0849-membership-indexes.md`.

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

## Review (written by Claude)
