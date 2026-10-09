---
id: T-0675
title: "effect/sql phase 2 (C4): move the two setup/api.ts transactions and the integrations mail save onto effect/sql using the T-0667 Effects; setup/settings.ts drops its drizzle helpers and SetupTransaction"
status: merged
milestone: M5
branch: task/T-0675-setup-transactions-effect-sql
model: auto
effort: low
depends_on: [T-0667, T-0669]
estimate: 0.3 day
---

# T-0675: setup transactions on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. T-0667 (merged) added `needsSetupEffect`, `getMailSettingsEffect`, `saveMailSettingsEffect`, `deleteMailSettingsEffect` and `takeSetupLockEffect` to `apps/server/src/setup/settings.ts`. This task moves their callers and removes the drizzle versions.

### Verified facts (do not re-derive)
- **`apps/server/src/setup/api.ts`:**
  - the header (lines 6-8) says the transactions stay on drizzle;
  - **setup transaction** (lines 237-251): `Effect.promise(() => deps.db.transaction(async (tx) => { takeSetupLock; if (needsSetup(tx)) { saveMailSettings(tx, cipher, …); inviteCode = createSetupInvite(tx); } }))`, then `.pipe(Effect.map(ok), Effect.catchDefect(…))`. An `HttpError` defect is rethrown; anything else becomes `HttpError(500, 'internal_error', 'Setup failed, try again')`;
  - **rollback transaction** (lines 281-295): lock, then if `needsSetup`, `deleteMailSettings` and `DELETE FROM invites WHERE code = code`, with the same catchDefect shape. A rollback failure only logs `errName` and still answers 422;
  - `createSetupInvite(tx)` (line 369): `INSERT INTO invites (id, code, created_by, created_at, expires_at, max_uses, uses)` with `randomUUID()`, `generateInviteCode()`, null, now, `now + DEFAULT_INVITE_TTL_DAYS` days, `DEFAULT_INVITE_MAX_USES` and 0, `RETURNING`. With no row it throws `HttpError(500, 'internal_error', 'Setup failed, try again')`;
  - lines 196, 214 and 362 call `needsSetup(deps.db)` and `getMailSettings(deps.db, …)` with a plain db.
- **`apps/server/src/integrations/api.ts:436-440`:** `Effect.promise(() => deps.db.transaction(async (tx) => { await saveMailSettings(tx, cipher, { resendApiKey: storedKey, from }); }))`. Line 405 calls `getMailSettings(deps.db, cipher)`.
- **`apps/server/src/integrations/routes.ts`:** line 21 imports `type SetupTransaction`, and line 233 re-exports it. Line 196 calls `getMailSettings(deps.db, …)`.
- **`apps/server/src/index.ts:82`** calls `getMailSettings(db, …)`. **`apps/server/src/setup/routes.test.ts`** calls `getMailSettings(context.db, …)` and `needsSetup(context.db)`.
- **`apps/server/src/setup/routes.test.ts:222-248`** ("still answers 422 when the rollback itself fails") breaks the *second* `context.db.transaction` call with `vi.spyOn`. effect/sql never calls it.
- **The model for that test:** `apps/server/src/voice-transcription/pipeline.test.ts` (T-0669), which uses a partial `vi.mock('../effect/sql', …)` with `sqlRuntimeFor: vi.fn(actual.sqlRuntimeFor)` and then `mockReturnValueOnce({ runPromise: () => Promise.reject(err) })`.
- **The recipe:** a private `runSql(db, effect)` that calls `sqlRuntimeFor(db).runPromise`, `sql.withTransaction`, and `Effect.fail(new HttpError(…))` so the caller sees the same object.

### What to build
1. **`setup/api.ts`:**
   - run both transactions as `Effect.promise(() => runSql(deps.db, Effect.gen(… sql.withTransaction(…))))`, with the same steps in the same order, through the T-0667 Effects;
   - turn `createSetupInvite` into an Effect with the same insert and the same `HttpError`;
   - do the invite delete with `sql`;
   - keep the `.pipe(Effect.map, Effect.catchDefect)` handling and every text as they are;
   - update the header comment;
   - drop the drizzle imports.
2. **`setup/settings.ts`:**
   - `needsSetup(db)` and `getMailSettings(db, cipher)` become `runSql(db, …Effect)` wrappers;
   - delete `saveMailSettings`, `deleteMailSettings`, `takeSetupLock`, the `SetupTransaction` type and the drizzle imports.
3. **`integrations/api.ts:436-440`:** `Effect.promise(() => runSql(deps.db, saveMailSettingsEffect(cipher, { resendApiKey: storedKey, from })))`, using `sqlRuntimeFor` directly or a local `runSql`.
4. **`integrations/routes.ts`:** remove the `SetupTransaction` import and its re-export.
5. **`setup/routes.test.ts`:** rewrite only the 222-248 test, so the second `sqlRuntimeFor(...)` call returns a runtime whose `runPromise` rejects with `new Error('database is down')`. Use the T-0669 pattern, and keep every assertion. All other tests stay unchanged.

### Read first
`AGENTS.md`, `apps/server/src/setup/api.ts`, `apps/server/src/setup/settings.ts`, `apps/server/src/voice-transcription/pipeline.test.ts` (lines 1-50 and 115-135), `apps/server/src/setup/routes.test.ts` (lines 1-60 and 200-250).

