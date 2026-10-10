---
id: T-0855
title: "Remove the unused drizzle migration snapshots (apps/server/drizzle/meta, 3.7 MB) and reword stale drizzle comments"
status: merged
milestone: M5
branch: task/T-0855-drizzle-leftovers
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0855: Remove the unused drizzle migration snapshots (apps/server/drizzle/meta, 3.7 MB) and reword stale drizzle comments

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding G-F7 in `docs/audit/simplify-2026-10-09/G-deadcode.md`.
- **The snapshots:** `apps/server/drizzle/meta/` holds 47 tracked files (3.7 MB) that no code reads now that drizzle is gone (T-0751).
- **The comments:** 66 comment lines in 19 files still describe drizzle.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. **Prove** that nothing reads `drizzle/meta` before deleting it: read `apps/server/src/db/migrate.ts` (it must read only the `*.sql` files, and maybe the journal), the Dockerfile COPY lines, and `grep -rn "meta" apps/server/src/db`. If the journal (`meta/_journal.json`) is still read, keep ONLY that file and say so.
2. Delete the rest.
3. Reword the 66 stale comments: find them with `grep -rni drizzle apps/server/src packages --include=*.ts`, excluding the migration adoption code that must keep naming the old journal table. Describe today's code, not history.
4. Change only comments, no code.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/server/drizzle/meta/**`, `apps/server/src/**/*.ts`, `packages/**/*.ts`, `work/T-0855-drizzle-leftovers.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=30000 --hookTimeout=30000 src/db
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.

---

## Report (written by the worker when done)

**Proof that nothing reads `drizzle/meta` (checked before deleting, including `_journal.json`):**
- `apps/server/src/effect/sql.ts:148-172` (`sqlFileLoader`): `readdir` of `apps/server/drizzle`, keeps only names matching `/^(\d+)_(.+)\.sql$/`. `meta` is a directory and never matches. `_journal.json` is not read. `runMigrations` (`apps/server/src/db/migrate.ts`) goes through `migrateSql`, so it reads only the `*.sql` files.
- `apps/server/Dockerfile:33` copies the whole `apps/server` folder and has no drizzle-specific COPY line. Nothing in the Dockerfile reads `meta`.
- `apps/server/src/topics/backfill.test.ts:22-40` and `apps/server/src/approvals/topic-scope-backfill.test.ts:22-36` list the drizzle folder, but both skip every name that does not end in `.sql`.
- `grep` for `_journal`, `drizzle/meta`, `snapshot.json` outside `node_modules`, `docs/` and `work/`: no hits. `deploy/zilar` mentions only `drizzle/0013_audit_log_immutable.sql`.
- Nothing reads the journal either, but per the lead's note (T-0849 adds migration 0046 to it) `meta/_journal.json` is KEPT in this task. The lead removes it after both merge.

**Deleted:** `apps/server/drizzle/meta/*_snapshot.json`, 46 files (`0000_snapshot.json` to `0045_snapshot.json`), about 3.75 MB (3,755,485 bytes minus the 6,713-byte journal = 3,748,772 bytes), with `git rm`. Kept: `apps/server/drizzle/meta/_journal.json` (6,713 bytes). The SQL migrations in `apps/server/drizzle/*.sql` stay.

**Comments reworded:** 42 comment lines in 19 files (`git diff -U0` shows only comment lines changed, 30 added and 42 removed in `.ts` files).
- Stale facts fixed: `auth/sql-adapter.ts` header said `drizzleAdapter` was still to be replaced and the production switch was later. `auth.ts:13,70` already uses `effectSqlAdapter`, so the header now says so. `contacts/service.ts` and `directory/service.ts` said `avatarIdsByOwner` and `findInviteByCode` still ran on drizzle. No `src` file imports drizzle now, so that clause is gone.
- Kept on purpose: the adoption code in `effect/sql.ts:203-255` and its tests in `effect/sql.test.ts` (they name the old journal table), `effect/sql.ts:30,148`, `push/test-tables.ts:9` and `db/rows.ts:2` (they name the `apps/server/drizzle/` folder, which still holds the SQL). Also code, not comments: `drizzleDir` variables in the backfill tests and the `drizzle` regex in `packages/devtools`.
- The audit's count of 66 includes code and adoption lines. The measured number of changed comment lines is 42.

**Checks (on the final commit):** `pnpm --filter @zilar/server typecheck`: exit 0. `vitest run src/db` (dot reporter, 30 s timeouts): 3 of 3 runs on the final commit passed, 9 of 9 tests each (durations 97 s, 37 s, 32 s). Before the journal was restored, one run on an earlier commit exited with ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL and no captured summary; I did not find its cause, and the next runs passed. `oxlint` on the 19 changed `.ts` files: no output (clean). `prettier --write` on the same files made no code changes.

**Unsure:** nothing blocking. The `setup/settings.effect.test.ts` header now names `setup/settings.ts` wrappers as the drizzle helpers' replacement. I read the file's content only, not its test history.

## Review (written by Claude)

**Lead, 2026-10-10: approved.** The 46 snapshot files (3.75 MB) are deleted, `_journal.json` is kept (T-0849 adds 0046), and 42 stale comments are reworded. The combined wave 3 check is clean.
