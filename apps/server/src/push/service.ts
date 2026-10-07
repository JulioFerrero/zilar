import { Data, Duration, Effect, type Effect as EffectType } from 'effect';
import { and, eq } from 'drizzle-orm';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { chatPrefs, groups, topics } from '../db/schema';
import { allowedArchives, type ArchivePool, type SearchOwner } from '../search/service';
import { stanzaFrom } from '../search/routes';
import { canSeeTopic } from '../topics/access';
import { localpartFor } from '../xmpp/provisioning';
import type { PushCipher } from './crypto';
import { buildPushPayload, type PushPayload, type ResolvedPushMessage } from './payload';
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
  /** Per-process record of notified message origin ids per device node, so
   * a retried publish IQ or a re-scan never buzzes twice. Capped per node.
   * Keyed by node (not user): ejabberd sends one publish IQ per node and
   * each device must buzz independently (S1). */
  recentlyNotified: Map<string, Set<string>>;
  now?: () => Date;
}

export type PushOutcome =
  | { kind: 'sent'; userId: string; deviceId: string }
  | {
      kind: 'dropped';
      userId: string;
      deviceId: string;
      reason:
        | 'muted'
        | 'hidden'
        | 'duplicate'
        | 'no-message'
        | 'archive-unavailable'
        | 'undecryptable'
        | 'send-failed';
    }
  | { kind: 'unknown-device'; node: string };

// Internal failure modes of the delivery pipeline. They never leave this
// module: `handleIncomingPush` maps each to today's dropped outcome and log.
type DeliveryError = Undecryptable | ArchiveUnavailable | SendFailed;

class Undecryptable extends Data.TaggedError('Undecryptable') {}

class ArchiveUnavailable extends Data.TaggedError('ArchiveUnavailable') {}

class SendFailed extends Data.TaggedError('SendFailed') {}

type DroppedReason = Extract<PushOutcome, { kind: 'dropped' }>['reason'];

type OpenDevice = ReturnType<typeof openDevice>;

function dropped(device: PushDeviceRow, reason: DroppedReason): PushOutcome {
  return { kind: 'dropped', userId: device.userId, deviceId: device.id, reason };
}

// Lifts a drizzle promise the same way `await` did: a DB failure rejects the
// boundary promise with the original error, identical and unwrapped. Only the
// calls whose old contract was "any throw becomes archive-unavailable" use a
// typed catch instead (see `newestMessageForUserEffect`).
const awaitDb = <A>(promise: () => Promise<A>): EffectType.Effect<A, never, never> =>
  Effect.promise(promise);

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
//
// The pipeline runs as Effect inside (see `docs/EFFECT_GUIDE.md`); this
// `Promise` boundary runs it and maps each typed error to today's dropped
// outcome and log. DB failures that used to reject still reject unchanged.
export async function handleIncomingPush(
  deps: PushServiceDeps,
  notification: PushNotification,
): Promise<PushOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const device = await deviceByNode(deps.db, notification.node);
  if (device === undefined) {
    return { kind: 'unknown-device', node: notification.node };
  }
  const outcome = await Effect.runPromise(
    resolveAndSendEffect(deps, device, notification.node).pipe(
      Effect.catchTags({
        Undecryptable: () =>
          Effect.sync(() => {
            deps.logger.warn(
              { userId: device.userId, deviceId: device.id },
              'push device undecryptable; dropping the notification',
            );
            return dropped(device, 'undecryptable');
          }),
        ArchiveUnavailable: () =>
          Effect.sync(() => {
            deps.logger.warn(
              { userId: device.userId, deviceId: device.id },
              'push archive lookup failed; dropping the notification',
            );
            return dropped(device, 'archive-unavailable');
          }),
        SendFailed: () =>
          Effect.sync(() => {
            deps.logger.warn(
              { userId: device.userId, deviceId: device.id },
              'push send failed; answered the publish IQ with result anyway',
            );
            return dropped(device, 'send-failed');
          }),
      }),
    ),
  );
  if (outcome.kind === 'sent') {
    await markDeviceUsed(deps.db, device.id, now);
  }
  return outcome;
}

