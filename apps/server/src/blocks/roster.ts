// A removed pair must lose both `both` roster subscriptions, or the two people keep
// seeing each other online and reach each other over XMPP. Best effort: a failure is a
// `warn` with ids only, never a throw, so the removal itself succeeds.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';

export interface RosterLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface RemovePairRosterInput {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger?: RosterLogger | undefined;
  userId: string;
  targetId: string;
}

// The stored account row wins, otherwise the derived JID (provisioned at sign-in).
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

// Removes both roster items. A failure (lookup, ejabberd down, item gone) logs a warn
// and never throws; on a lookup failure the derived JIDs are still attempted.
export async function removePairRosterItems(input: RemovePairRosterInput): Promise<void> {
  const { db, adminClient, domain, logger, userId, targetId } = input;
  let userJid: string;
  let targetJid: string;
  try {
    [userJid, targetJid] = await Promise.all([
      rosterJidFor(db, userId, domain),
      rosterJidFor(db, targetId, domain),
    ]);
  } catch (error) {
    logger?.warn({ err: error, userId, targetId }, 'could not resolve roster JIDs for the pair');
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
      logger?.warn({ err: error, userId, targetId }, 'could not remove a roster item for the pair');
    }
  }
}

export const removeBlockRosterItems = removePairRosterItems;
