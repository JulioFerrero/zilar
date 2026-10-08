---
id: T-0668
title: "effect/sql (C4): move the Telegram bot token store in integrations/settings.ts onto effect/sql (take db, not a tx) and drop the two one-statement drizzle transactions around it in integrations/api.ts"
status: merged
milestone: M5
branch: task/T-0668-telegram-token-effect-sql
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0668: Telegram bot token store on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. The Telegram token helpers are only ever wrapped in single-statement transactions, so they can move at once.

### Verified facts (do not re-derive)
- **`apps/server/src/integrations/settings.ts`** (60 lines, drizzle):
  - `getStoredTelegramToken(db, cipher)` (line 31) reads every `instance_settings` row, finds `telegram.bot_token` and decrypts it, or returns null;
  - `saveStoredTelegramToken(tx: SetupTransaction, cipher, token)` (line 43) upserts the encrypted value with `updated_at = now`;
  - `deleteStoredTelegramToken(tx)` (line 58) deletes the key;
  - line 20 imports `SetupTransaction` from `../setup/settings`.
- **The only callers of save and delete** are `apps/server/src/integrations/api.ts:336-338` (`deps.db.transaction(async (tx) => { await saveStoredTelegramToken(tx, cipher, botToken); })`) and `:367-369` (the same for delete), each inside `yield* Effect.promise(() => …)`. `apps/server/src/integrations/routes.ts:232` re-exports both names, and `routes.ts:121,186` call `getStoredTelegramToken(deps.db, …)`.
- **The model to copy:** `apps/server/src/voice-transcription/settings.ts:36-120`. A private `runSql(db, effect)` calls `sqlRuntimeFor(db).runPromise`, and the upsert is `INSERT INTO instance_settings (key, value) VALUES (…) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`.
- **Tests:** `apps/server/src/integrations/routes.test.ts` covers set, read and remove (lines 140-180 and 300-312).

### What to build
1. **`integrations/settings.ts`:**
   - add a private `runSql` like the model;
   - `getStoredTelegramToken(db, cipher)` reads with `SELECT value FROM instance_settings WHERE key = …`;
   - `saveStoredTelegramToken(db: ServerDatabase, cipher, token)` and `deleteStoredTelegramToken(db: ServerDatabase)` each run one statement;
   - drop the drizzle imports and the `SetupTransaction` import.
2. **`integrations/api.ts:336-338` and `:367-369`:** replace each `deps.db.transaction(...)` with a direct call, `yield* Effect.promise(() => saveStoredTelegramToken(deps.db, cipher, botToken))` and the same for delete. Keep everything around them as it is.
3. **Do not touch** the mail calls at `integrations/api.ts:445` (those are T-0667's and a later task's).

### Read first
`AGENTS.md`, `apps/server/src/integrations/settings.ts`, `apps/server/src/voice-transcription/settings.ts` (lines 1-120), `apps/server/src/integrations/api.ts` (lines 320-380).

### Allowed files
`apps/server/src/integrations/settings.ts`, `apps/server/src/integrations/api.ts`, `work/T-0668-telegram-token-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/integrations/routes.test
pnpm gate
```

### Acceptance
- `integrations/settings.ts` has no drizzle import.
- The existing integrations tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/integrations/settings.ts`: rewritten on effect/sql with a private `runSql` (same shape as `voice-transcription/settings.ts`). Drizzle imports and the `SetupTransaction` import are gone.
  - `getStoredTelegramToken(db, cipher)` runs `SELECT value FROM instance_settings WHERE key = …` and decrypts the first row, or returns null.
  - `saveStoredTelegramToken(db, cipher, token)` runs one `INSERT … ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`.
  - `deleteStoredTelegramToken(db)` runs one `DELETE … WHERE key = …`.
  - Added a small `StoredValueRow` interface for the select result (Prettier wrapped the inline generic badly).
- `apps/server/src/integrations/api.ts`: the two one-statement transactions are replaced by `yield* Effect.promise(() => saveStoredTelegramToken(deps.db, cipher, botToken))` and `yield* Effect.promise(() => deleteStoredTelegramToken(deps.db))`. Nothing else in that file changed. The mail call near line 445 is untouched.
- `work/T-0668-telegram-token-effect-sql.md`: status set to in-progress while working, then review; this Report.

### Commands and results
- `pnpm install`: exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/integrations/routes.test`: 22 passed, 0 failed (run after the code change, before the formatting fix; rerun after formatting: 22 passed).
- `pnpm exec prettier --check` on the two source files: "All matched files use Prettier code style!"
- `pnpm gate` (run twice; the first run failed on Prettier formatting and on a stray scratch log file, both fixed, log moved out of the worktree):
  - PASS install (frozen)
  - PASS format
  - PASS lint
  - PASS typecheck
  - PASS tests @zilar/server
  - scope: every changed file is inside the Allowed files
  - GATE PASS

### Problems / deviations
- None against the spec. `updated_at` is now set by SQL `now()` instead of a JS `new Date()` (the spec asks for this, and it matches the voice model).
- `routes.ts` still re-exports `SetupTransaction` from `../setup/settings` (line 233). That is outside Allowed files, so I left it alone. The type still exists and nothing imports it through `integrations/settings.ts`.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, as a Claude Code subagent, in one round (about 2.8 min). The lead reviewed the diff directly.
- **Result:** the token store is on effect/sql, with a single-key read, the same upsert as voice settings, and a single-key delete. The two one-statement transactions are gone, and the integrations tests pass unchanged.
- **Gate:** the first run failed on format and a stray scratch file, both fixed by the worker; the final gate passed.
