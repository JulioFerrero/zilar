import { Effect, type Effect as EffectType } from 'effect';
import { markPushFailed, markPushSent } from '../health-status';
import { albumKey } from './album-key';
import { newestMessageForUserEffect } from './archive-scan';
import { pushFailureReason } from './failure-reason';
import { buildNativeWakePayload, buildPushPayload, type ResolvedPushMessage } from './payload';
import type { PushNotification } from './protocol';
import {
  ArchiveUnavailable,
  SendFailed,
  Undecryptable,
  type PushOutcome,
  type PushServiceDeps,
} from './service';
import {
  deviceByNode,
  markDeviceFailed,
  markDeviceUsed,
  openDevice,
  openNativeDevice,
  removeDeviceByNode,
  showPreviewsForUser,
  type PushDeviceRow,
} from './store';

// Internal failure modes of the delivery pipeline. They never leave this
// module: `handleIncomingPush` maps each to today's dropped outcome and log.
type DeliveryError = Undecryptable | ArchiveUnavailable | SendFailed;

type DroppedReason = Extract<PushOutcome, { kind: 'dropped' }>['reason'];

type OpenDevice = ReturnType<typeof openDevice>;

function dropped(device: PushDeviceRow, reason: DroppedReason): PushOutcome {
  return { kind: 'dropped', userId: device.userId, deviceId: device.id, reason };
}

