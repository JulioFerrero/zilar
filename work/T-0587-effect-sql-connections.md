---
id: T-0587
title: "effect/sql: connections/service.ts list/create/findOwned/delete/countAisUsing move to effect/sql; decryptForGatewayUse stays on drizzle (called with a drizzle transaction from ais/service.ts); same results; tests unchanged"
status: merged
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

Moved five of the six connection queries in `apps/server/src/connections/service.ts`
to effect/sql with identical results; `decryptForGatewayUse` stays on drizzle with
the one-line comment that it moves together with the `ais/service.ts` transactions.
No test file touched.

What changed (`apps/server/src/connections/service.ts` only):
- Explicit exported `ConnectionRow` interface (8 camelCase columns: `id`, `owner`,
  `provider`, `encryptedKey`, `label: string | null`, `status: 'active' | 'revoked'`,
  `createdAt`/`updatedAt: Date`), replacing `typeof providerConnections.$inferSelect`.
- Local `runSql(db, effect) = sqlRuntimeFor(db).runPromise(effect)`, as in
  `agents/gateway/db.ts`. `SELECT *`/`RETURNING *` come back camelCased via
  `transformResultNames`; `timestamptz` comes back as `Date`.
- `listConnections`: `SELECT * ... WHERE owner ORDER BY created_at ASC`.
- `createConnection`: `INSERT (id = randomUUID(), owner, provider, encrypted_key,
  label) RETURNING *`; still throws `'Failed to create connection'` when no row.
- `findOwnedConnection`: `SELECT * ... WHERE id AND owner LIMIT 1`, null when absent.
- `deleteConnection`: `DELETE ... WHERE id AND owner RETURNING id`, boolean.
- `countAisUsingConnection`: `SELECT count(*)::int AS total ...`, `Number(row?.total ?? 0)`.
- `decryptForGatewayUse` unchanged on drizzle (keeps `drizzle-orm` + `providerConnections`
  imports) plus the transaction comment.

Callers checked: `connections/api.ts` reads `.id`, `.status`, `.provider`, `.encryptedKey`
(all on the new interface); `ais/service.ts` reads the same plus passes a drizzle `txDb`
to `decryptForGatewayUse` (unchanged signature). Runtimes are registered per top-level
db by `createApp`/`createTestContext`, so no new registration.

Checks:
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot connections ais`:
  7 passed test files, 2 skipped; 127 passed tests, 3 skipped; 0 failed.
- `pnpm gate`: PASS install (1.9s), PASS format (37.3s), PASS lint (1.9s),
  PASS typecheck (20.4s), PASS tests @zilar/server (541.1s);
  scope: every changed file is inside the Allowed files; GATE PASS.
  (2 changed files against main: the service + this task file.)

Security checklist: deletes stay owner-scoped (`WHERE id AND owner`); missing vs
foreign ids both answer null/404; plaintext key still only in `decryptForGatewayUse`,
never logged; no new routes, caps, or audit entries.

No deviations, no open questions.

status: review

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 1 nit. The packet (11:51) is newer than HEAD 74a8f0e7.
- **No test file changed.**
- **Lead check:**
  - the five queries run on effect/sql; `SELECT *` gives camelCase keys through the registered `snakeToCamel` transform;
  - the explicit `ConnectionRow` lists all 8 columns;
  - the decrypt called inside a transaction stays on drizzle, with the comment.
