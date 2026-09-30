import { and, eq } from 'drizzle-orm';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { chatPrefs, groups, topics } from '../db/schema';
import { allowedArchives, type ArchivePool, type SearchOwner } from '../search/service';
import { stanzaFrom } from '../search/routes';
import { canSeeTopic } from '../topics/access';
import type { PushCipher } from './crypto';
import {
  buildGenericPushPayload,
  buildPushPayload,
  type PushPayload,
  type ResolvedPushMessage,
} from './payload';
import type { PushNotification } from './protocol';
import type { WebPushDelivery } from './sender';
import {
  deviceByNode,
  markDeviceFailed,
  markDeviceUsed,
  openDevice,
  removeDeviceByNode,
  showPreviewsForUser,
  type PushDeviceRow,
} from './store';

export interface PushLogger {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface PushServiceDeps {
  db: ServerDatabase;
  config: ServerConfig;
  /** Read-only pool on the ejabberd MAM archive. The component only starts
   * when it is configured: without the archive who/where cannot be
   * resolved, so notifications are dropped instead of guessed. */
  archive: ArchivePool;
  cipher: PushCipher;
  sender: WebPushDelivery;
  logger: PushLogger;
  /** Per-process record of notified message origin ids per user, so a
   * retried publish IQ or a re-scan never buzzes twice. Capped per user. */
  recentlyNotified: Map<string, Set<string>>;
  now?: () => Date;
}

export type PushOutcome =
  | { kind: 'sent'; userId: string; deviceId: string }
  | { kind: 'generic'; userId: string; deviceId: string }
  | {
      kind: 'dropped';
      userId: string;
      deviceId: string;
      reason:
        'muted' | 'hidden' | 'duplicate' | 'archive-unavailable' | 'undecryptable' | 'send-failed';
    }
  | { kind: 'unknown-device'; node: string };

// How many of the newest archived rows to scan for an acceptable message,
// and how often to re-read before giving up (the publish IQ can win the race
// against the MAM write).
const ARCHIVE_CANDIDATES = 25;
const ARCHIVE_LOOKUP_ATTEMPTS = 3;
const ARCHIVE_LOOKUP_RETRY_MS = 300;

interface ArchiveCandidate {
  owner: string;
  barePeer: string;
  kind: string;
  nick: string;
  originId: string;
  timestamp: number | string | bigint;
  text: string | null;
  xml: string;
}

// Handles one publish IQ for one device: resolves the newest message from
// the archive, applies the send-time mute and visibility checks, and sends.
// Never throws: every failure answers `result` at the component (ejabberd
// disables a push pair after an error IQ) and is logged with ids only —
// never message text or endpoint URLs.
export async function handleIncomingPush(
  deps: PushServiceDeps,
  notification: PushNotification,
): Promise<PushOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const device = await deviceByNode(deps.db, notification.node);
  if (device === undefined) {
    return { kind: 'unknown-device', node: notification.node };
  }
  const outcome = await resolveAndSend(deps, device, now);
  if (outcome.kind === 'sent' || outcome.kind === 'generic') {
    await markDeviceUsed(deps.db, device.id, now);
  }
  return outcome;
}

