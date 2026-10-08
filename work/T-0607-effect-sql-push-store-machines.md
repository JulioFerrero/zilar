---
id: T-0607
title: "effect/sql: push/store.ts (device save under the per-user advisory lock + cap, reads, removes, previews upsert) and machines/service.ts (pairing codes, pending/approved machines, the revoke transaction that clears ais.machine_id) fully off drizzle via sql.withTransaction per the pins recipe; same caps, locks, ON CONFLICT behaviour; tests unchanged"
status: merged
milestone: M5
branch: task/T-0607-effect-sql-push-store-machines
model: auto
effort: low
depends_on: [T-0593]
estimate: 1 day
---

# T-0607: the push device store and the machine service on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example at `apps/server/src/pins/service.ts:179`. **Neither module receives a transaction from a caller**; the lead checked with grep.

### Verified facts (do not re-derive; read both files fully)
**`apps/server/src/push/store.ts`** (239 lines; comments at 11 and 64 explain the design):
- **`saveDevice` (73-115), one transaction:**
  - `pg_advisory_xact_lock(hashtext(userId))`;
  - `count(*)` against the per-user device cap;
  - read the nodes to replace;
  - delete them;
  - insert.
  
  **The count, deletes and insert stay in one transaction under the lock** (`AGENTS.md`, the caps rule).
- **Plain statements:**
  - `devicesForUser` (133);
  - `userIdsWithDevices` (140);
  - `removeDevice` (152);
  - `deviceByNode` (163);
  - `removeDeviceByNode` (172);
  - `markDeviceUsed` and `markDeviceFailed` (184, 195);
  - `showPreviewsForUser` (204);
  - `setShowPreviewsForUser` (218-225), **an upsert `onConflictDoUpdate`**; write the same `INSERT ... ON CONFLICT (...) DO UPDATE SET ...` in SQL.

**`apps/server/src/machines/service.ts`:**
- **Counts** (119, 188, 199): use `count(*)::int AS total`.
- **The pairing code insert** (153-155) is `onConflictDoNothing()`. Write `ON CONFLICT DO NOTHING`, and keep how the caller tells a conflict happened (for example `RETURNING` and a row count; read 145-170).
- **`consumePairingCode`** (173): a conditional `UPDATE`. Keep its `WHERE` exactly, since it is the single-use guard.
- **`insertPendingMachine`** (237); the list and reads (264, 276, 289); the updates and deletes (303, 322, 372, 387).
- **`revokeMachine` (337-365), one transaction:** update the machine, and `UPDATE ais SET machine_id = NULL, updated_at = $now WHERE machine_id = $id`. Read the comment at 337: the UI must never show a revoked machine as still in use.
- `.update(Buffer...)` at line 58 is a **hash**, not SQL; leave it.

**Common to both:**
- **The recipe:** `sql.withTransaction`; locks as raw SQL; exported functions stay `async` with the same signatures; a private `runSql(db, effect)`.
- **`SqlError`** maps to whatever these modules surface today; check what they throw and keep it.
- **Rows:** `snakeToCamel` gives camelCase, typed with the drizzle inferred types (type-only). The timestamps are timestamptz; check `db/schema.ts` for `push_subscriptions`, `push_settings`, `machines` and `machine_pairing_codes`, and if any column is bigint, convert it to a number the way the drizzle mode did.

**Tests (all unchanged):**
- `apps/server/src/push/*.test.ts`;
- `apps/server/src/machines/*.test.ts`;
- `apps/server/src/ais/*.test.ts`;
- the authz sweep (`authz-sweep`).

### What to build
1. Convert both files completely, keeping the transactions, locks, caps, conflict behaviour and conditional updates. Neither file keeps a value import from `drizzle-orm` or `db/schema`.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `docs/audit/effect-sql-migration.md` §(a), `apps/server/src/pins/service.ts` (lines 150-230), `apps/server/src/push/store.ts` and `apps/server/src/machines/service.ts`.

### Allowed files
`apps/server/src/push/store.ts`, `apps/server/src/machines/service.ts`, `apps/server/src/machines/hub.effect.test.ts` (lead-approved, test-only, for the one-shot failure injection in "survives an unexpected throw from the refresh loop"), `work/T-0607-effect-sql-push-store-machines.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot push machines ais authz-sweep
pnpm gate
```

### Acceptance
- Both modules run on effect/sql, transactions included, with the same behaviour.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

- **`apps/server/src/push/store.ts`** — fully on `effect/sql` with a private
  `runSql<A, E>(db, effect)` over `sqlRuntimeFor(db).runPromise`; no value import
  from `drizzle-orm` or `db/schema` (only type imports of `pushSettings` /
  `pushSubscriptions` for the row types). `saveDevice` keeps its single
  transaction, the `pg_advisory_xact_lock(hashtext(userId))`, the in-transaction
  `count(*)::int` cap check, the stale-row read/delete and the insert, and the
  post-commit best-effort `disablePushPair` loop. The plain reads/writes
  (`devicesForUser`, `userIdsWithDevices`, `removeDevice`, `deviceByNode`,
  `removeDeviceByNode`, `markDeviceUsed`, `markDeviceFailed`) and the
  `push_settings` upsert (`ON CONFLICT (user_id) DO UPDATE SET …`) are raw SQL.
  `openDevice` and `toPushDeviceView` are unchanged.
