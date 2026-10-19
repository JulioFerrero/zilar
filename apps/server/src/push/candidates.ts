import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { isDmBlocked } from '../blocks/service';
import type { GroupRow } from '../db/rows';
import { runSql } from '../effect/sql';
import type { SearchOwner } from '../search/service';
import { bareJid, ownBareJid } from '../jid';
import { isLiveAiUiEdit, isLiveAiUiRow } from '../notify/ai-cards';
import { canSeeTopic, isTopicMember, type TopicRow } from '../topics/access';
import { findCloseTag, nextOpenTag, openTagAttrs } from '../markup/scan';
import { albumInfoFromXml } from '../xmpp/album-xml';
import { senderNamesByJid } from '../xmpp/archive-sender';
import { localpartFor } from '../xmpp/provisioning';
import type { ArchiveCandidate } from './archive-scan';
import type { ResolvedPushMessage } from './payload';
import type { PushServiceDeps } from './service';
import { stanzaFrom } from '../search/snippet';

type CandidateVerdict =
  { status: 'ok'; message: ResolvedPushMessage } | { status: 'muted' | 'hidden' | 'skip' };

// Resolution only reads the database, config and clock, so the preview route
// can call it without the component's cipher, sender or logger.
type CandidateDeps = Pick<PushServiceDeps, 'db' | 'config' | 'now'>;

// A reader not walking a batch passes no live-UI ids, so a correction skips
// only when the row is not an edit of a known card.
const NO_LIVE_IDS: ReadonlySet<string> = new Set<string>();

export async function resolveCandidate(
  deps: CandidateDeps,
  userId: string,
  allowed: SearchOwner,
  row: ArchiveCandidate,
  liveIds: ReadonlySet<string> = NO_LIVE_IDS,
): Promise<CandidateVerdict> {
  if (row.originId === '') {
    return { status: 'skip' };
  }
  // The live AI UI is not a message, and neither is a correction or retraction
  // of one: never notify for them.
  if (isLiveAiUiRow(row.xml, row.barePeer) || isLiveAiUiEdit(row.xml, liveIds)) {
    return { status: 'skip' };
  }
  // A retraction archives the stock fallback sentence: never notify.
  if (row.xml.includes('urn:xmpp:message-retract:1')) {
    return { status: 'skip' };
  }
  const rawText = row.text === null || row.text === '' ? undefined : row.text;
  // A reply archives with its XEP-0461 fallback quote as the head of the text;
  // the preview shows the reply, not the quote, so the marked range leaves it.
  const text = rawText === undefined ? undefined : textWithoutReplyFallback(rawText, row.xml);
  if (text === undefined && row.xml.includes('urn:xmpp:reactions:0')) {
    return { status: 'skip' };
  }
  const album = albumInfoFromXml(row.xml);
  const verdict =
    row.kind === 'groupchat'
      ? await resolveRoomCandidate(deps, userId, row, text)
      : await resolveDmCandidate(deps, userId, allowed, row, text);
  // One row of an album carries the marker; the scan marks its siblings with
  // it.
  if (verdict.status === 'ok' && album !== undefined) {
    verdict.message.albumId = album.id;
    verdict.message.albumCount = album.count;
  }
  return verdict;
}

