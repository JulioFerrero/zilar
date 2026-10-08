---
id: T-0626
title: "Audit: the Effect last mile; every file still on drizzle, hono or zod grouped by what blocks it, an ordered list of small tasks, and a check for bigint columns read as numbers through effect/sql; writes docs/audit/effect-last-mile.md only"
status: todo
milestone: M5
branch: task/T-0626-audit-effect-last-mile
model: auto
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0626: plan the Effect last mile

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0. About 52 non-test files still import a legacy library. Many of the rest are blocked by something else: a caller's drizzle transaction, tests that mount an old Hono router, or the server shell. The lead needs one plan to cut small tasks from.

### Verified facts (do not re-derive)
- **The list of files** comes from this command, run from the repo root:
  ```bash
  git grep -lE "from '(drizzle-orm|hono|@hono/|zod|zustand)" -- 'apps' 'packages' ':!*.test.ts' ':!*.test.tsx'
  ```
  Then drop the lines that are `import type` only.
- **Item-11 Hono wrappers.** Many `apps/server/src/*/routes.ts` files are thin Hono wrappers that tests still mount. One example is `apps/server/src/files/routes.ts`; `docs/EFFECT_GUIDE.md` item 11 explains them.
- **Functions that must stay on drizzle until their caller's transaction moves:**
  - `approvals/rules.ts` `createRule`, `findActiveRuleForUpdate` and `revokeActiveRulesForAiInGroup`;
  - `tools/service.ts` `deleteToolsForAiInGroup` and `deleteToolsForAiInTopic`;
  - `connections/service.ts` `decryptForGatewayUse`;
  - the setup settings cluster: `setup/settings.ts`, `integrations/settings.ts` and `setup/api.ts`, which share `SetupTransaction`.
- **effect/sql returns a Postgres `bigint` as a string.** drizzle's `bigint(..., { mode: 'number' })` (for example `media_items.at_micros`, `apps/server/src/db/schema.ts:1400`) types it as `number`. A converted query that reads such a column with `SELECT *` and the drizzle row type then hands a string to code that expects a number.

### What to build (one file: `docs/audit/effect-last-mile.md`)
1. **Inventory:** a table with one row per file: path, lines, legacy libraries, group (below), and what blocks it, with `file:line`.
   - **A, test-only Hono wrappers:** which tests mount each one (path list), and what those tests need, such as an injected `fetchImpl` or `now`.
   - **B, the server shell:** `app.ts`, `index.ts`, `effect/http.ts`, `push/api.ts`, `audit/api.ts`, and any other file where Hono still serves traffic.
   - **C, drizzle waiting for a caller's transaction:** draw each chain, caller to callee.
   - **D, drizzle core:** `db/client.ts`, `db/migrate.ts`, `db/schema.ts`, `auth/auth-schema.ts` (better-auth), `auth/cli-config.ts`, `test-support.ts`, `effect/sql.ts`. For each, say what has to happen first.
   - **E, zod leftovers:** each, with the reason it is still there.
   - **F, plain drizzle modules:** files with no blocker that can be converted now.
2. **Ordered task list:** small tasks of at most one module or one chain each, in dependency order. For each, give the files, the tests to run, and a size (S under 0.5 day, M up to 1 day).
3. **The bigint check:**
   - list every bigint column in `apps/server/src/db/schema.ts`;
   - then list every effect/sql query in `apps/server/src` (grep for `SqlClient.SqlClient`) that returns one of those columns, with `file:line`;
   - for each, say whether the code treats the value as a number (arithmetic, comparisons, `JSON` output, `Date` math) and could now get a string;
   - mark each **safe** or **bug**, with the evidence. A query that casts in SQL (`::int`, `::float8`) or converts with `Number(...)` is safe.
4. **No code changes.**

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-sql-migration.md`, `docs/audit/effect-everywhere-plan.md`, `apps/server/src/effect/sql.ts`.

### Allowed files
`docs/audit/effect-last-mile.md`, `work/T-0626-audit-effect-last-mile.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/effect-last-mile.md` exists with the inventory, the ordered task list and the bigint check.
- Every claim cites a `file:line`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
