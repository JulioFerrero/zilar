---
id: T-0589
title: "effect/sql: startup sticker count (warnOnEmptyStorageDir) off drizzle, with index.ts registering the sql runtime before the startup checks; plus the two T-0584 audit nits (stale comment name, wrong-type/missing-key issue text); tests unchanged"
status: merged
milestone: M5
branch: task/T-0589-effect-sql-startup-and-audit-nits
model: auto
effort: low
depends_on: [T-0584]
estimate: 0.5 day
---

# T-0589: the startup sticker count on effect/sql, and the audit nits

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle, and Effect Schema replaces zod. This task has two small parts.

### Verified facts (do not re-derive)
1. **The startup sticker count.** `apps/server/src/startup.ts:80-85`: `warnOnEmptyStorageDir({ db: Pick<ServerDatabase,'select'>, storageDir, warn })` runs `SELECT count(*) FROM stickers` through drizzle (imports at lines 2 and 4).
   - **Callers:**
     - `apps/server/src/index.ts:100`, which runs **before** `createApp` (index.ts:262), the place that calls `registerSqlRuntime(db, config.DATABASE_URL)` (`app.ts:254`);
     - `apps/server/src/startup.test.ts:110,127,175`, which pass `context.db` from `createTestContext` (that context registers the runtime).
   - **`registerSqlRuntime` is idempotent**: it returns the existing runtime (`apps/server/src/effect/sql.ts:81-89`). So `index.ts` can call `registerSqlRuntime(db, config.DATABASE_URL)` once, right before the startup checks, and `createApp`'s call then returns the same runtime.
2. **The T-0584 nits** in `apps/server/src/audit/service.ts`:
   - the comment at line 42 names `entryIssueMessage`, but the function is `firstIssueMessage` (around line 89);
   - `firstIssueMessage` returns `undefined` (so the thrown text reads `Invalid audit entry: unknown`) for a wrong type, for example `actorUserId: 42`, and for a missing key. Zod named the problem there.
     - Add `InvalidType` and `MissingKey` branches that give a short message: `Expected <type>` for a wrong type, and `Missing key` for a missing key.
     - The tests pin only the prefix `Invalid audit entry` and the 2048-byte text; both stay byte-identical.

### What to build
1. **`startup.ts`:**
   - the count runs through effect/sql with a local `runSql`, as in `apps/server/src/agents/gateway/db.ts`, as `SELECT count(*)::int AS total FROM stickers`;
   - the `db` parameter becomes `ServerDatabase`;
   - no `drizzle-orm` or `db/schema` import is left.
2. **`index.ts`:** call `registerSqlRuntime(db, config.DATABASE_URL)` right before `ensureWritableDir`/`warnOnEmptyStorageDir` (around line 98), with a one-line comment that `createApp` reuses it.
3. **`audit/service.ts`:**
   - fix the comment name;
   - add the two branches;
   - add **one** case to `apps/server/src/audit/service.test.ts` that asserts the thrown message for `actorUserId: 42` contains `Expected string` (it may also contain `Invalid audit entry:`). This is the only test change.
4. **Tests:** every other listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/startup.ts`, `apps/server/src/index.ts` (lines 1-110 and 250-270), `apps/server/src/effect/sql.ts` (lines 75-100) and `apps/server/src/audit/service.ts` (lines 30-135).

### Allowed files
`apps/server/src/startup.ts`, `apps/server/src/index.ts`, `apps/server/src/audit/service.ts`, `apps/server/src/audit/service.test.ts`, `work/T-0589-effect-sql-startup-and-audit-nits.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot startup audit
pnpm gate
```

### Acceptance
- `startup.ts` has no drizzle, and `index.ts` registers the runtime before the startup checks.
- An audit entry with a wrong type throws a named message.
- One new audit test was added; every other listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `startup.ts`: `warnOnEmptyStorageDir` now counts stickers through effect/sql
  (`SELECT count(*)::int AS total FROM stickers` via a local `runSql`, same shape
  as `agents/gateway/db.ts`). `db` param is `ServerDatabase`; no `drizzle-orm` or
  `db/schema` import left.
- `index.ts`: calls `registerSqlRuntime(db, config.DATABASE_URL)` right after
  `ensureWritableDir(stickerDir, ...)` and before `warnOnEmptyStorageDir`, with a
  one-line comment that `createApp` reuses it (register is idempotent).
- `audit/service.ts`: fixed comment `entryIssueMessage` -> `firstIssueMessage`;
  added `InvalidType` (via `SchemaIssue.defaultLeafHook`, e.g. `Expected string`)
  and `MissingKey` (`Missing key`) branches to `firstIssueMessage`.
- `audit/service.test.ts`: one new case, `names a wrong type`, asserting
  `actorUserId: 42` throws `/Invalid audit entry:.*Expected string/`.

### Deviation from the spec worth knowing
The spec's model was that `firstIssueMessage` would see an `InvalidType` issue
for the wrong-type case. In Effect 4.0.2 the union failure flattens to an `AnyOf`
with **zero** child issues (verified with a throwaway debug test: `Composite[1] >
Pointer > AnyOf[0]`), so the tree walk finds nothing. I kept the two new branches
and added a fallback in `decodeEntry` to the schema message's first line
(`Expected string | null`), which is what makes the new test pass. The
`MissingKey` branch is reached normally (missing-key decodes as
`Composite > Pointer > MissingKey`; the debug test showed its schema message
first line is also `Missing key`). The `InvalidType` branch fires for direct
non-union schemas.

### Files changed
`apps/server/src/startup.ts`, `apps/server/src/index.ts`,
`apps/server/src/audit/service.ts`, `apps/server/src/audit/service.test.ts`
(plus this task file).

### Commands and real results
- `pnpm install`: done, 20.8s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/audit/service.test.ts`:
  first run 20 passed, 1 failed (new test got `Invalid audit entry: unknown`);
  after fallback fix: 21 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/startup.test.ts`:
  11 passed (unchanged).
- `pnpm exec prettier --write apps/server/src/audit/service.test.ts` (repo's own
  prettier; `npx` is blocked): reformatted the new test; other files unchanged.
- `pnpm gate` (background, machine shared with other workers' gates):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (9.3s)
  PASS  format  (141.4s)
  PASS  lint  (2.1s)
  PASS  typecheck  (1.7s)
  PASS  tests @zilar/server  (2698.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Security checklist
- No secrets in logs/audit/errors; count query returns only a number.
- No deletes/updates touched; no new routes; audit detail rule untouched.
- The startup count read is a plain SELECT, no permission gating existed before.

### Open questions
None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (13:07) is newer than HEAD f17699d2.
- **Lead check:**
  - `index.ts` registers the sql runtime before the startup checks, and `createApp` reuses it;
  - the sticker count runs on effect/sql;
  - the one allowed new audit test asserts the named wrong-type text (`Invalid audit entry: ... Expected string`).
