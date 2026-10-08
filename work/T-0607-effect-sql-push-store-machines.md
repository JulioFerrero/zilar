---
id: T-0607
title: "effect/sql: push/store.ts (device save under the per-user advisory lock + cap, reads, removes, previews upsert) and machines/service.ts (pairing codes, pending/approved machines, the revoke transaction that clears ais.machine_id) fully off drizzle via sql.withTransaction per the pins recipe; same caps, locks, ON CONFLICT behaviour; tests unchanged"
status: todo
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
`apps/server/src/push/store.ts`, `apps/server/src/machines/service.ts`, `work/T-0607-effect-sql-push-store-machines.md`.

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

## Review (written by Claude)