async function resolveAndSend(
  deps: PushServiceDeps,
  device: PushDeviceRow,
  _now: Date,
): Promise<PushOutcome> {
  let subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  try {
    subscription = openDevice(deps.cipher, device);
  } catch {
    deps.logger.warn(
      { userId: device.userId, deviceId: device.id },
      'push device undecryptable; dropping the notification',
    );
    return {
      kind: 'dropped',
      userId: device.userId,
      deviceId: device.id,
      reason: 'undecryptable',
    };
  }

  let scan: NewestScan;
  try {
    scan = await newestMessageForUser(deps, device.userId);
  } catch {
    deps.logger.warn(
      { userId: device.userId, deviceId: device.id },
      'push archive lookup failed; dropping the notification',
    );
    return {
      kind: 'dropped',
      userId: device.userId,
      deviceId: device.id,
      reason: 'archive-unavailable',
    };
  }
  const newest = scan.newest;
  if (newest === undefined) {
    // Nothing acceptable to show. When the archive simply has no rows in
    // scope (a transient race ejabberd won) the trigger is real but
    // unresolvable, so the content-free generic buzzes rather than silence.
    // When rows exist but every one is muted, hidden or already notified,
    // silence is correct — especially for mute.
    if (scan.saw === 'empty') {
      await sendPayload(deps, device, subscription, buildGenericPushPayload());
      return { kind: 'generic', userId: device.userId, deviceId: device.id };
    }
    const reason = scan.saw === 'muted' ? 'muted' : scan.saw === 'hidden' ? 'hidden' : 'duplicate';
    return { kind: 'dropped', userId: device.userId, deviceId: device.id, reason };
  }

  const showPreviews = await showPreviewsForUser(deps.db, device.userId);
  const payload = buildPushPayload(newest.message, {
    muted: false,
    visible: true,
    showPreviews,
  });
  if (payload === undefined) {
    return { kind: 'dropped', userId: device.userId, deviceId: device.id, reason: 'muted' };
  }
  markNotified(deps, device.userId, scan.observed);
  const outcome = await sendPayload(deps, device, subscription, payload);
  // `last_used_at` is the last successful send; a failed send only stamps
  // `failed_at` (inside `sendPayload`), so the 90-day inactivity rule keeps
  // measuring receipt, not attempts.
  if (outcome === 'failed') {
    return { kind: 'dropped', userId: device.userId, deviceId: device.id, reason: 'send-failed' };
  }
  return { kind: 'sent', userId: device.userId, deviceId: device.id };
}

async function sendPayload(
  deps: PushServiceDeps,
  device: PushDeviceRow,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: PushPayload,
): Promise<'sent' | 'failed'> {
  const now = (deps.now ?? (() => new Date()))();
  try {
    const result = await deps.sender.send(subscription, JSON.stringify(payload));
    if (result.gone) {
      await removeDeviceByNode(deps.db, device.node);
      deps.logger.info(
        { userId: device.userId, deviceId: device.id },
        'push subscription expired; removed',
      );
    }
    return 'sent';
  } catch {
    await markDeviceFailed(deps.db, device.id, now);
    // Ids only: the error may echo the request, which carries the endpoint.
    deps.logger.warn(
      { userId: device.userId, deviceId: device.id },
      'push send failed; answered the publish IQ with result anyway',
    );
    return 'failed';
  }
}

// How many notified origin ids to remember per user before forgetting the
// oldest (a retried publish IQ or a re-scan then stays silent for those).
const NOTIFIED_REMEMBERED = 500;

interface NewestScan {
  newest: { message: ResolvedPushMessage } | undefined;
  /** Every origin id the winning read observed. On send all are marked
   * notified: one publish IQ produces at most one notification, and a
   * burst while offline buzzes once with the latest — an older message the
   * same read already saw is superseded, never re-announced later. */
  observed: string[];
  /** What the scan ran into when nothing was acceptable. */
  saw: 'empty' | 'muted' | 'hidden' | 'duplicate';
}

// The newest notifiable message across every chat the user may see (DMs with
// contacts/AIs plus visible group and topic rooms), newest first. One publish
// IQ produces at most one notification — the newest acceptable row wins, and
// a burst while offline buzzes once with the latest, never once per message.
// Rows in muted chats and private topics the user cannot see never notify,
// as retraction rows (their text is the stock fallback), body-less reaction
// rows, the user's own outgoing DM rows, and rows already notified do not
// either.
async function newestMessageForUser(deps: PushServiceDeps, userId: string): Promise<NewestScan> {
  const allowed = await allowedArchives(deps.db, deps.config, userId);
  const seen = deps.recentlyNotified.get(userId) ?? new Set<string>();
  // A muted or hidden newest sticks across the MAM-race retries: the trigger
  // itself must stay silent, and older rows behind it are superseded.
  let sticky: 'muted' | 'hidden' | undefined;
  let observed: string[] = [];
  for (let attempt = 0; attempt < ARCHIVE_LOOKUP_ATTEMPTS; attempt += 1) {
    const rows = await readNewestCandidates(deps.archive, allowed);
    if (rows.length > 0) {
      observed = rows.map((row) => row.originId).filter((originId) => originId !== '');
    }
    for (const row of rows) {
      if (row.originId === '' || seen.has(row.originId)) {
        continue;
      }
      const verdict = await resolveCandidate(deps, userId, allowed, row);
      if (verdict.status === 'ok') {
        return { newest: { message: verdict.message }, observed, saw: 'duplicate' };
      }
      if (verdict.status === 'muted' || verdict.status === 'hidden') {
        sticky = verdict.status;
        break;
      }
    }
    // Something new resolved to silence: the verdict already covers the
    // trigger, so stop. Anything else (only skipped rows, or nothing unseen
    // at all) retries: the trigger's MAM row may still be landing.
    if (sticky !== undefined) {
      break;
    }
    if (attempt + 1 < ARCHIVE_LOOKUP_ATTEMPTS) {
      await sleep(ARCHIVE_LOOKUP_RETRY_MS);
    }
  }
  if (sticky !== undefined) {
    return { newest: undefined, observed, saw: sticky };
  }
  return { newest: undefined, observed, saw: observed.length === 0 ? 'empty' : 'duplicate' };
}

