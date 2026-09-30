import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { ais, contacts, user, xmppAccounts } from '../db/schema';
import { UNNAMED_CONTACT_NAME } from '../contacts/service';
import { localpartFor } from '../xmpp/provisioning';
import { visibleTopics } from '../topics/access';
import { listGroupsForUser } from '../groups/service';

// A read-only connection to the ejabberd MAM archive. The pool is separate
// from the app pool, small, and every connection carries a 3 s statement
// timeout so a search can never hold the database.
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
  /** The caller's archive `username`: their XMPP localpart. */
  ownLocalpart: string;
  /** Bare JIDs of DM peers the caller may search (contacts + own active AIs). */
  dmPeers: string[];
  /** Room bare JIDs (General + visible topics) the caller may search. */
  rooms: string[];
  /** Display name per DM peer bare JID (never an e-mail). */
  peerNames: Map<string, string>;
}

// Every archive the caller may read, computed from our tables only. T-0116
// (role access) is not merged: when it lands, its holders widen the room set
// here. DMs are always read under the caller's own `username` with a
// `bare_peer` filter — never under the peer's `username`, which would expose
// the peer's other conversations.
export async function allowedArchives(
  db: ServerDatabase,
  config: ServerConfig,
  userId: string,
): Promise<SearchOwner> {
  const domain = config.xmpp.domain;
  const mucDomain = config.xmpp.mucDomain;
  const ownLocalpart = localpartFor(userId);

  const [contactRows, aiRows, groups] = await Promise.all([
    db
      .select({
        contactUserId: contacts.contactUserId,
        name: user.name,
        jid: xmppAccounts.jid,
      })
      .from(contacts)
      .innerJoin(user, eq(user.id, contacts.contactUserId))
      .leftJoin(xmppAccounts, eq(xmppAccounts.userId, contacts.contactUserId))
      .where(eq(contacts.userId, userId)),
    db.select({ name: ais.name, jid: ais.jid }).from(ais).where(eq(ais.owner, userId)),
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

  const rooms: string[] = [];
  for (const group of groups) {
    rooms.push(`${group.roomLocalpart}@${mucDomain}`);
    const rows = await visibleTopics(db, group.id, userId);
    for (const topic of rows) {
      rooms.push(`${topic.roomLocalpart}@${mucDomain}`);
    }
  }

  return { ownLocalpart, dmPeers, rooms, peerNames };
}

// The client addresses one chat by JID: a DM peer's bare JID or a room JID.
// Returns which branch to constrain, or null when the chat is outside the
// caller's allowed set (the route answers 404).
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
