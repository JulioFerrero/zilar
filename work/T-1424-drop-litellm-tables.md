---
id: T-1424
title: "Contract step of the LiteLLM removal: migration 0059 drops llm_virtual_keys and ai_daily_spend (no code reads them since T-1413)"
status: merged
milestone: M5
branch: task/T-1424-drop-litellm-tables
model: auto
effort: default
depends_on: [T-1413]
estimate: 0.1 day
---

# T-1424: Drop the LiteLLM tables

## Spec (written by Claude, do not edit)

### Why
This is the expand/contract plan from `docs/audit/effect-ai-plan.md` §5.7. T-1413 (merged and live since 2026-10-14) stopped every read and write of `llm_virtual_keys` and `ai_daily_spend`. Every release since then is the only one running, so the tables can go.

### Facts (the lead checked them on main, 2026-10-15)
- `git grep -n "llm_virtual_keys\|ai_daily_spend" -- apps packages ':!**/drizzle/*.sql' ':!**/drizzle/meta/**'` prints nothing: no code and no `db/rows.ts` entry.
- The tables were created by old migrations (`apps/server/drizzle/0005_clean_frightful_four.sql`, `0006_military_sleepwalker.sql`, `0009_premium_payback.sql`).
- The latest migration is `apps/server/drizzle/0058_provider_base_url.sql`. New migrations are hand-written SQL (read AGENTS.md on how they are registered, and follow `0058` exactly).
- The live DB has 0 AIs, so the tables are empty or nearly so.

### What to build
`apps/server/drizzle/0059_drop_litellm_tables.sql`:
```sql
SET lock_timeout = '5s';--> statement-breakpoint
DROP TABLE IF EXISTS "ai_daily_spend";--> statement-breakpoint
DROP TABLE IF EXISTS "llm_virtual_keys";
```
- Drop in that order if `ai_daily_spend` references `llm_virtual_keys`; check the old migrations and use `CASCADE` only if a foreign key requires it.
- Register the migration the same way `0058` is (journal and meta, if the repo uses them).
- No code change.

### Tests
None new. The migration test that applies all migrations, if one exists, must pass (find it with `grep -rln "migrate" apps/server/src --include=*.test.ts`).

### Allowed files
`apps/server/drizzle/**`, `work/T-1424-drop-litellm-tables.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The gate passes, and the migration continues from 0058.

---

## Report (written by the worker when done)

**Status:** review

### What I did
- Added `apps/server/drizzle/0059_drop_litellm_tables.sql`, hand-written and byte-for-byte the SQL in the Spec (drop `ai_daily_spend` then `llm_virtual_keys`, both `IF EXISTS`, no `CASCADE`).
- No `CASCADE`: I checked the creating migrations. `llm_virtual_keys` has one FK (`ai_id` → `ais(id)`, `0005_clean_frightful_four.sql:37`) and `ai_daily_spend` has one FK (`ai_id` → `ais(id)`, `0009_premium_payback.sql:9`). Neither references the other, so the drop order in the Spec is safe and no cascade is required.
- No code change (confirmed by `git grep`).
- No journal/meta change. The effect migrator loads `apps/server/drizzle/*.sql` directly by numeric prefix (`apps/server/src/effect/sql.ts`, `sqlFileLoader`/`migrateSql`); `meta/_journal.json` is stale (last entry `0046_membership-indexes`) and was not updated for the hand-written migrations `0047`–`0058`, so `0059` follows that same convention.

### Files changed
- `apps/server/drizzle/0059_drop_litellm_tables.sql` (new)
- `work/T-1424-drop-litellm-tables.md` (status + this Report)

### Commands and real results
- `git grep -n "llm_virtual_keys\|ai_daily_spend" -- apps packages ':!**/drizzle/*.sql' ':!**/drizzle/meta/**'` → no output: no code or `db/rows.ts` reader/writer.
- `pnpm install` → `Done in 13.9s using pnpm v10.32.1`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/health.test.ts` → `Test Files 1 passed (1)`, `Tests 1 passed (1)`. The vitest global setup migrates a fresh PGlite through every migration file, so this run applied `0059` with no error.
- Direct check (inline pglite script, no file written): applied all 59 `.sql` files in order, then `SELECT to_regclass('public.llm_virtual_keys')` and `...('public.ai_daily_spend')` → both `null`, i.e. both tables are gone after the full migration chain.
- `pnpm gate` → exit 0, summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.8s)
  PASS  lint  (1.2s)
  PASS  typecheck  (4.1s)
  SKIP effect (no source files changed)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  GATE PASS
  ```

### Problems / deviations / open questions
- None blocking. The only deviation from the letter of the Spec is the missing journal entry, which is intentional: the repo's hand-written migrations are not registered in `meta/_journal.json` (see above), and updating it is outside the needed change and the "follow `0058` exactly" instruction.
- Gate skipped the `@zilar/server` test tier because a lone `.sql` file has no nearby test file; I covered migration application with the single `health.test.ts` run and the direct pglite check above.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0. The migration matches the spec. A read-only check of the live DB before the merge found llm_virtual_keys at 0 rows and ai_daily_spend at 0 rows. After deploy: expect 'migrations applied: 60'.
