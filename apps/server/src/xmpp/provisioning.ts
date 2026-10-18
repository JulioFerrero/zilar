import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { XmppAccountRow } from '../db/rows';
import { runSql } from '../effect/sql';
import type { EjabberdAdminClient } from './admin/types';

// XMPP localparts must be `[a-z0-9._-]`. The user id lowercased fits normally;
// anything else falls back to a derived one.
const SAFE_LOCALPART = /^[a-z0-9._-]{1,64}$/;
const HASH_CHARS = 20;

export type XmppAccountStatus = {
  jid: string;
  provisioned: boolean;
};

// Better Auth's ids are random alphanumeric, so lowercasing is enough. An id that
// is still invalid falls back to `u` plus 20 base32 characters of its sha256,
// which is stable and collision-resistant.
export function localpartFor(userId: string): string {
  const lowered = userId.toLowerCase();
  if (SAFE_LOCALPART.test(lowered)) {
    return lowered;
  }
  return `u${sha256Base32(userId).slice(0, HASH_CHARS)}`;
}

export function jidFor(localpart: string, domain: string): string {
  return `${localpart}@${domain}`;
}

// The row is upserted first, so the mapping exists even when ejabberd is down
// (`provisioned = false`). `registerUser` is idempotent and `ON CONFLICT` makes
// concurrent calls safe.
export async function ensureXmppAccount(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  userId: string,
  domain: string,
  options: { requesterId?: string } = {},
): Promise<XmppAccountStatus> {
  const localpart = localpartFor(userId);
  const jid = jidFor(localpart, domain);

  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO xmpp_accounts (user_id, localpart, jid, provisioned)
        VALUES (${userId}, ${localpart}, ${jid}, false)
        ON CONFLICT (user_id) DO UPDATE SET
          localpart = excluded.localpart,
          jid = excluded.jid,
          updated_at = ${new Date().toISOString()}`;
    }),
  );

  try {
    await adminClient.registerUser(localpart);
  } catch (error) {
    if (options.requesterId !== undefined) {
      const row = await findXmppAccount(db, userId);
      return { jid: row?.jid ?? jid, provisioned: row?.provisioned ?? false };
    }
    throw error;
  }

  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<XmppAccountRow>`UPDATE xmpp_accounts
        SET provisioned = true, updated_at = ${new Date().toISOString()}
        WHERE user_id = ${userId}
        RETURNING *`;
    }),
  );

  return { jid: row?.jid ?? jid, provisioned: row?.provisioned ?? true };
}

export async function findXmppAccount(
  db: ServerDatabase,
  userId: string,
): Promise<XmppAccountRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<XmppAccountRow>`SELECT * FROM xmpp_accounts
        WHERE user_id = ${userId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

function sha256Base32(value: string): string {
  return base32(createHash('sha256').update(value, 'utf8').digest());
}

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

// RFC 4648 base32, lowercase.
function base32(bytes: Buffer): string {
  let bits = 0;
  let accumulator = 0;
  let output = '';
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(accumulator >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  }
  return output;
}