function buildNewestQuery(allowed: SearchOwner): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const next = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const rooms = next(allowed.rooms);
  const ownLocalpart = next(allowed.ownLocalpart);
  const dmPeers = next(allowed.dmPeers);
  const cap = next(ARCHIVE_CANDIDATES);
  return {
    text: `SELECT username AS owner, peer, bare_peer AS "barePeer", kind, nick, origin_id AS "originId", timestamp, txt AS text, xml FROM archive WHERE (username = ANY(${rooms}) OR (username = ${ownLocalpart} AND bare_peer = ANY(${dmPeers}))) ORDER BY timestamp DESC LIMIT ${cap}`,
    values,
  };
}

async function readNewestCandidates(
  archive: ArchivePool,
  allowed: SearchOwner,
): Promise<ArchiveCandidate[]> {
  const built = buildNewestQuery(allowed);
  const rows = (await archive.query(built.text, built.values)) as unknown as ArchiveCandidate[];
  return rows;
}

type CandidateVerdict =
  { status: 'ok'; message: ResolvedPushMessage } | { status: 'muted' | 'hidden' | 'skip' };

async function resolveCandidate(
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
  const [topic] = await deps.db.select().from(topics).where(eq(topics.roomLocalpart, localpart));
  if (topic === undefined) {
    return { status: 'skip' };
  }
  // Send-time visibility re-check: a private topic's name only ever goes to
  // a user who can see that topic right now, and a muted chat sends nothing
  // (a topic falls back to its group's General mute, like the clients).
  if (!(await canSeeTopic(deps.db, topic, userId))) {
    return { status: 'hidden' };
  }
  const [group] = await deps.db.select().from(groups).where(eq(groups.id, topic.groupId));
  if (group === undefined) {
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
  if (from !== null && bareJidOf(from) === ownBareJid(allowed, deps.config.xmpp.domain)) {
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
  const [own] = await deps.db
    .select({ mutedUntil: chatPrefs.mutedUntil })
    .from(chatPrefs)
    .where(and(eq(chatPrefs.userId, userId), eq(chatPrefs.chatJid, chatJid)))
    .limit(1);
  if (own !== undefined) {
    return own.mutedUntil !== null && own.mutedUntil.getTime() > now.getTime();
  }
  if (generalJid !== undefined && chatJid !== generalJid) {
    const [general] = await deps.db
      .select({ mutedUntil: chatPrefs.mutedUntil })
      .from(chatPrefs)
      .where(and(eq(chatPrefs.userId, userId), eq(chatPrefs.chatJid, generalJid)))
      .limit(1);
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

function ownBareJid(allowed: SearchOwner, domain: string): string {
  return `${allowed.ownLocalpart}@${domain.toLowerCase()}`;
}

function bareJidOf(jid: string): string {
  return jid.split('/')[0]?.toLowerCase() ?? '';
}

// Remembers every scanned origin id as notified, so a retried publish IQ or
// a later re-scan stays silent for them. Capped per user.
function markNotified(deps: PushServiceDeps, userId: string, originIds: string[]): void {
  let seen = deps.recentlyNotified.get(userId);
  if (seen === undefined) {
    seen = new Set();
    deps.recentlyNotified.set(userId, seen);
  }
  for (const originId of originIds) {
    seen.add(originId);
  }
  if (seen.size > NOTIFIED_REMEMBERED) {
    const fresh = [...seen].slice(seen.size - NOTIFIED_REMEMBERED);
    deps.recentlyNotified.set(userId, new Set(fresh));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
