---
id: T-0589
title: "effect/sql: startup sticker count (warnOnEmptyStorageDir) off drizzle, with index.ts registering the sql runtime before the startup checks; plus the two T-0584 audit nits (stale comment name, wrong-type/missing-key issue text); tests unchanged"
status: todo
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

## Review (written by Claude)
