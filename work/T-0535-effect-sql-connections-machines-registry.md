---
id: T-0535
title: "Effect C1: connections/service.ts and machines/registry.ts on effect/sql (same queries, same answers, keys stay encrypted at rest); signatures unchanged, every test unchanged"
status: todo
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
`apps/server/src/connections/service.ts`, `apps/server/src/machines/registry.ts`, `work/T-0535-effect-sql-connections-machines-registry.md`.

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

## Review (written by Claude)
