---
id: T-0667
title: "effect/sql phase 1 (C4): add Effect versions of the setup/settings.ts helpers (needsSetup, getMailSettings, saveMailSettings, deleteMailSettings, takeSetupLock); drizzle versions unchanged; new tests"
status: todo
milestone: M5
branch: task/T-0667-setup-settings-effects
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0667: setup settings helpers as Effects

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. `apps/server/src/setup/api.ts:238` and `:282` run drizzle transactions that pass `tx` into the helpers in `apps/server/src/setup/settings.ts`, so the helpers cannot move until those transactions move. Phase 1 adds an Effect version of each helper next to the drizzle one. Phase 2, a later task, switches `setup/api.ts` to `sql.withTransaction` and deletes the drizzle versions. **Keep every drizzle function exactly as it is.**

### Verified facts (do not re-derive)
- **`apps/server/src/setup/settings.ts`** (98 lines, all drizzle):
  - `needsSetup(db)` (line 51): `SELECT id FROM "user" LIMIT 1` gives true when there is no row;
  - `getMailSettings(db, cipher)` (line 56): reads every `instance_settings` row, takes `mail.resend_api_key` (decrypted) and `mail.from`, and returns null if either is missing;
  - `saveMailSettings(tx, cipher, settings)` (line 69): upserts the two keys (the key encrypted) with `updated_at = now`;
  - `deleteMailSettings(tx)` (line 89): deletes both keys;
  - `takeSetupLock(tx)` (line 95): `SELECT pg_advisory_xact_lock(hashtext('zilar-first-run-setup'))` (`SETUP_LOCK`, line 22).
- **The model to copy:** `apps/server/src/voice-transcription/settings.ts:36-120` already does the same on effect/sql. Its upsert is `INSERT INTO instance_settings (key, value) VALUES (…) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, and its tests run statements with `sqlRuntimeFor(db).runPromise(...)` (`apps/server/src/effect/sql.ts:98`).
- **The table** `"user"` is the better-auth user table (`db/schema.ts`, export `user`). Quote it in SQL: `"user"`.
- **Test context:** `createTestContext` from `apps/server/src/test-support`, used as in `apps/server/src/setup/routes.test.ts:12` with `beforeEach` and `afterEach`.

### What to build
1. **In `setup/settings.ts`, export** `needsSetupEffect()`, `getMailSettingsEffect(cipher)`, `saveMailSettingsEffect(cipher, settings)`, `deleteMailSettingsEffect()` and `takeSetupLockEffect()`. Each returns `Effect.Effect<…, SqlError.SqlError, SqlClient.SqlClient>`, with the same SQL meaning as its drizzle twin.
2. **Add a short comment** above the new block: these are for `setup/api.ts` once its transactions move, and the drizzle versions go then.
3. **Add a new test file `apps/server/src/setup/settings.effect.test.ts`.** Run each Effect with `sqlRuntimeFor(context.db).runPromise(...)`:
   - `needsSetupEffect` is true on an empty db;
   - save then get round-trips the key and the sender, decrypting with `settingsCipherFor(context.config)`;
   - after delete, get returns null;
   - `takeSetupLockEffect` inside `sql.withTransaction` resolves.
4. **Do not change** any drizzle function or any caller.

### Read first
`AGENTS.md`, `apps/server/src/setup/settings.ts`, `apps/server/src/voice-transcription/settings.ts`, `apps/server/src/setup/routes.test.ts` (lines 1-80).

### Allowed files
`apps/server/src/setup/settings.ts`, `apps/server/src/setup/settings.effect.test.ts`, `work/T-0667-setup-settings-effects.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/setup/settings.effect.test
pnpm gate
```

### Acceptance
- The new tests pass, and the existing tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
