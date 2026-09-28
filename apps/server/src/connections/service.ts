import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { ServerDatabase } from '../db/client';
import { providerConnections } from '../db/schema';
import type { KeyCipher } from './crypto';
import type { ProviderId } from './providers';

type ConnectionRow = typeof providerConnections.$inferSelect;

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
  const rows = await db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.owner, owner))
    .orderBy(asc(providerConnections.createdAt));
  return rows.map(toPublicConnection);
}

export async function createConnection(
  db: ServerDatabase,
  input: CreateConnectionInput,
): Promise<PublicConnection> {
  const [row] = await db
    .insert(providerConnections)
    .values({
      id: randomUUID(),
      owner: input.owner,
      provider: input.provider,
      encryptedKey: input.encryptedKey,
      label: input.label,
    })
    .returning();
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
  const [row] = await db
    .select()
    .from(providerConnections)
    .where(and(eq(providerConnections.id, id), eq(providerConnections.owner, owner)))
    .limit(1);
  return row ?? null;
}

export async function deleteConnection(
  db: ServerDatabase,
  id: string,
  owner: string,
): Promise<boolean> {
  const [row] = await db
    .delete(providerConnections)
    .where(and(eq(providerConnections.id, id), eq(providerConnections.owner, owner)))
    .returning();
  return row !== undefined;
}

// The seam for the LLM gateway: decrypts a stored key in memory for the one
// request that needs it. This is the only place outside `crypto` that the
// plaintext exists, and it never crosses a route or a response. M2 wires this
// into the gateway's request path; nothing calls it yet.
export async function decryptForGatewayUse(
  db: ServerDatabase,
  cipher: KeyCipher,
  connectionId: string,
): Promise<string> {
  const [row] = await db
    .select({ encryptedKey: providerConnections.encryptedKey })
    .from(providerConnections)
    .where(eq(providerConnections.id, connectionId))
    .limit(1);
  if (!row) {
    throw new Error('Connection not found');
  }
  return cipher.decrypt(row.encryptedKey);
}
