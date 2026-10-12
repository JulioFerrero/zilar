// The web twin of mobile's `ensurePushPair` (T-1152): ejabberd binds the
// XEP-0357 pair to the c2s session that sent `<enable/>`, so a reload that
// opens a new session has a dead pair pushing into a focused tab (MP-8). On
// every transition into `online`, when `deviceStorage` holds a device and the
// browser already granted the permission, re-send the enable for its node.
// The narrow injectable surface mirrors `@/lib/push`, so the tests run with
// fakes and never touch the real config endpoint.
import { Duration, Effect } from 'effect';
import type { PushConfig } from '@/lib/api';
import { getPushConfig } from '@/lib/api';
import type { StoreApi } from '@/store/atomStore';
import type { ChatStoreState } from '@/store/store';
import { readStoredDevice, writeStoredDevice, type StoredDevice } from './deviceStorage';

export interface PushPairInput {
  pushJid: string;
  node: string;
  enable: boolean;
}

export type SetPushPair = (input: PushPairInput) => Promise<void>;

export interface SessionEnableDeps {
  setPushPair?: SetPushPair;
  readDevice?: () => StoredDevice | null;
  clearDevice?: () => void;
  permission?: () => string;
  getConfig?: () => Promise<PushConfig>;
}

// The store pieces `startSessionEnable` reads. `StoreApi<ChatStoreState>`
// satisfies this, and the test builds a smaller one.
export interface SessionEnableStore {
  getState: () => { status: string };
  subscribe: (listener: (state: { status: string }) => void) => () => void;
}

// The push JID comes from the same push-config call the Enable button uses
// (`usePushEnable.ts` `enableOnThisDevice` reads `getPushConfig()` for the
// vapid key, and `disableOnThisDevice` reads `config.pushJid`). The page
// lifetime is one, and the JID never changes under it, so cache it here.
let cachedPushJid: string | undefined;

/** The cached push JID, fetching it once from the push config on first use. */
const readPushJid = (getConfig: () => Promise<PushConfig>): Effect.Effect<string, unknown> =>
  cachedPushJid !== undefined
    ? Effect.succeed(cachedPushJid)
    : Effect.tryPromise({
        try: () => getConfig(),
        catch: (error) => error,
      }).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => console.warn('push: could not read the push config', error)),
        ),
        Effect.map((config) => {
          cachedPushJid = config.pushJid;
          return config.pushJid;
        }),
      );

function readPermission(): string {
  return typeof Notification === 'undefined' ? 'default' : Notification.permission;
}

/**
 * Sends `<enable/>` for the stored device on a fresh session. Needs a pair
 * sender; does nothing without a stored device, without a granted
 * permission, or without a push JID. A failed enable is retried on the next
 * transition into `online` (MP-13).
 */
export const enableSessionPush = Effect.fnUntraced(function* (
  deps: SessionEnableDeps & { setPushPair: SetPushPair },
) {
  const {
    setPushPair,
    readDevice = readStoredDevice,
    permission = readPermission,
    getConfig = getPushConfig,
  } = deps;
  const device = readDevice();
  if (device === null) {
    return;
  }
  if (permission() !== 'granted') {
    return;
  }
  const pushJid = yield* readPushJid(getConfig).pipe(Effect.option);
  if (pushJid._tag === 'None') {
    return;
  }
  yield* Effect.tryPromise({
    try: () => setPushPair({ pushJid: pushJid.value, node: device.node, enable: true }),
    catch: (error) => error,
  });
});

/**
 * Sends `<disable/>` for the stored device, best effort with a 2 s timeout
 * for the sign-out path (the stale pair must not ring for a signed-out
 * account). Does nothing without a stored device or without a push JID.
 * The stored handle is always cleared afterwards, like mobile's
 * `unregisterNativePush`: a shared browser must not re-enable the previous
 * user's node on the next account's first transition into `online`.
 */
export const disableSessionPush = Effect.fnUntraced(function* (
  deps: SessionEnableDeps & { setPushPair: SetPushPair; timeoutMs?: number },
) {
  const {
    setPushPair,
    readDevice = readStoredDevice,
    clearDevice = () => writeStoredDevice(null),
    getConfig = getPushConfig,
    timeoutMs = 2000,
  } = deps;
  const device = readDevice();
  if (device === null) {
    return;
  }
  // The whole body, config read included, runs under the one timeout: a
  // stalled push-config response must not hold sign-out past `timeoutMs`.
  // The `ensuring` clears the handle even when the JID read misses, so the
  // docstring's "always cleared" holds for every stored device.
  yield* Effect.gen(function* () {
    const pushJid = yield* readPushJid(getConfig).pipe(Effect.option);
    if (pushJid._tag === 'None') {
      return;
    }
    yield* Effect.tryPromise({
      try: () => setPushPair({ pushJid: pushJid.value, node: device.node, enable: false }),
      catch: (error) => error,
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => console.warn('push: the session could not disable push', error)),
      ),
      Effect.ignore,
    );
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(timeoutMs),
      orElse: () => Effect.void,
    }),
    Effect.ensuring(Effect.sync(clearDevice)),
  );
});

/**
 * Re-enables the stored pair on every transition into `online`. A failed
 * enable is logged (never the node) and retried on the next transition
 * (MP-13). Returns the unsubscribe for the provider's effect cleanup.
 */
export function startSessionEnable(
  store: StoreApi<ChatStoreState> | SessionEnableStore,
  deps: SessionEnableDeps = {},
): () => void {
  // The default without an explicit pair sender reads it from the real
  // store's state; a test passes both store and sender as narrow fakes.
  const { setPushPair = (input) => defaultSetPushPair(store, input), ...rest } = deps;
  const watched = store as SessionEnableStore;
  let online = watched.getState().status === 'online';
  return watched.subscribe((state) => {
    const nowOnline = state.status === 'online';
    const entered = nowOnline && !online;
    online = nowOnline;
    if (!entered) {
      return;
    }
    void Effect.runFork(runSessionEnable({ ...rest, setPushPair }));
  });
}

/**
 * One transition's re-enable: the enable itself, with its failure logged
 * (never the node) for the next transition's retry (MP-13).
 */
const runSessionEnable = (deps: SessionEnableDeps & { setPushPair: SetPushPair }) =>
  enableSessionPush(deps).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => console.warn('push: the session could not re-enable push', error)),
    ),
    Effect.catchCause(() => Effect.void),
  );

/** The real store's pair sender, for the provider's default wiring. */
function defaultSetPushPair(
  store: StoreApi<ChatStoreState> | SessionEnableStore,
  input: PushPairInput,
): Promise<void> {
  return (store as StoreApi<ChatStoreState>).getState().setPushPair(input);
}
