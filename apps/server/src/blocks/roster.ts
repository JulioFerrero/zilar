// Roster cleanup after a block (T-1158, SG-1): a block deletes the contact
// pair, and the pair's `both` roster subscriptions must go with it, or the
// blocked person keeps seeing the blocker online. Best effort: every failure
// is a `warn`, never a throw, so a block always succeeds.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';

// The smallest slice of a logger this helper needs; the API layer passes its
// own logger, tests pass nothing.
export interface BlockRosterLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface RemoveBlockRosterInput {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger?: BlockRosterLogger | undefined;
  userId: string;
  targetId: string;
}

// The JID ejabberd knows: the stored account row wins, otherwise the derived
// one (an account is provisioned at sign-in; see `ensureXmppAccount`).
async function rosterJidFor(db: ServerDatabase, userId: string, domain: string): Promise<string> {
  const [account] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ jid: string }>`SELECT jid FROM xmpp_accounts
        WHERE user_id = ${userId} LIMIT 1`;
    }),
  );
  return account?.jid ?? jidFor(localpartFor(userId), domain);
}

// Removes both roster items of a blocked pair, one per direction. A failure
// (DB hiccup on the JID lookups, ejabberd down, item already gone) logs a
// `warn` with ids only and never throws, so the block itself always succeeds.
// On a lookup failure the derived JIDs are used, so removal is still
// attempted best effort.
export async function removeBlockRosterItems(input: RemoveBlockRosterInput): Promise<void> {
  const { db, adminClient, domain, logger, userId, targetId } = input;
  let userJid: string;
  let targetJid: string;
  try {
    [userJid, targetJid] = await Promise.all([
      rosterJidFor(db, userId, domain),
      rosterJidFor(db, targetId, domain),
    ]);
  } catch (error) {
    logger?.warn({ err: error, userId, targetId }, 'could not resolve roster JIDs after block');
    userJid = jidFor(localpartFor(userId), domain);
    targetJid = jidFor(localpartFor(targetId), domain);
  }
  const removals: Array<[string, string]> = [
    [localpartFor(userId), targetJid],
    [localpartFor(targetId), userJid],
  ];
  for (const [localpart, contactJid] of removals) {
    try {
      await adminClient.deleteRosterItem(localpart, contactJid);
    } catch (error) {
      logger?.warn({ err: error, userId, targetId }, 'could not remove a roster item after block');
    }
  }
}
