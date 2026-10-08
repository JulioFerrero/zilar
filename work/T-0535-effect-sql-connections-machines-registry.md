---
id: T-0535
title: "Effect C1: connections/service.ts and machines/registry.ts on effect/sql (same queries, same answers, keys stay encrypted at rest); signatures unchanged, every test unchanged"
status: merged
milestone: M5
branch: task/T-0535-effect-sql-connections-machines-registry
model: auto
effort: low
depends_on: [T-0510]
estimate: 0.5 day
---

# T-0535: connections service and machine registry on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server service onto effect/sql"**, with examples in `apps/server/src/blocks/service.ts` and `apps/server/src/contacts/service.ts` (T-0522).

### Verified facts (do not re-derive)
- **`apps/server/src/connections/service.ts`** (130 lines) exports `PublicConnection`, `CreateConnectionInput` (it carries `encryptedKey`), `listConnections` (line 38), `createConnection` (50), `findOwnedConnection` (72), `deleteConnection` (85), `countAisUsingConnection` (101) and **`decryptForGatewayUse(db, cipher, id)`** (116). That last one reads `encryptedKey` and decrypts in memory only.
  - **The only outside importer** is `apps/server/src/ais/service.ts:4`. It calls `findOwnedConnection(deps.db, …)` (line 223) and `decryptForGatewayUse(deps.db, …)` (line 296) with the plain db, **not inside a transaction**.
  - The connections routes import the service too (read `apps/server/src/connections/routes.ts`).
- **`apps/server/src/machines/registry.ts`** (71 lines): `createDbMachineRegistry(db)` returns `{ getApprovedPublicKey, touchLastSeen, onRevoke, onApprove, … }`. Only `getApprovedPublicKey` (line 30) and `touchLastSeen` (line 41) touch the DB; the listener sets stay as they are.
- **Callers:** `apps/server/src/app.ts:357` (`createDbMachineRegistry(db)` as a default) and **`apps/server/src/index.ts:148`**. **index.ts creates the registry before `createApp` (line 262), and `createApp` is what calls `registerSqlRuntime(db, …)` (`app.ts:250`).** `sqlRuntimeFor(db)` must therefore be resolved **at call time**, never when the registry is created. Check that nothing calls the registry before `createApp` runs (read `index.ts` from line 140); if something does, stop and report BLOCKED.
- **Tests (all unchanged):** `apps/server/src/connections/{crypto,integration,probe,routes}.test.ts`, `apps/server/src/machines/{registry,routes,hub,hub.effect,codes}.test.ts` and `apps/server/src/ais/*.test.ts`.

### What to build
1. **Both files on effect/sql**, following the recipe:
   - the same exported functions, signatures and return values;
   - the same row shapes (`createdAt` and the other dates as today);
   - **`encryptedKey` never leaves the service** except through `decryptForGatewayUse`, as today;
   - no `drizzle-orm` import left in either file.
2. **No caller changes.** If one is needed, stop and report BLOCKED.
3. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/effect/sql.ts`, `apps/server/src/contacts/service.ts`, both files in full, `apps/server/src/index.ts` (lines 140-270).

### Allowed files
`apps/server/src/machines/registry.ts`, `apps/server/src/test-support.ts`, `work/T-0535-effect-sql-connections-machines-registry.md`.

**Lead re-scope, 2026-10-08** (the blocked report is right: `ais/service.ts` calls `decryptForGatewayUse` with a drizzle transaction handle at lines 879 and 975):
- **Drop `connections/service.ts` from this task.** Leave it on drizzle; it moves together with `ais/service.ts`'s transactions in a later task. Revert any change to it.
- **Convert `machines/registry.ts` only,** as specified (resolve `sqlRuntimeFor(db)` at call time).
- **`apps/server/src/test-support.ts`:** `createTestContext` registers the effect/sql runtime for its PGlite db with `registerSqlRuntime(db, '')`. It is idempotent, so `createApp` registering it again is a no-op. Its `close()` calls `disposeSqlRuntime(db)` before closing the client. That way a service test that never builds an app still has a runtime.
- Every test passes unchanged, and the full server suite stays green (the gate runs it).

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot connections machines ais
pnpm gate
```

### Acceptance
- Both files run on effect/sql with the same answers, and have no `drizzle-orm` import.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Re-scoped per the lead's 2026-10-08 note. `apps/server/src/connections/service.ts` was
**not** touched: it stays on drizzle and moves later together with `ais/service.ts`'s
transactions.

- **`apps/server/src/machines/registry.ts` — on `effect/sql`.** Same exports and signatures.
  A private `runSql(db, effect)` helper calls `sqlRuntimeFor(db).runPromise(effect)`, resolved
  at call time inside each async method, never in `createDbMachineRegistry`.
  `getApprovedPublicKey` runs
  `SELECT public_key FROM machines WHERE id = $1 AND status = 'approved' LIMIT 1`;
  `touchLastSeen` runs `UPDATE machines SET last_seen_at = $1 WHERE id = $2`. The `at` Date is
  bound as `at.toISOString()` (the tested pattern from `blocks/service.ts`), so the stored
  timestamptz and the `registry.test.ts` `toEqual(at)` assertion are unchanged. The four
  listener methods are untouched. No `drizzle-orm` import remains.
- **`apps/server/src/test-support.ts` — runtime wiring.** `createTestContext` now calls
  `registerSqlRuntime(db, '')` right after `drizzle(client, { schema })` (the URL is unused
  for a PGlite handle; `createApp` registering again is a no-op). `close()` is now
  `await disposeSqlRuntime(db)` before `await client.close()`, so the runtime is disposed
  before the client it wraps.

### Files changed (3, all inside the re-scoped Allowed files)

- `apps/server/src/machines/registry.ts`
- `apps/server/src/test-support.ts`
- `work/T-0535-effect-sql-connections-machines-registry.md`

One commit per item: the registry change, then the test-support change; this final commit
carries the task file.

### Commands and real results

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/machines/registry.test.ts`
  — 1 file, 5 passed (per-file check while working).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot machines connections ais pins blocks contact-requests`
  — 15 files passed, 2 skipped; 228 tests passed, 3 skipped. Exit 0.
- `pnpm gate` (repo root) — summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (41.6s)
  PASS  lint  (2.2s)
  PASS  typecheck  (28.2s)
  PASS  tests @zilar/server  (451.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations and notes

- `touchLastSeen` binds `at.toISOString()` rather than the `Date` object, matching the
  tested pattern in `blocks/service.ts`; the column stays `timestamptz` and the test's
  `toEqual(at)` passes.
- Registering the runtime in `createTestContext` does not change
  `apps/server/src/effect/sql-runtime.test.ts`: the first test still finds the runtime after
  `testApp`, and the second still sees `dispose` forget it (the extra `disposeSqlRuntime`
  inside `close()` is a no-op the second time). The gate's full server run confirms it.

### Blocked / needs a decision

None.

## Review (written by Claude)

Approved (lead, 2026-10-08) after the lead re-scope. machines/registry.ts runs on effect/sql, resolving the runtime at call time, so the index.ts ordering is safe. createTestContext registers the effect/sql runtime and disposes it on close, so service tests without an app work. connections/service.ts stays on drizzle until ais/service.ts moves its transactions. Pre-review clean, 0 nits.
