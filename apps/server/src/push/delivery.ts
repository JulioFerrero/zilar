import { Effect, type Effect as EffectType } from 'effect';
import { markPushFailed, markPushSent } from '../health-status';
import { albumKey } from './album-key';
import { newestMessageForUserEffect } from './archive-scan';
import { FcmSendError } from './fcm';
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

type DeliveryError = Undecryptable | ArchiveUnavailable | SendFailed;

type DroppedReason = Extract<PushOutcome, { kind: 'dropped' }>['reason'];

type OpenDevice = ReturnType<typeof openDevice>;

function dropped(device: PushDeviceRow, reason: DroppedReason): PushOutcome {
  return { kind: 'dropped', userId: device.userId, deviceId: device.id, reason };
}

const awaitDb = <A>(promise: () => Promise<A>): EffectType.Effect<A, never, never> =>
  Effect.promise(promise);

// Handles one publish IQ for one device: resolves the newest message,
// applies mute/visibility, sends. Never throws: every failure answers
// `result` and logs ids only, never message text or endpoint URLs.
export async function handleIncomingPush(
  deps: PushServiceDeps,
  notification: PushNotification,
): Promise<PushOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const device = await deviceByNode(deps.db, notification.node);
  if (device === undefined) {
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

// Opens a native device: the token is in the clear, so nothing to decrypt.
// A row whose kind and token disagree is unusable and dropped.
const openNativeDeviceEffect = Effect.fnUntraced(function* (
  device: PushDeviceRow,
): EffectType.fn.Return<ReturnType<typeof openNativeDevice>, Undecryptable> {
  return yield* Effect.try({
    try: () => openNativeDevice(device),
    catch: () => new Undecryptable(),
  });
});

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
    Effect.catchDefect(() => Effect.fail(new ArchiveUnavailable())),
  );
  return yield* deliverToDevice(deps, device, scan);
});

export const deliverToDevice = Effect.fnUntraced(function* (
  deps: PushServiceDeps,
  device: PushDeviceRow,
  scan: ScanResult,
): EffectType.fn.Return<PushOutcome, DeliveryError> {
  const newest = scan.newest;
  if (newest === undefined) {
    const reason =
      scan.saw === 'muted' || scan.saw === 'hidden' || scan.saw === 'no-message'
        ? scan.saw
        : 'duplicate';
    return dropped(device, reason);
  }

  const showPreviews = yield* awaitDb(() => showPreviewsForUser(deps.db, device.userId));
  // Mute and visibility were resolved by the scan, so both kinds pass the same
  // filter; only the preview setting differs, and only Web Push reads it.
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
    deps.recentlyNotified.delete(device.node);
  } else {
    // Marked only after a successful send; per-node serialization makes a retry
    // find the origin id already seen and drop as `duplicate`.
    markNotified(deps, device.node, scan.notify, newest.message);
  }
  return { kind: 'sent', userId: device.userId, deviceId: device.id };
});

// Sends through one transport and runs the shared post-send bookkeeping:
// `gone` removes the device, a throw stamps `failed_at` and answers
// `SendFailed`. Returns `true` when gone, so the caller forgets the node.
const sendWithCleanupEffect = Effect.fnUntraced(function* (
  deps: PushServiceDeps,
  device: PushDeviceRow,
  send: () => Promise<{ gone: boolean }>,
): EffectType.fn.Return<boolean, SendFailed> {
  const now = (deps.now ?? (() => new Date()))();
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
    // The thrown error never leaves this module, and the raw HTTP status and
    // transport codes are dropped: a hostile endpoint must not reflect a status
    // back to the user, and the reason is all the device list needs.
    catch: (error) => new SendFailed({ reason: fixedFailureReason(error) }),
  }).pipe(
    Effect.catchTag('SendFailed', (failed) =>
      Effect.gen(function* () {
        yield* awaitDb(() => markDeviceFailed(deps.db, device.id, now, failed.reason));
        return yield* new SendFailed({ reason: failed.reason });
      }),
    ),
  );
});

// The fixed reasons stored with `failed_at`: an answering service is
// `rejected`, an exhausted socket `timeout`, everything else `unreachable`.
// Raw status, endpoint and token never reach the column or a log.
type FailureReason = 'rejected' | 'timeout' | 'unreachable';

function fixedFailureReason(error: unknown): FailureReason {
  if (error instanceof FcmSendError) {
    return 'rejected';
  }
  if (isTimeout(error)) {
    return 'timeout';
  }
  if (hasStatusCode(error)) {
    return 'rejected';
  }
  return 'unreachable';
}

function isTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code, name, message } = error as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
  };
  return code === 'ETIMEDOUT' || name === 'TimeoutError' || message === 'Socket timeout';
}

function hasStatusCode(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  return typeof (error as { statusCode?: unknown }).statusCode === 'number';
}

const NOTIFIED_REMEMBERED = 500;

// Remembers origin ids as notified per node, so a retried IQ or re-scan
// stays silent. An album also remembers its sender key, so a later-page
// sibling is deduped. Capped per node.
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
