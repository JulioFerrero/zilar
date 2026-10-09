import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { sqlRuntimeFor } from '../effect/sql';
import type { KeyCipher } from './crypto';
import type { ProviderId } from './providers';

export interface ConnectionRow {
  id: string;
  owner: string;
  provider: string;
  encryptedKey: string;
  label: string | null;
  status: 'active' | 'revoked';
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicConnection {
  id: string;
  provider: ProviderId;
  label: string | null;
  status: 'active' | 'revoked';
  createdAt: Date;
}

export interface CreateConnectionInput {
  owner: string;
  provider: ProviderId;
  encryptedKey: string;
  label: string | null;
}

// Every query runs on the `effect/sql` client registered for this database
// (see `../effect/sql`). The exported functions stay `async` so routes and
// tests keep their shape during the transition.
function runSql<A, E>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError | E, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

// `provider` is a validated ProviderId on every write, so the cast is safe. The
// plaintext key is never part of this shape: callers that need it go through
// `decryptForGatewayUse`.
function toPublicConnection(row: ConnectionRow): PublicConnection {
  return {
    id: row.id,
    provider: row.provider as ProviderId,
    label: row.label,
    status: row.status,
    createdAt: row.createdAt,
  };
}

export async function listConnections(
  db: ServerDatabase,
  owner: string,
): Promise<PublicConnection[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ConnectionRow>`SELECT * FROM provider_connections
        WHERE owner = ${owner}
        ORDER BY created_at ASC`;
    }),
  );
  return rows.map(toPublicConnection);
}

export async function createConnection(
  db: ServerDatabase,
  input: CreateConnectionInput,
): Promise<PublicConnection> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ConnectionRow>`INSERT INTO provider_connections
        (id, owner, provider, encrypted_key, label)
        VALUES (${randomUUID()}, ${input.owner}, ${input.provider}, ${input.encryptedKey}, ${input.label})
        RETURNING *`;
    }),
  );
  if (!row) {
    throw new Error('Failed to create connection');
  }
  return toPublicConnection(row);
}

// Looks up one connection owned by `owner`. Returns null for a missing id and
// for an id owned by someone else alike, so existence is never leaked.
export async function findOwnedConnection(
  db: ServerDatabase,
  id: string,
  owner: string,
): Promise<ConnectionRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ConnectionRow>`SELECT * FROM provider_connections
        WHERE id = ${id} AND owner = ${owner}
        LIMIT 1`;
    }),
  );
  return row ?? null;
}

export async function deleteConnection(
  db: ServerDatabase,
  id: string,
  owner: string,
): Promise<boolean> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`DELETE FROM provider_connections
        WHERE id = ${id} AND owner = ${owner}
        RETURNING id`;
    }),
  );
  return row !== undefined;
}

// How many AIs still use a connection. The `ais.provider_connection_id` foreign
// key is RESTRICT, so the delete route turns "in use" into a clean 409 before
// the database can refuse the delete. The result is a bare count: the route
// never lists the AIs.
export async function countAisUsingConnection(
  db: ServerDatabase,
  connectionId: string,
): Promise<number> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM ais
        WHERE provider_connection_id = ${connectionId}`;
    }),
  );
  return Number(row?.total ?? 0);
}

// The seam for the LLM gateway: decrypts a stored key in memory for the one
// request that needs it. This is the only place outside `crypto` that the
// plaintext exists, and it never crosses a route or a response. M2 wires this
// into the gateway's request path; nothing calls it yet.
export function decryptForGatewayUseEffect(
  cipher: KeyCipher,
  connectionId: string,
): Effect.Effect<string, SqlError.SqlError | Error, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ encryptedKey: string }>`SELECT encrypted_key
      FROM provider_connections WHERE id = ${connectionId} LIMIT 1`;
    if (!row) {
      return yield* Effect.fail(new Error('Connection not found'));
    }
    return yield* Effect.try({
      try: () => cipher.decrypt(row.encryptedKey),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    });
  });
}

// Promise wrapper kept for callers that are still plain `async` (routes and
// `createAi`); the model transactions use `decryptForGatewayUseEffect` directly
// so the read rides the transaction's connection.
export async function decryptForGatewayUse(
  db: ServerDatabase,
  cipher: KeyCipher,
  connectionId: string,
): Promise<string> {
  return runSql(db, decryptForGatewayUseEffect(cipher, connectionId));
}
