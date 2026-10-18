import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { ProviderConnectionRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { KeyCipher } from './crypto';
import type { ProviderId } from './providers';

export type ConnectionRow = ProviderConnectionRow;

// The create route answers 409 `limit_reached` at this cap.
export const CONNECTIONS_MAX_PER_USER = 50;

export interface PublicConnection {
  id: string;
  provider: ProviderId;
  label: string | null;
  baseUrl: string | null;
  status: 'active' | 'revoked';
  createdAt: Date;
}

export interface CreateConnectionInput {
  owner: string;
  provider: ProviderId;
  encryptedKey: string;
  label: string | null;
  baseUrl: string | null;
}

// `provider` is a validated ProviderId on every write, so the cast is safe. The
// plaintext key never enters this shape; callers that need it use the gateway
// seam below.
function toPublicConnection(row: ConnectionRow): PublicConnection {
  return {
    id: row.id,
    provider: row.provider as ProviderId,
    label: row.label,
    baseUrl: row.baseUrl,
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
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          // The count and insert share one transaction under a per-owner advisory
          // lock: two concurrent creates at the cap would otherwise both insert.
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'connections:' + input.owner}))`;
          const [counter] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
            FROM provider_connections
            WHERE owner = ${input.owner} AND status = 'active'`;
          if (Number(counter?.total ?? 0) >= CONNECTIONS_MAX_PER_USER) {
            return yield* Effect.fail(
              new HttpError(
                409,
                'limit_reached',
                'You have too many saved keys. Remove one first.',
              ),
            );
          }
          return yield* sql<ConnectionRow>`INSERT INTO provider_connections
            (id, owner, provider, encrypted_key, label, base_url)
            VALUES (${randomUUID()}, ${input.owner}, ${input.provider}, ${input.encryptedKey}, ${input.label}, ${input.baseUrl})
            RETURNING *`;
        }),
      );
    }),
  );
  if (!row) {
    throw new Error('Failed to create connection');
  }
  return toPublicConnection(row);
}

export interface UpdateConnectionKeyInput {
  id: string;
  owner: string;
  encryptedKey: string;
}

// Owner-scoped, so another user's row is untouched and the caller sees null (the
// route answers 404). The plaintext key never enters this shape.
export async function updateConnectionKey(
  db: ServerDatabase,
  input: UpdateConnectionKeyInput,
): Promise<PublicConnection | null> {
  const row = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const [updated] = yield* sql<ConnectionRow>`UPDATE provider_connections
            SET encrypted_key = ${input.encryptedKey}, updated_at = now()
            WHERE id = ${input.id} AND owner = ${input.owner}
            RETURNING *`;
          if (!updated) {
            return undefined;
          }
          return updated;
        }),
      );
    }),
  );
  return row === undefined ? null : toPublicConnection(row);
}

// A missing id and a foreign one both answer null, so existence is never leaked.
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

// The FK is RESTRICT, so the route turns "in use" into a clean 409 before the
// database refuses. The result is a bare count; the route never lists the AIs.
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

// The gateway seam: decrypts a key in memory for one request. Outside `crypto`
// this is the only place the plaintext exists, and it never crosses a route or
// a response.
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

// Model transactions use the Effect directly so the read rides theirs.
export async function decryptForGatewayUse(
  db: ServerDatabase,
  cipher: KeyCipher,
  connectionId: string,
): Promise<string> {
  return runSql(db, decryptForGatewayUseEffect(cipher, connectionId));
}