async function resolveRoomCandidate(
  deps: CandidateDeps,
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
  // Send-time visibility re-check: a private topic's name only goes to a user
  // who can see it right now. Only General reaches the whole group.
  if (!(await canSeeTopic(deps.db, topic, userId))) {
    return { status: 'hidden' };
  }
  if (!topic.isGeneral && !(await isTopicMember(deps.db, topic.id, userId))) {
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
  // The user's own room messages share the archive scope (sent from another
  // session); only other members' messages notify. `bare_peer` holds the real
  // sender's bare JID, since the nick is display text; only a legacy row with
  // none falls back to the nick, case-insensitively.
  const ownLocalpart = localpartFor(userId);
  const senderJid = row.barePeer === '' ? null : bareJid(row.barePeer);
  if (senderJid !== null) {
    if (senderJid === ownBareJid({ ownLocalpart }, deps.config.xmpp.domain)) {
      return { status: 'skip' };
    }
    // A block is silent, in either direction, even through a shared group.
    if (await isDmBlocked(deps.db, userId, senderJid)) {
      return { status: 'skip' };
    }
  } else if (row.nick !== '' && row.nick.toLowerCase() === ownLocalpart.toLowerCase()) {
    return { status: 'skip' };
  }
  const now = (deps.now ?? (() => new Date()))();
  if (await isMuted(deps, userId, roomJid, topicRoomGeneralJid(deps, group.roomLocalpart), now)) {
    return { status: 'muted' };
  }
  // The real sender's display name; the nick only when our tables have none.
  let senderName = row.nick === '' ? 'Someone' : row.nick;
  if (senderJid !== null) {
    senderName = (await senderNamesByJid(deps.db, [senderJid])).get(senderJid) ?? senderName;
  }
  const place = topic.isGeneral ? group.title : `${group.title} › ${topic.name}`;
  return {
    status: 'ok',
    message: {
      chatJid: roomJid,
      chatKind: group.kind === 'channel' ? 'channel' : 'group',
      senderName,
      place,
      text,
      messageId: row.originId,
    },
  };
}

async function resolveDmCandidate(
  deps: CandidateDeps,
  userId: string,
  allowed: SearchOwner,
  row: ArchiveCandidate,
  text: string | undefined,
): Promise<CandidateVerdict> {
  const peer = row.barePeer.toLowerCase();
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
      chatKind: 'dm',
      senderName,
      place: senderName,
      text,
      messageId: row.originId,
    },
  };
}

// Muted while `muted_until` is in the future; a chat's own pref wins, and a
// topic without one inherits its group General room's mute.
async function isMuted(
  deps: CandidateDeps,
  userId: string,
  chatJid: string,
  generalJid: string | undefined,
  now: Date,
): Promise<boolean> {
  // One read covers both rows: the chat's own row wins, else its group's
  // General row.
  const jids =
    generalJid !== undefined && generalJid !== chatJid ? [chatJid, generalJid] : [chatJid];
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        chatJid: string;
        mutedUntil: Date | null;
      }>`SELECT chat_jid, muted_until FROM chat_prefs
        WHERE user_id = ${userId} AND chat_jid IN ${sql.in(jids)}`;
    }),
  );
  const chosen =
    rows.find((row) => row.chatJid === chatJid) ?? rows.find((row) => row.chatJid === generalJid);
  return (
    chosen !== undefined &&
    chosen.mutedUntil !== null &&
    chosen.mutedUntil.getTime() > now.getTime()
  );
}

const REPLY_FALLBACK_FOR = /\bfor\s*=\s*(["'])urn:xmpp:reply:0\1/;

// A reply's XEP-0461 fallback quote is the head of the archived text, marked
// by `<fallback for="urn:xmpp:reply:0"><body start end/></fallback>` (code
// points). The XML is read defensively: an unparseable row keeps today's
// text.
export function textWithoutReplyFallback(text: string, xml: string): string {
  if (!xml.includes('urn:xmpp:reply:0')) {
    return text;
  }
  let cursor = 0;
  let fallbackInner: string | null = null;
  while (true) {
    const open = nextOpenTag(xml, 'fallback', cursor);
    if (open === null || !REPLY_FALLBACK_FOR.test(open.attrs)) {
      if (open === null) {
        break;
      }
      cursor = open.end;
      continue;
    }
    const closeStart = findCloseTag(xml, 'fallback', open.end);
    if (closeStart === null) {
      break;
    }
    fallbackInner = xml.slice(open.end, closeStart);
    break;
  }
  if (fallbackInner === null) {
    return text;
  }
  const bodyTag = openTagAttrs(fallbackInner, 'body');
  const start = bodyTag?.match(/\bstart\s*=\s*(["'])(\d+)\1/)?.[2];
  const end = bodyTag?.match(/\bend\s*=\s*(["'])(\d+)\1/)?.[2];
  if (start === undefined || end === undefined) {
    return text;
  }
  const startPoint = Number.parseInt(start, 10);
  const endPoint = Number.parseInt(end, 10);
  if (!Number.isSafeInteger(startPoint) || !Number.isSafeInteger(endPoint)) {
    return text;
  }
  const chars = Array.from(text);
  if (startPoint >= endPoint || endPoint > chars.length) {
    return text;
  }
  const rest = chars.slice(endPoint).join('');
  return rest.startsWith('\n') ? rest.slice(1) : rest;
}

function topicRoomGeneralJid(deps: CandidateDeps, groupRoomLocalpart: string): string {
  return `${groupRoomLocalpart}@${deps.config.xmpp.mucDomain}`.toLowerCase();
}
