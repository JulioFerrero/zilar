import { Effect, type Effect as EffectType } from 'effect';
import { newestMessageForUserEffect } from './archive-scan';
import { buildPushPayload, type PushPayload } from './payload';
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