// Lifts a promise-returning DB call the way `await` did: a DB failure rejects the
// boundary promise with the original error, identical and unwrapped. Only the
// calls whose old contract was "any throw becomes archive-unavailable" use a
// typed catch instead (see `newestMessageForUserEffect`).
const awaitDb = <A>(promise: () => Promise<A>): EffectType.Effect<A, never, never> =>
  Effect.promise(promise);

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
    // The row is gone: the API unsubscribed it (`DELETE /push/subscriptions`)
    // or T-1255's session-revoke cascade deleted it. Forget the node's dedupe
    // set so a removed device's ids do not accumulate for the process's life.
    deps.recentlyNotified.delete(notification.node);
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
            markPushFailed('archive-unavailable');
            deps.logger.warn(
              { userId: device.userId, deviceId: device.id },
              'push archive lookup failed; dropping the notification',
            );
            return dropped(device, 'archive-unavailable');
          }),
        SendFailed: () =>
          Effect.sync(() => {
            markPushFailed('send-failed');
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
    markPushSent();
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

// Opens a native device: the token is stored in the clear, so there is
// nothing to decrypt. A row whose kind and token disagree (impossible under
// migration 0047's `shape_check`, but a programming error if seen) is
// unusable and dropped like an undecryptable Web Push row.
const openNativeDeviceEffect = Effect.fnUntraced(function* (
  device: PushDeviceRow,
): EffectType.fn.Return<ReturnType<typeof openNativeDevice>, Undecryptable> {
  return yield* Effect.try({
    try: () => openNativeDevice(device),
    catch: () => new Undecryptable(),
  });
});

// The part of `NewestScan` (`archive-scan.ts`) the delivery half reads: the
// newest acceptable message (or none) and what made the scan stay silent.
// Declared structurally so this module stays independent of the scan.
export interface ScanResult {
  newest: { message: ResolvedPushMessage } | undefined;
  notify: string[];
  saw: 'muted' | 'hidden' | 'duplicate' | 'no-message';
}

const resolveAndSendEffect = Effect.fnUntraced(function* (
  deps: PushServiceDeps,
  device: PushDeviceRow,
  node: string,
): EffectType.fn.Return<PushOutcome, DeliveryError> {
  const scan = yield* newestMessageForUserEffect(deps, device.userId, node).pipe(
    // The old Promise version wrapped this whole call in a try/catch: any
    // throw from the scan — including a synchronous one in its own loop
    // bookkeeping when the archive answers something unexpected — became
    // `archive-unavailable`. A rejected promise is mapped inside the scan; a
    // defect is caught here so `handleIncomingPush` still never rejects.
    Effect.catchDefect(() => Effect.fail(new ArchiveUnavailable())),
  );
  return yield* deliverToDevice(deps, device, scan);
});

// The post-scan half of the pipeline, split out (and exported) so both
// delivery branches can be tested without the MAM archive. The scan already
// decided *whether* to notify — mute, visibility and the already-notified
// dedupe all ran there — so this only decides *how*: open the device for its
// kind, build that kind's payload, send, then remember the origin ids.
export const deliverToDevice = Effect.fnUntraced(function* (
  deps: PushServiceDeps,
  device: PushDeviceRow,
  scan: ScanResult,
): EffectType.fn.Return<PushOutcome, DeliveryError> {
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
  // Mute and visibility were already resolved by the scan, so both kinds pass
  // the same always-visible filter; only the preview setting differs, and only
  // the Web Push payload reads it.
  const filter = { muted: false, visible: true, showPreviews };
  let gone = false;
  if (device.kind === 'webpush') {
    const subscription = yield* openDeviceEffect(deps, device);
    const payload = buildPushPayload(newest.message, filter);
    if (payload === undefined) {
      return dropped(device, 'muted');
    }
    gone = yield* sendWithCleanupEffect(deps, device, () =>
      deps.sender.send(subscription, JSON.stringify(payload)),
    );
  } else {
    const nativeSender = deps.nativeSender;
    // No APNs sender exists yet, and FCM may be unconfigured: drop the wake
    // rather than guess. Ids only in the log.
    if (device.kind === 'apns' || nativeSender === undefined) {
      deps.logger.warn(
        { userId: device.userId, deviceId: device.id },
        'native push not configured; dropping the notification',
      );
      return dropped(device, 'send-failed');
    }
    const native = yield* openNativeDeviceEffect(device);
    const data = buildNativeWakePayload(newest.message, filter, deps.config.xmpp.domain);
    if (data === undefined) {
      return dropped(device, 'muted');
    }
    gone = yield* sendWithCleanupEffect(deps, device, () => nativeSender.send(native.token, data));
  }
  if (gone) {
    // The transport reported the subscription gone and its row was removed
    // (PERF-17): forget the node's dedupe set with it, and never mark ids for
    // a device that can no longer receive them.
    deps.recentlyNotified.delete(device.node);
  } else {
    // Marked only after a successful send. Per-node serialization keeps
    // concurrent IQs for one node ordered, so a retry cannot double-buzz:
    // the retry finds the origin id already seen and drops as `duplicate`.
    markNotified(deps, device.node, scan.notify, newest.message);
  }
  return { kind: 'sent', userId: device.userId, deviceId: device.id };
});

// Sends through one transport and runs the shared post-send bookkeeping: a
// `gone` result removes the device, and any throw stamps `failed_at` and
// answers the IQ with `SendFailed`. Both kinds share this one block, so Web
// Push and native cleanup cannot drift apart. Returns `true` when the
// subscription was gone, so the caller forgets the node instead of marking it
// notified (PERF-17).
const sendWithCleanupEffect = Effect.fnUntraced(function* (
  deps: PushServiceDeps,
  device: PushDeviceRow,
  send: () => Promise<{ gone: boolean }>,
): EffectType.fn.Return<boolean, SendFailed> {
  const now = (deps.now ?? (() => new Date()))();
  // The send and the `gone` cleanup share one `try`, exactly like the old
  // `try` block: any throw stamps `failed_at` and answers the IQ with a
  // result. A failure here is not marked notified (F3), so a retried publish
  // IQ for the same message still notifies.
  return yield* Effect.tryPromise({
    try: async () => {
      const result = await send();
      if (result.gone) {
        await removeDeviceByNode(deps.db, device.node);
        deps.logger.info(
          { userId: device.userId, deviceId: device.id },
          'push subscription expired; removed',
        );
      }
      return result.gone;
    },
    // The thrown error never leaves this module: only its short reason (the
    // FCM code or the HTTP status) is kept, to store with `failed_at`.
    catch: (error) => new SendFailed({ reason: pushFailureReason(error) }),
  }).pipe(
    Effect.catchTag('SendFailed', (failed) =>
      Effect.gen(function* () {
        yield* awaitDb(() => markDeviceFailed(deps.db, device.id, now, failed.reason));
        // Ids only: the error may echo the request, which carries the token
        // or the endpoint. The boundary logs the failure and returns the
        // dropped outcome.
        return yield* new SendFailed({ reason: failed.reason });
      }),
    ),
  );
});

// How many notified origin ids to remember per device node before
// forgetting the oldest (a retried publish IQ or a re-scan then stays
// silent for those).
const NOTIFIED_REMEMBERED = 500;

// Remembers origin ids as notified per device node, so a retried publish
// IQ or a later re-scan for the same node stays silent. A delivered album
// also remembers its sender key, so a sibling row landing in a later page is
// deduped too (T-1270). Capped per node.
function markNotified(
  deps: PushServiceDeps,
  node: string,
  originIds: string[],
  message: ResolvedPushMessage,
): void {
  let seen = deps.recentlyNotified.get(node);
  if (seen === undefined) {
    seen = new Set();
    deps.recentlyNotified.set(node, seen);
  }
  for (const originId of originIds) {
    seen.add(originId);
  }
  const key = albumKey(message);
  if (key !== undefined) {
    seen.add(key);
  }
  if (seen.size > NOTIFIED_REMEMBERED) {
    const fresh = [...seen].slice(seen.size - NOTIFIED_REMEMBERED);
    deps.recentlyNotified.set(node, new Set(fresh));
  }
}
