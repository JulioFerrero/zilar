---
id: T-0614
title: "effect/sql: stop camelCasing keys inside jsonb values (transformJson: false on the three clients in effect/sql.ts); routine input, audit detail and machine capabilities read back byte-identical to what was written; drop T-0607's local capability() fallback; one regression test"
status: todo
milestone: M5
branch: task/T-0614-effect-sql-json-keys
model: auto
effort: low
depends_on: [T-0607]
estimate: 0.5 day
---

# T-0614: keep jsonb keys as written on effect/sql

## Spec (written by Claude, do not edit)

### Why
A bug on main. The effect/sql clients use `transformResultNames: snakeToCamel`, which by default also renames keys **inside jsonb values**. The T-0607 pre-review found it: `machines.capabilities.os_version` read back as `osVersion`. T-0607 hid it in `machines/service.ts` with a local `capability()` helper.

Other converted modules read jsonb with arbitrary keys through effect/sql:
- `apps/server/src/routines/scheduler.ts:134` (`SELECT *` from routines) and `:168` (`RETURNING *`). The row's `input` is passed as the tool input in `apps/server/src/routines/execute.ts:147`, so a routine whose input has a key like `max_items` runs its tool with `maxItems`;
- `apps/server/src/audit/service.ts:410` returns `row.detail`.

Drizzle never renamed jsonb keys.

### Verified facts (do not re-derive)
- **`apps/server/src/effect/sql.ts`** builds three clients, each with `transformResultNames: snakeToCamel`:
  - `SqlLive` (`PgClient.layerConfig`, lines 47-54);
  - `sqlLayerFor`'s PGlite layer (66-69);
  - `sqlLayerFor`'s pg layer (71-75).
- Both drivers accept `transformJson?: boolean` (`@effect/sql-pg` `PgClient.d.ts:107`, `@effect/sql-pglite` `PgliteClient.d.ts:107`). **`transformJson: false`** keeps column names camelCased but leaves jsonb content untouched.
- **The jsonb columns** (`apps/server/src/db/schema.ts`):
  - lines 628-630 and 1271, 1305, 1362 are string arrays (unaffected);
  - **1000** `capabilities`, **1140** `detail`, **1177** `args`, **1360** `schedule` and **1361** `input` are objects with keys;
  - 1410 is a number array.
- **T-0607** (merged before this task) added a `capability()` fallback in `apps/server/src/machines/service.ts` (about line 452) that accepts both key spellings. With the fix it is no longer needed: remove it and read the stored key directly. Read the code and its comment first.
- **Check every effect/sql reader of those five object columns** (grep the column names among files that use `yield* sql`). After the fix, they get exactly the stored keys. If any code depends on the camelCased nested keys, list it in the Report and fix it inside the Allowed files, or report it as a blocker.

### What to build
1. Add `transformJson: false` to all three client configs in `effect/sql.ts`, with a one-line comment explaining why.
2. Remove the `capability()` fallback in `machines/service.ts`, keeping the same output.
3. **Regression test** in `apps/server/src/effect/sql.test.ts`: write a jsonb value with nested snake_case keys (for example `{"max_items": 2, "nested_key": {"inner_key": 1}}`) through a runtime from `sqlLayerFor`/`registerSqlRuntime` (follow the file's existing setup), read it back with `SELECT *`, and assert the keys are unchanged while the column names are camelCased. Pick an existing table with a jsonb object column, or a temp table if the file already creates tables. The test must fail without step 1.
4. **Existing tests:** every existing test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/effect/sql.ts`, `apps/server/src/effect/sql.test.ts`, and `apps/server/src/machines/service.ts` (around `capability`).

### Allowed files
`apps/server/src/effect/sql.ts`, `apps/server/src/effect/sql.test.ts`, `apps/server/src/machines/service.ts`, `work/T-0614-effect-sql-json-keys.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot effect/sql machines routines audit
pnpm gate
```

### Acceptance
- jsonb values read through effect/sql keep their stored keys, and the new test proves it.
- The `capability()` fallback is gone, and every existing test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
