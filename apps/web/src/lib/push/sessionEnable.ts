// ejabberd binds the XEP-0357 pair to the c2s session that sent <enable/>, so a reload that
// opens a new session leaves a dead pair pushing into a focused tab. On every transition into
// online, re-send the enable for the stored device's node.
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

export interface SessionEnableStore {
  getState: () => { status: string };
  subscribe: (listener: (state: { status: string }) => void) => () => void;
}

// The JID never changes under the page's lifetime, so cache it here.
let cachedPushJid: string | undefined;

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

/** Does nothing without a stored device, a granted permission and a push JID; a failure
 * retries on the next transition into online. */
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

/** Best effort with a 2 s timeout for sign-out, so a stale pair must not ring a signed-out
 * account. The stored handle is always cleared: a shared browser must not re-enable the
 * previous user's node on the next account's first online. */
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
  // The whole body runs under one timeout, and ensuring clears the handle even when the JID read misses.
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

/** A failed enable is logged (never the node) and retried on the next transition into online. */
export function startSessionEnable(
  store: StoreApi<ChatStoreState> | SessionEnableStore,
  deps: SessionEnableDeps = {},
): () => void {
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

/** One transition's re-enable, with its failure logged (never the node) for the next retry. */
const runSessionEnable = (deps: SessionEnableDeps & { setPushPair: SetPushPair }) =>
  enableSessionPush(deps).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => console.warn('push: the session could not re-enable push', error)),
    ),
    Effect.catchCause(() => Effect.void),
  );

function defaultSetPushPair(
  store: StoreApi<ChatStoreState> | SessionEnableStore,
  input: PushPairInput,
): Promise<void> {
  return (store as StoreApi<ChatStoreState>).getState().setPushPair(input);
}