const openDeviceEffect = Effect.fnUntraced(function* (
  deps: PushServiceDeps,
  device: PushDeviceRow,
): EffectType.fn.Return<OpenDevice, Undecryptable> {
  return yield* Effect.try({
    try: () => openDevice(deps.cipher, device),
    catch: () => new Undecryptable(),
  });
});

const resolveAndSendEffect = Effect.fnUntraced(function* (
  deps: PushServiceDeps,
  device: PushDeviceRow,
  node: string,
): EffectType.fn.Return<PushOutcome, DeliveryError> {
  const subscription = yield* openDeviceEffect(deps, device);
  const scan = yield* newestMessageForUserEffect(deps, device.userId, node).pipe(
    // The old Promise version wrapped this whole call in a try/catch: any
    // throw from the scan — including a synchronous one in its own loop
    // bookkeeping when the archive answers something unexpected — became
    // `archive-unavailable`. A rejected promise is mapped inside the scan; a
    // defect is caught here so `handleIncomingPush` still never rejects.
    Effect.catchDefect(() => Effect.fail(new ArchiveUnavailable())),
  );
  const newest = scan.newest;
  if (newest === undefined) {
    // Nothing acceptable to show: persistent emptiness (the trigger may be
    // a muted or hidden message whose MAM row never landed), mute,
    // invisibility, or an already-notified message all stay silent. A muted
    // or hidden message never produces even a generic notification.
    const reason =
      scan.saw === 'muted' || scan.saw === 'hidden' || scan.saw === 'no-message'
        ? scan.saw
        : 'duplicate';
    return dropped(device, reason);
  }

  const showPreviews = yield* awaitDb(() => showPreviewsForUser(deps.db, device.userId));
  const payload = buildPushPayload(newest.message, {
    muted: false,
    visible: true,
    showPreviews,
  });
  if (payload === undefined) {
    return dropped(device, 'muted');
  }
  yield* sendPayloadEffect(deps, device, subscription, payload);
  // Marked only after a successful send. Per-node serialization keeps
  // concurrent IQs for one node ordered, so a retry cannot double-buzz:
  // the retry finds the origin id already seen and drops as `duplicate`.
  markNotified(deps, device.node, scan.notify);
  return { kind: 'sent', userId: device.userId, deviceId: device.id };
});

const sendPayloadEffect = Effect.fnUntraced(function* (
  deps: PushServiceDeps,
  device: PushDeviceRow,
  subscription: OpenDevice,
  payload: PushPayload,
): EffectType.fn.Return<void, SendFailed> {
  const now = (deps.now ?? (() => new Date()))();
  // The send and the `gone` cleanup share one `try`, exactly like the old
  // `try` block: any throw stamps `failed_at` and answers the IQ with a
  // result. A failure here is not marked notified (F3), so a retried publish
  // IQ for the same message still notifies.
  yield* Effect.tryPromise({
    try: async () => {
      const result = await deps.sender.send(subscription, JSON.stringify(payload));
      if (result.gone) {
        await removeDeviceByNode(deps.db, device.node);
        deps.logger.info(
          { userId: device.userId, deviceId: device.id },
          'push subscription expired; removed',
        );
      }
    },
    catch: () => new SendFailed(),
  }).pipe(
    Effect.catchTag('SendFailed', () =>
      Effect.gen(function* () {
        yield* awaitDb(() => markDeviceFailed(deps.db, device.id, now));
        // Ids only: the error may echo the request, which carries the endpoint.
        // The boundary logs the failure and returns the dropped outcome.
        return yield* new SendFailed();
      }),
    ),
  );
});

// How many notified origin ids to remember per device node before
// forgetting the oldest (a retried publish IQ or a re-scan then stays
// silent for those).
const NOTIFIED_REMEMBERED = 500;

interface NewestScan {
  newest: { message: ResolvedPushMessage } | undefined;
  /** Origin ids to mark as notified when a message is sent: the sent
   * message plus the older rows the winning read evaluated past
   * (`superseded` below). Rows skipped as muted or hidden above the sent
   * row are never marked — a later change can still notify them; rows that
   * were already seen stay as they are. */
  notify: string[];
  /** What the scan ran into when nothing was acceptable. */
  saw: 'muted' | 'hidden' | 'duplicate' | 'no-message';
}