### Allowed files
`apps/server/src/setup/api.ts`, `apps/server/src/setup/settings.ts`, `apps/server/src/setup/routes.test.ts`, `apps/server/src/integrations/api.ts`, `apps/server/src/integrations/routes.ts`, `apps/server/src/integrations/settings.ts` (lead, round 2: comment only), `work/T-0675-setup-transactions-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/setup src/integrations
pnpm gate
```

### Acceptance
- No drizzle in `setup/settings.ts` or `setup/api.ts`.
- `SetupTransaction` is gone.
- The setup and integrations tests pass, with only the one test rewritten.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Moved the two `setup/api.ts` transactions and the integrations mail save onto `effect/sql`, through the T-0667 Effects.

- `setup/settings.ts`: dropped all drizzle imports, the `SetupTransaction` type, `Queryable`, and the drizzle `saveMailSettings` / `deleteMailSettings` / `takeSetupLock`. `needsSetup(db)` and `getMailSettings(db, cipher)` are now thin `runSql(db, …Effect)` wrappers over `needsSetupEffect()` / `getMailSettingsEffect(cipher)`. The T-0667 Effects are unchanged.
- `setup/api.ts`: both transactions now run through a private `runSql(db, effect)` (`sqlRuntimeFor(db).runPromise`) with `sql.withTransaction`, using `takeSetupLockEffect`, `needsSetupEffect`, `saveMailSettingsEffect`, `deleteMailSettingsEffect`; the invite delete is `` sql`DELETE FROM invites WHERE code = ${code}` ``. `createSetupInvite` is now an Effect that keeps the same insert (same columns, `randomUUID()`, `generateInviteCode()`, TTL/max-uses) and the same `Effect.fail(new HttpError(500, 'internal_error', 'Setup failed, try again'))`. The `.pipe(Effect.map, Effect.catchDefect)` handling and every text are unchanged. Removed the drizzle `eq`/`invites` imports; updated the header comment.
- `integrations/api.ts`: the mail save now runs `sqlRuntimeFor(deps.db).runPromise(saveMailSettingsEffect(cipher, …))`; `getMailSettings` still uses the wrapper.
- `integrations/routes.ts`: removed the `SetupTransaction` import and re-export.
- `setup/routes.test.ts`: rewrote only the "still answers 422 when the rollback itself fails" test to the T-0669 pattern (`vi.mock('../effect/sql', …)` with `sqlRuntimeFor: vi.fn(actual.sqlRuntimeFor)`), breaking the rollback's runtime. Kept every previous assertion.

### Files changed
- `apps/server/src/setup/settings.ts`
- `apps/server/src/setup/api.ts`
- `apps/server/src/setup/routes.test.ts`
- `apps/server/src/integrations/api.ts`
- `apps/server/src/integrations/routes.ts`
- `work/T-0675-setup-transactions-effect-sql.md`

### Commands and real results
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/setup src/integrations` → 4 files passed, 49 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/setup/routes.test.ts` → 1 file passed, 16 tests passed.
- `pnpm gate` (repo root) → summary lines:
  - `gate: 6 changed file(s) against main`
  - `PASS  install (frozen)  (3.3s)`
  - `PASS  format  (25.6s)`
  - `PASS  lint  (1.9s)`
  - `PASS  typecheck  (5.8s)`
  - `PASS  tests @zilar/server  (25.3s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Deviations / notes
- Spec item 5 says to break the "second `sqlRuntimeFor(...)` call", but on the POST path the rollback is the **third** call: `needsSetup` (the pre-check at `api.ts:214` now goes through `runSql`), the setup transaction, then the rollback. I break the third and assert `expect(calls).toBe(3)` so the test truly exercises the rollback path.
- `index.ts`, `setup/settings.effect.test.ts` and the rest of `setup/routes.test.ts` needed no changes because the `needsSetup` / `getMailSettings` wrappers and all T-0667 Effects kept their signatures.

### Round 2 (lead review)
1. `apps/server/src/integrations/api.ts`: restored the transaction the old `deps.db.transaction` gave the mail save — the two upserts in `saveMailSettingsEffect` now run inside `sql.withTransaction` via `sqlRuntimeFor(deps.db).runPromise`, still inside the same `Effect.promise`. Added the `SqlClient` import from `effect/sql`.
2. `apps/server/src/integrations/settings.ts:22`: reworded the stale comment to name `getMailSettings`, `saveMailSettingsEffect`, `settingsCipherFor`, `RESEND_API_KEY_SETTING` and `MAIL_FROM_SETTING` (comment only; the file was added to Allowed files for this).

Commands re-run after the fixes:
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/setup src/integrations` → 4 files passed, 49 tests passed.
- `pnpm gate` (repo root) → `gate: 7 changed file(s) against main`; `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/server`; `scope: every changed file is inside the Allowed files`; `GATE PASS`.

## Review (written by Claude)

**2026-10-09, lead:** approved after one lead fix round.
- **Pre-review:** clean; the packet head is 84df69ee, the current HEAD.
- **Result:** both setup transactions run in `sql.withTransaction`, with the lock, the re-check and the writes, and `createSetupInvite` is an Effect. `SetupTransaction` and the drizzle setup helpers are gone.
- **Round 2:** the integrations mail save is back in a transaction (my spec had dropped it), and the stale comment in integrations/settings.ts is fixed.
- **Test:** the rollback test now breaks the 3rd `sqlRuntimeFor` call and asserts it.
- **Nit I accepted:** `return yield* Effect.fail(...)` is the usual Effect idiom.
