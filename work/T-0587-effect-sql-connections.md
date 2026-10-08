---
id: T-0587
title: "effect/sql: connections/service.ts list/create/findOwned/delete/countAisUsing move to effect/sql; decryptForGatewayUse stays on drizzle (called with a drizzle transaction from ais/service.ts); same results; tests unchanged"
status: todo
milestone: M5
branch: task/T-0587-effect-sql-connections
model: auto
effort: low
depends_on: [T-0584]
estimate: 0.5 day
---

# T-0587: the provider-connection queries on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. `apps/server/src/connections/service.ts` (130 lines) has six small queries, and five of them always get the top-level `db`.

### Verified facts (do not re-derive)
**The functions** (each `(db: ServerDatabase, ...)`):
- **`listConnections(db, owner)`** (37): `SELECT * FROM provider_connections WHERE owner = $1 ORDER BY created_at ASC`, mapped by `toPublicConnection`.
- **`createConnection(db, input)`** (50): `INSERT ... (id = randomUUID(), owner, provider, encrypted_key, label) RETURNING *`. `status`, `created_at` and `updated_at` come from the column defaults. If no row comes back, it throws `'Failed to create connection'`.
- **`findOwnedConnection(db, id, owner)`** (72): `SELECT * ... WHERE id = $1 AND owner = $2 LIMIT 1`, returning the row or `null`. Its return type is `ConnectionRow` (`typeof providerConnections.$inferSelect`, 8). The callers (`connections/api.ts:235,296` and `ais/service.ts:223,932`) read `.id`, `.status` and `.provider`, so replace it with an explicit exported `ConnectionRow` interface listing all 8 columns, camelCase:
  - `id`, `owner`, `provider`;
  - `encryptedKey`;
  - `label` (`string | null`);
  - `status` (`'active' | 'revoked'`);
  - `createdAt` and `updatedAt` (`Date`).
- **`deleteConnection(db, id, owner)`** (85): `DELETE ... WHERE id AND owner RETURNING id`, giving `boolean`.
- **`countAisUsingConnection(db, connectionId)`** (100): `SELECT count(*) FROM ais WHERE provider_connection_id = $1`, giving `Number(...)`. Postgres count is bigint, so cast it with `::int` or keep `Number(...)`.
- **`decryptForGatewayUse(db, cipher, connectionId)`** (113) **stays on drizzle**:
  - `ais/service.ts:879` and `975` call it with `txDb`, a drizzle transaction inside an advisory lock, and an effect/sql runtime is registered per top-level db, not per drizzle transaction;
  - add a one-line comment saying it moves together with the `ais/service.ts` transactions.
  
  It is the only function that keeps `drizzle-orm` and `providerConnections` imports.
- **The sql runtime:** a local `runSql(db, effect) = sqlRuntimeFor(db).runPromise(effect)`, as in `apps/server/src/agents/gateway/db.ts`. `timestamptz` comes back as `Date`. Alias the columns (`encrypted_key AS "encryptedKey"` and so on).
- **Tests (all unchanged):**
  - `apps/server/src/connections/*.test.ts`;
  - `apps/server/src/ais/*.test.ts`.

### What to build
1. Move the five functions to effect/sql with the same results, nulls and throws, and export the explicit `ConnectionRow`.
2. Leave `decryptForGatewayUse` as is, plus the comment.
3. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/connections/service.ts`, `apps/server/src/agents/gateway/db.ts` and `apps/server/src/ais/service.ts` (lines 215-230, 870-880 and 925-980).

### Allowed files
`apps/server/src/connections/service.ts`, `work/T-0587-effect-sql-connections.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot connections ais
pnpm gate
```

### Acceptance
- Five of the six connection queries run on effect/sql with the same results; the transaction-bound decrypt stays on drizzle with the comment.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
