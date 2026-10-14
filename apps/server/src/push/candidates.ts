import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { GroupRow } from '../db/rows';
import { runSql } from '../effect/sql';
import type { SearchOwner } from '../search/service';
import { bareJid, ownBareJid } from '../jid';
import { isLiveAiUiEdit, isLiveAiUiRow } from '../notify/ai-cards';
import { stanzaFrom } from '../search/routes';
import { canSeeTopic, type TopicRow } from '../topics/access';
import { albumInfoFromXml } from '../xmpp/album-xml';
import { localpartFor } from '../xmpp/provisioning';
import type { ArchiveCandidate } from './archive-scan';
import type { ResolvedPushMessage } from './payload';
import type { PushServiceDeps } from './service';

type CandidateVerdict =
  { status: 'ok'; message: ResolvedPushMessage } | { status: 'muted' | 'hidden' | 'skip' };

// Resolution only reads the database, the config and the clock, so the preview
// route can call it without the push component's cipher, sender or logger.
type CandidateDeps = Pick<PushServiceDeps, 'db' | 'config' | 'now'>;

// A reader that is not walking a batch passes no live-UI ids: a correction or
// retraction then skips only when the row is not an edit of a known card.
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
  // The live AI UI (a progress card) is not a message, and neither is a
  // correction or retraction that edits one (T-1400): never notify for them.
  // The card itself carries the payload; a card edit only names its target, so
  // `liveIds` is the batch's live-UI origin ids the caller already read.
  if (isLiveAiUiRow(row.xml) || isLiveAiUiEdit(row.xml, liveIds)) {
    return { status: 'skip' };
  }
  // A retraction archives with the stock fallback sentence as its text:
  // never notify for one.
  if (row.xml.includes('urn:xmpp:message-retract:1')) {
    return { status: 'skip' };
  }
  const rawText = row.text === null || row.text === '' ? undefined : row.text;
  // A reply archives with its XEP-0461 fallback quote as the head of the
  // text (`> quote\n…`); the push preview shows the reply text, not the
  // quote, so the marked range leaves the text.
  const text = rawText === undefined ? undefined : textWithoutReplyFallback(rawText, row.xml);
  if (text === undefined && row.xml.includes('urn:xmpp:reactions:0')) {
    return { status: 'skip' };
  }
  const album = albumInfoFromXml(row.xml);
  const verdict =
    row.kind === 'groupchat'
      ? await resolveRoomCandidate(deps, userId, row, text)
      : await resolveDmCandidate(deps, userId, allowed, row, text);
  // One row of an album carries the marker: the payload shows its count and
  // the scan marks the album's sibling rows with it (T-1269).
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
      chatKind: group.kind === 'channel' ? 'channel' : 'group',
      senderName: row.nick === '' ? 'Someone' : row.nick,
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
      chatKind: 'dm',
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
  deps: CandidateDeps,
  userId: string,
  chatJid: string,
  generalJid: string | undefined,
  now: Date,
): Promise<boolean> {
  // One read covers both candidate rows (T-1184, PERF-5). The chat's own row
  // wins when present; a topic without one falls back to its group's General
  // row.
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

// A reply's XEP-0461 fallback quote is the head of the archived text, marked
// by `<fallback for="urn:xmpp:reply:0"><body start end/></fallback>` in the
// row's XML (start and end are code points into the text). The archive XML is
// read defensively with regexes, the way `search/snippet.ts` reads it
// (`stanzaFrom`, `correctionTarget`): a row whose XML does not parse keeps
// today's text.
function textWithoutReplyFallback(text: string, xml: string): string {
  if (!xml.includes('urn:xmpp:reply:0')) {
    return text;
  }
  const fallback = xml.match(
    /<fallback\b[^>]*\bfor\s*=\s*(["'])urn:xmpp:reply:0\1[^>]*>([\s\S]*?)<\/fallback\s*>/,
  );
  const bodyTag = fallback?.[2]?.match(/<body\b[^>]*>/);
  const start = bodyTag?.[0].match(/\bstart\s*=\s*(["'])(\d+)\1/)?.[2];
  const end = bodyTag?.[0].match(/\bend\s*=\s*(["'])(\d+)\1/)?.[2];
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
