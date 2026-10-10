import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { GroupRow } from '../db/rows';
import { runSql } from '../effect/sql';
import type { SearchOwner } from '../search/service';
import { bareJid, ownBareJid } from '../jid';
import { stanzaFrom } from '../search/routes';
import { canSeeTopic, type TopicRow } from '../topics/access';
import { localpartFor } from '../xmpp/provisioning';
import type { ArchiveCandidate } from './archive-scan';
import type { ResolvedPushMessage } from './payload';
import type { PushServiceDeps } from './service';

type CandidateVerdict =
  { status: 'ok'; message: ResolvedPushMessage } | { status: 'muted' | 'hidden' | 'skip' };

export async function resolveCandidate(
  deps: PushServiceDeps,
  userId: string,
  allowed: SearchOwner,
  row: ArchiveCandidate,
): Promise<CandidateVerdict> {
  if (row.originId === '') {
    return { status: 'skip' };
  }
  // A retraction archives with the stock fallback sentence as its text:
  // never notify for one.
  if (row.xml.includes('urn:xmpp:message-retract:1')) {
    return { status: 'skip' };
  }
  const text = row.text === null || row.text === '' ? undefined : row.text;
  if (text === undefined && row.xml.includes('urn:xmpp:reactions:0')) {
    return { status: 'skip' };
  }
  if (row.kind === 'groupchat') {
    return resolveRoomCandidate(deps, userId, row, text);
  }
  return resolveDmCandidate(deps, userId, allowed, row, text);
}

async function resolveRoomCandidate(
  deps: PushServiceDeps,
  userId: string,
  row: ArchiveCandidate,
  text: string | undefined,
): Promise<CandidateVerdict> {
  const roomJid = row.owner.toLowerCase();
  const localpart = row.owner.split('@')[0] ?? '';
  const [topic] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics
        WHERE room_localpart = ${localpart} LIMIT 1`;
    }),
  );
  if (topic === undefined) {
    return { status: 'skip' };
  }
  // Send-time visibility re-check: a private topic's name only ever goes to
  // a user who can see that topic right now, and a muted chat sends nothing
  // (a topic falls back to its group's General mute, like the clients).
  if (!(await canSeeTopic(deps.db, topic, userId))) {
    return { status: 'hidden' };
  }
  const [group] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRow>`SELECT * FROM groups
        WHERE id = ${topic.groupId} LIMIT 1`;
    }),
  );
  if (group === undefined) {
    return { status: 'skip' };
  }
  // The user's own room messages share the same archive scope (sent from
  // another session while this device is offline); only other members'
  // messages notify. The nick is the stable account localpart — the same
  // value `syncPushSubscriptionsForUser` subscribes with — never compared
  // against a display name.
  if (row.nick !== '' && row.nick === localpartFor(userId)) {
    return { status: 'skip' };
  }
  const now = (deps.now ?? (() => new Date()))();
  if (await isMuted(deps, userId, roomJid, topicRoomGeneralJid(deps, group.roomLocalpart), now)) {
    return { status: 'muted' };
  }
  const place = topic.isGeneral ? group.title : `${group.title} › ${topic.name}`;
  return {
    status: 'ok',
    message: {
      chatJid: roomJid,
      senderName: row.nick === '' ? 'Someone' : row.nick,
      place,
      text,
      messageId: row.originId,
    },
  };
}

async function resolveDmCandidate(
  deps: PushServiceDeps,
  userId: string,
  allowed: SearchOwner,
  row: ArchiveCandidate,
  text: string | undefined,
): Promise<CandidateVerdict> {
  const peer = row.barePeer.toLowerCase();
  // The caller's own outgoing messages share the same archive scope; only
  // incoming ones notify.
  const from = stanzaFrom(row.xml);
  if (from !== null && bareJid(from) === ownBareJid(allowed, deps.config.xmpp.domain)) {
    return { status: 'skip' };
  }
  const now = (deps.now ?? (() => new Date()))();
  if (await isMuted(deps, userId, peer, undefined, now)) {
    return { status: 'muted' };
  }
  const senderName =
    allowed.peerNames.get(row.barePeer) ?? allowed.peerNames.get(peer) ?? 'Someone';
  return {
    status: 'ok',
    message: {
      chatJid: peer,
      senderName,
      place: senderName,
      text,
      messageId: row.originId,
    },
  };
}

// Muted while `muted_until` is in the future. Mirrors the clients'
// `effectivePrefFor`: a chat with its own row uses that row; a topic without
// one inherits its group General room's mute.
async function isMuted(
  deps: PushServiceDeps,
  userId: string,
  chatJid: string,
  generalJid: string | undefined,
  now: Date,
): Promise<boolean> {
  const [own] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ mutedUntil: Date | null }>`SELECT muted_until FROM chat_prefs
        WHERE user_id = ${userId} AND chat_jid = ${chatJid} LIMIT 1`;
    }),
  );
  if (own !== undefined) {
    return own.mutedUntil !== null && own.mutedUntil.getTime() > now.getTime();
  }
  if (generalJid !== undefined && chatJid !== generalJid) {
    const [general] = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ mutedUntil: Date | null }>`SELECT muted_until FROM chat_prefs
          WHERE user_id = ${userId} AND chat_jid = ${generalJid} LIMIT 1`;
      }),
    );
    return (
      general !== undefined &&
      general.mutedUntil !== null &&
      general.mutedUntil.getTime() > now.getTime()
    );
  }
  return false;
}

function topicRoomGeneralJid(deps: PushServiceDeps, groupRoomLocalpart: string): string {
  return `${groupRoomLocalpart}@${deps.config.xmpp.mucDomain}`.toLowerCase();
}