- **`apps/server/src/machines/service.ts`** — fully on `effect/sql`.
  `createPairingCode` keeps `ON CONFLICT DO NOTHING RETURNING *` and detects a
  conflict by an empty result; `consumePairingCode` keeps its conditional
  `UPDATE … WHERE code_hash = $1 AND used_at IS NULL AND expires_at > $2`.
  `insertPendingMachine` keeps the cap checks and maps a unique violation to
  `key_in_use` via `SqlError`'s `UniqueViolation` reason (with the raw
  `code === '23505'` fallback, no message matching). `revokeMachine` keeps its
  transaction: update the machine, then `UPDATE ais SET machine_id = NULL,
  updated_at = $now WHERE machine_id = $id`. Counts use `count(*)::int AS total`;
  `Buffer`/ed25519 helpers are untouched. No value import from `drizzle-orm` or
  `db/schema`.

### Deviation: nested jsonb keys are camelCased by the driver

`machines.capabilities` is a jsonb object with snake_case keys (`os_version`,
`ram_gb`, `disk_free_gb`). The `effect/sql` client's `transformResultNames`
also transforms nested jsonb keys (`Statement.defaultTransforms(..., nested)`),
so they arrive as `osVersion`, `ramGb`, `diskFreeGb`; `toPublicMachine` read
`''`/`0` for them and `machines/routes.test.ts` failed on the list assertion.
I added a small local `capability(capabilities, key)` helper that reads
`snakeToCamel(key)` and falls back to the stored snake_case key, so the API
output is byte-identical and a hand-built row still works. The architecturally
cleaner fix is `transformJson: false` on the `SqlLive` / `sqlLayerFor` clients
in `apps/server/src/effect/sql.ts`, which is outside this task's Allowed files.

### Test-only change (lead-approved, option 1)

`apps/server/src/machines/hub.effect.test.ts` previously injected the first
refresh failure with a hand-built `db` that only implemented `select`. Once
`listApprovedMachineKeys` moved to `effect/sql` that stand-in had no registered
runtime, so the refresh loop could never recover and the test timed out. Per the
lead's decision I replaced only that injection: a file-scoped partial
`vi.mock('./service', …)` overrides `listApprovedMachineKeys` with a one-shot
flag (`vi.hoisted`), and the test now passes `context.db`. The logger that
throws once, the `waitFor` on `effect-key-survives` and the
`expect(messages).toContain('runner hub key refresh loop failed')` assertion are
unchanged, and every other test in the file still reaches the real function
(the flag is off). This is the only test change in the packet.

### Files changed
- `apps/server/src/push/store.ts`
- `apps/server/src/machines/service.ts`
- `apps/server/src/machines/hub.effect.test.ts` (test-only, lead-approved)
- `work/T-0607-effect-sql-push-store-machines.md`

### Commands run (real results)

- `pnpm install` — exit 0 (only the pre-existing peer-dependency warning).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/store.test.ts`
  — 1 file passed, **7 passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/machines/routes.test.ts`
  — first run **1 failed | 25 passed** (nested jsonb keys, see the deviation
  above); after the `capability` helper, **1 file passed, 26 passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/machines/hub.effect.test.ts`
  — **3 passed** after the test-only injection change.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot push machines ais authz-sweep`
  — **20 passed | 2 skipped** (22 files); **232 passed | 3 skipped** (235 tests),
  exit 0.
- `pnpm gate` — final run:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (27.8s)
  PASS  lint  (0.9s)
  PASS  typecheck  (0.9s)
  PASS  tests @zilar/server  (535.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  Earlier gate attempts under the shared machine's heavy load (load average
  35–45, ~13 parallel gates) were SIGTERMed during the tests step before any
  test output; the final run at load ~17 completed and passed.

Earlier fixes found by the gate while the work landed: an unused `SqlError`
import in `push/store.ts` (lint) and three `TS4104` readonly-array assignments
in `machines/service.ts` and `push/store.ts` (typecheck), all fixed by spreading
the driver's `readonly` rows into a mutable array.

### Open question

None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 2 follow-ups. The packet (18:31) is newer than HEAD 0972ba85.
- **Lead check:**
  - the only test change is the lead-allowed failure injection in `hub.effect.test.ts`, with the same expectations;
  - the `saveDevice` lock and cap stay in one transaction;
  - the revoke transaction clears `ais.machine_id`;
  - the gate passes.
- **Follow-ups:**
  1. `transformResultNames` also camelCases jsonb keys, so a `jsonb` read on effect/sql changes nested key names. Here a local `capability()` helper hides it. Every converted jsonb read needs checking, and `transformJson: false` must be set in `effect/sql.ts` (next task);
  2. `push/api.ts` `isUniqueViolation` should check `SqlError.reason._tag` (it works today through the `cause.code` walk).
