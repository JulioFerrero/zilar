import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import postgres from 'postgres';
import type { ServerConfig } from '../config/load';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { UNNAMED_CONTACT_NAME } from '../contacts/service';
import { localpartFor } from '../xmpp/provisioning';
import { visibleTopicsForGroups } from '../topics/visible-batch';
import { listGroupsForUser } from '../groups/service';

// A read-only pool to the ejabberd MAM archive, separate from the app pool; a 3 s
// statement timeout keeps a search from holding the database.
export interface ArchivePool {
  query: (text: string, values: unknown[]) => Promise<ArchiveRow[]>;
  close: () => Promise<void>;
}

export interface ArchiveRow {
  owner: string;
  peer: string;
  barePeer: string;
  kind: string;
  nick: string;
  originId: string;
  timestamp: number | string | bigint;
  headline: string;
  xml: string;
  body?: string | null;
}

export const ARCHIVE_POOL_MAX = 3;
export const ARCHIVE_STATEMENT_TIMEOUT_MS = 3000;

export function createArchivePool(databaseUrl: string): ArchivePool {
  const sql = postgres(databaseUrl, {
    max: ARCHIVE_POOL_MAX,
    connection: { statement_timeout: ARCHIVE_STATEMENT_TIMEOUT_MS },
  });
  return {
    query: async (text, values) => (await sql.unsafe(text, values as never[])) as ArchiveRow[],
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}

export interface SearchOwner {
  ownLocalpart: string;
  dmPeers: string[];
  rooms: string[];
  peerNames: Map<string, string>;
}

interface ContactArchiveRow {
  contactUserId: string;
  name: string;
  jid: string | null;
}

interface AiArchiveRow {
  name: string;
  jid: string;
}

// Every archive the caller may read, from our tables only. A DM is always read
// under the caller's own `username` with a `bare_peer` filter, never under the
// peer's `username`, which would expose the peer's other conversations.
export async function allowedArchives(
  db: ServerDatabase,
  config: ServerConfig,
  userId: string,
): Promise<SearchOwner> {
  const domain = config.xmpp.domain;
  const mucDomain = config.xmpp.mucDomain;
  const ownLocalpart = localpartFor(userId);

  const [contactRows, aiRows, groups] = await Promise.all([
    runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // Belt and braces: a stale contact row must still lose its archive on
        // either side, so push and search never deliver a blocked peer's DMs.
        return yield* sql<ContactArchiveRow>`SELECT c.contact_user_id, u.name, x.jid
          FROM contacts c
          INNER JOIN "user" u ON u.id = c.contact_user_id
          LEFT JOIN xmpp_accounts x ON x.user_id = c.contact_user_id
          WHERE c.user_id = ${userId}
            AND NOT EXISTS (SELECT 1 FROM user_blocks b
              WHERE (b.user_id = ${userId} AND b.blocked_user_id = c.contact_user_id)
                 OR (b.user_id = c.contact_user_id AND b.blocked_user_id = ${userId}))`;
      }),
    ),
    runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<AiArchiveRow>`SELECT name, jid FROM ais WHERE owner = ${userId}`;
      }),
    ),
    listGroupsForUser(db, userId),
  ]);

  const dmPeers: string[] = [];
  const peerNames = new Map<string, string>();
  for (const row of contactRows) {
    const jid = row.jid ?? `${localpartFor(row.contactUserId)}@${domain}`;
    dmPeers.push(jid);
    peerNames.set(jid, row.name.trim() === '' ? UNNAMED_CONTACT_NAME : row.name);
  }
  for (const ai of aiRows) {
    dmPeers.push(ai.jid);
    peerNames.set(ai.jid, ai.name);
  }

  // One batched visibility pass, the same helper `/api/chats` uses: each group's
  // General room first, then its visible topics.
  const visibleByGroup = await visibleTopicsForGroups(
    db,
    groups.map((group) => group.id),
    userId,
  );
  const rooms: string[] = [];
  for (const group of groups) {
    rooms.push(`${group.roomLocalpart}@${mucDomain}`);
    for (const topic of visibleByGroup.get(group.id) ?? []) {
      rooms.push(`${topic.roomLocalpart}@${mucDomain}`);
    }
  }

  return { ownLocalpart, dmPeers, rooms, peerNames };
}

// A DM peer or room JID, or null when the chat is outside the allowed set (404).
export function resolveChatFilter(
  allowed: SearchOwner,
  chat: string,
): { kind: 'dm'; peer: string } | { kind: 'room'; room: string } | null {
  const normalized = chat.trim().toLowerCase();
  const peer = allowed.dmPeers.find((jid) => jid.toLowerCase() === normalized);
  if (peer !== undefined) {
    return { kind: 'dm', peer };
  }
  const room = allowed.rooms.find((jid) => jid.toLowerCase() === normalized);
  if (room !== undefined) {
    return { kind: 'room', room };
  }
  return null;
}