// The newest notifiable message across every chat the user may see (DMs with
// contacts/AIs plus visible group and topic rooms), newest first. One publish
// IQ produces at most one notification — the newest acceptable row wins, and
// a burst while offline buzzes once with the latest, never once per message.
// Rows in muted chats and private topics the user cannot see never notify —
// not even generically: when the trigger's MAM row has not landed yet the
// scan cannot tell a muted message from a race, so an empty scope stays
// silent. Retraction rows (their text is the stock fallback), body-less
// reaction rows, the user's own outgoing DM rows, and rows already notified
// do not notify either.
const newestMessageForUserEffect = Effect.fnUntraced(function* (
  deps: PushServiceDeps,
  userId: string,
  node: string,
): EffectType.fn.Return<NewestScan, ArchiveUnavailable> {
  const allowed = yield* Effect.tryPromise({
    try: () => allowedArchives(deps.db, deps.config, userId),
    catch: () => new ArchiveUnavailable(),
  });
  // Per node (device): one publish IQ per node means each device buzzes
  // independently, while a retried IQ for the same node still dedups (S1).
  const seen = deps.recentlyNotified.get(node) ?? new Set<string>();
  // A muted or hidden newest sticks across the MAM-race retries: the trigger
  // itself must stay silent, and older rows behind it are not evaluated.
  let sticky: 'muted' | 'hidden' | undefined;
  let everSawRows = false;
  for (let attempt = 0; attempt < ARCHIVE_LOOKUP_ATTEMPTS; attempt += 1) {
    const rows = yield* Effect.tryPromise({
      try: () => readNewestCandidates(deps.archive, allowed),
      catch: () => new ArchiveUnavailable(),
    });
    if (rows.length > 0) {
      everSawRows = true;
    }
    const superseded: string[] = [];
    for (const row of rows) {
      if (row.originId === '' || seen.has(row.originId)) {
        continue;
      }
      const verdict = yield* Effect.tryPromise({
        try: () => resolveCandidate(deps, userId, allowed, row),
        catch: () => new ArchiveUnavailable(),
      });
      if (verdict.status === 'ok') {
        // The sent message plus every older row this read superseded. Rows
        // skipped as muted/hidden above it are deliberately excluded (see
        // the interface comment): they were never notified for.
        return {
          newest: { message: verdict.message },
          notify: [row.originId, ...superseded],
          saw: 'duplicate',
        };
      }
      if (verdict.status === 'muted' || verdict.status === 'hidden') {
        sticky = verdict.status;
        break;
      }
      superseded.push(row.originId);
    }
    // Something new resolved to silence: the verdict already covers the
    // trigger, so stop. Anything else (only skipped rows, or nothing unseen
    // at all) retries: the trigger's MAM row may still be landing.
    if (sticky !== undefined) {
      break;
    }
    if (attempt + 1 < ARCHIVE_LOOKUP_ATTEMPTS) {
      yield* Effect.sleep(Duration.millis(ARCHIVE_LOOKUP_RETRY_MS));
    }
  }
  if (sticky !== undefined) {
    return { newest: undefined, notify: [], saw: sticky };
  }
  // No acceptable row and nothing known muted: the trigger's MAM row may
  // still have been landing (or the message is one we never show, like a
  // retraction). Either way there is nothing to show, and — decision from
  // finding 2 — the scan stays silent rather than risking a generic buzz
  // for a muted or hidden message whose row never landed. Reads that held
  // only already-notified rows report `duplicate`; persistent emptiness
  // reports `no-message`.
  return { newest: undefined, notify: [], saw: everSawRows ? 'duplicate' : 'no-message' };
});

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

// Remembers origin ids as notified per device node, so a retried publish
// IQ or a later re-scan for the same node stays silent. Capped per node.
function markNotified(deps: PushServiceDeps, node: string, originIds: string[]): void {
  let seen = deps.recentlyNotified.get(node);
  if (seen === undefined) {
    seen = new Set();
    deps.recentlyNotified.set(node, seen);
  }
  for (const originId of originIds) {
    seen.add(originId);
  }
  if (seen.size > NOTIFIED_REMEMBERED) {
    const fresh = [...seen].slice(seen.size - NOTIFIED_REMEMBERED);
    deps.recentlyNotified.set(node, new Set(fresh));
  }
}
