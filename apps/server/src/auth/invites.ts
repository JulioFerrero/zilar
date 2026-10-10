// T-0574: every query runs on the `effect/sql` client registered for this
// database (see `../effect/sql`). The exported functions stay `async` so
// callers and tests keep their shape.

import { randomBytes, randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { InviteRow } from '../db/rows';
import { runSql } from '../effect/sql';

export const INVITE_CODE_BYTES = 16;
export const DEFAULT_INVITE_MAX_USES = 1;
export const DEFAULT_INVITE_TTL_DAYS = 7;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type Invite = InviteRow;

export interface CreateInviteOptions {
  createdBy?: string | null;
  maxUses?: number;
  expiresInDays?: number;
}

export function generateInviteCode(): string {
  return randomBytes(INVITE_CODE_BYTES).toString('base64url');
}

export async function createInvite(
  db: ServerDatabase,
  options: CreateInviteOptions = {},
): Promise<Invite> {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (options.expiresInDays ?? DEFAULT_INVITE_TTL_DAYS) * DAY_IN_MS,
  );
  const id = randomUUID();
  const code = generateInviteCode();

  const [invite] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<Invite>`INSERT INTO invites (
          id, code, created_by, created_at, expires_at, max_uses, uses
        ) VALUES (
          ${id}, ${code}, ${options.createdBy ?? null}, ${now}, ${expiresAt},
          ${options.maxUses ?? DEFAULT_INVITE_MAX_USES}, 0
        )
        RETURNING *`;
    }),
  );

  if (!invite) {
    throw new Error('Failed to create invite');
  }
  return invite;
}

export async function findInviteByCode(db: ServerDatabase, code: string): Promise<Invite | null> {
  const [invite] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<Invite>`SELECT * FROM invites WHERE code = ${code} LIMIT 1`;
    }),
  );
  return invite ?? null;
}

export async function findUsableInvite(
  db: ServerDatabase,
  code: string,
  now: Date = new Date(),
): Promise<Invite | null> {
  const [invite] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<Invite>`SELECT * FROM invites
        WHERE code = ${code} AND revoked_at IS NULL AND expires_at > ${now} AND uses < max_uses
        LIMIT 1`;
    }),
  );
  return invite ?? null;
}

export async function consumeInvite(
  db: ServerDatabase,
  code: string,
  now: Date = new Date(),
): Promise<Invite | null> {
  // One conditional statement, so two concurrent consumes cannot both win.
  const [invite] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<Invite>`UPDATE invites SET uses = uses + 1
        WHERE code = ${code} AND revoked_at IS NULL AND expires_at > ${now} AND uses < max_uses
        RETURNING *`;
    }),
  );
  return invite ?? null;
}

export async function revokeInvite(
  db: ServerDatabase,
  code: string,
  now: Date = new Date(),
): Promise<Invite | null> {
  const [invite] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<Invite>`UPDATE invites SET revoked_at = ${now}
        WHERE code = ${code} AND revoked_at IS NULL
        RETURNING *`;
    }),
  );
  return invite ?? null;
}
