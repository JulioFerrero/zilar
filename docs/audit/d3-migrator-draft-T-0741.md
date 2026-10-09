---
id: T-0741
title: "D3 (DRAFT, NEEDS JULIO'S CHECK): migrations on effect/sql — runMigrations runs the adoption seed + runSqlMigrations one transaction per migration; tests include partial adoption (41 drizzle rows, 5 pending, as live is today)"
status: todo
milestone: M5
branch: task/T-0741-migrator-switch
model: auto
effort: low
depends_on: [T-0739]
estimate: 0.4 day
---

# T-0741: the migrator on effect/sql (D3)

## Spec (written by Claude, do not edit)

### Why
D3 of `docs/audit/drizzle-removal-plan.md` §4 (lines 444-509). Julio asked to check the plan before anything runs. This task changes only code and tests. **The live database is migrated by the next deploy, and the lead deploys only after Julio's yes.**

### Verified facts (do not re-derive)
- **Call sites:** `runMigrations(db)` is at `apps/server/src/db/migrate.ts:8` (the drizzle migrator). It is called at `apps/server/src/index.ts:73`, `apps/server/src/auth/invite-cli.ts:75` and `apps/server/src/db/migrate-cli.ts:12`.
- **The loader:** `sqlFileLoader(directory)` (`apps/server/src/effect/sql.ts:156-191`) maps file `NNNN_name.sql` to migration id `NNNN + 1` (line 169), and splits each file on `--> statement-breakpoint`.
- **The runner:** `runSqlMigrations({ loader })` (`sql.ts:197-205`) is the core `Migrator.make`, which runs **all** pending migrations in one transaction (plan §4, lines 484-493).
- **Migration counts:** the repo has 46 SQL files (`ls apps/server/drizzle/*.sql`). The live server runs commit `eeaddee3`, whose journal has 41 entries, so live has 41 rows in `drizzle.__drizzle_migrations` and files 0041 to 0045 are still pending there.
- **The adoption seed** (plan §4, lines 467-476) seeds `effect_sql_migrations` with `count(*)` of the drizzle journal, under `WHERE NOT EXISTS`. Existing tests: `apps/server/src/effect/sql.test.ts` "adopts a database drizzle already migrated…" (46 rows) and "runs the committed drizzle SQL from empty…" (46 entries).

### What to build
1. **In `effect/sql.ts`,** add `migrateDatabase(): Effect<…, SqlClient>`, which runs these steps in order:
   - (a) If the `drizzle.__drizzle_migrations` table exists, run the adoption seed exactly as in plan §4, and log the seeded id. This is idempotent: the `WHERE NOT EXISTS` guard makes later startups a no-op;
   - (b) For each pending migration in id order, call `runSqlMigrations` with a loader filtered to that single id, so each migration gets its own transaction;
   - (c) Return the applied list.
2. **`db/migrate.ts`:** `runMigrations(db)` keeps its signature and runs `migrateDatabase()` through `sqlRuntimeFor(db)`. Remove the drizzle migrator import. The three call sites stay unchanged.
3. **Keep `drizzle.__drizzle_migrations` untouched,** for rollback: an old image still sees its own journal.
4. **Tests in `effect/sql.test.ts`:**
   - **(i) full adoption:** 46 drizzle rows, then `migrateDatabase` applies nothing and the schema is intact;
   - **(ii) partial adoption, as live is today:** a PGlite migrated by drizzle with only the first 41 files (copy them to a temp folder), then `migrateDatabase` on all 46 applies exactly ids 42 to 46 (files 0041 to 0045). The `pinned_messages` table and the columns from 0041 to 0045 exist;
   - **(iii) from empty:** 46 applied;
   - **(iv) per-migration rollback:** two temp migrations where the second fails; the first is committed and journaled, and the second is absent;
   - **(v) a second run** of `migrateDatabase` applies nothing, and the seed row count stays 1.

### Read first
`AGENTS.md`, `docs/audit/drizzle-removal-plan.md` (lines 444-509), `apps/server/src/effect/sql.ts`, `apps/server/src/effect/sql.test.ts`, `apps/server/src/db/migrate.ts`, `apps/server/src/db/migrate.test.ts`.

### Allowed files
`apps/server/src/effect/sql.ts`, `apps/server/src/effect/sql.test.ts`, `apps/server/src/db/migrate.ts`, `apps/server/src/db/migrate.test.ts`, `work/T-0741-migrator-switch.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/sql.test src/db/migrate.test
pnpm gate
```

### Acceptance
- All five migration tests pass.
- `db/migrate.ts` has no drizzle import.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Before the live deploy (lead + Julio, not the worker)
1. Back up the live database.
2. Restore the backup into a local Postgres, and run the new image against it. Expect "seeded 41", then 5 applied, with every app table's row counts unchanged.
3. Only then deploy.

---

## Report (written by the worker when done)

## Review (written by Claude)
