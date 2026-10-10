import { useState } from 'react';
import { Effect } from 'effect';
import {
  getPushConfig,
  getPushSettings,
  listPushDevices,
  registerPushDevice,
  removePushDevice,
  sendTestPushNotification,
  setPushSettings,
  type PushDevice,
  type RegisteredDevice,
} from '@/lib/api';
import {
  deviceLabel,
  permissionStateOf,
  pushSupport,
  realPushBrowser,
  subscribeBrowser,
  unsubscribeBrowser,
  type NotificationPermissionState,
} from '@/lib/push';
import { fromApi } from '@/lib/effect/api-effect';
import { ApiFailure } from '@/lib/effect/errors';
import { useQuery } from '@/lib/effect/use-query';
import { readStoredDevice, writeStoredDevice, type StoredDevice } from '@/lib/push/deviceStorage';
import {
  attempt,
  friendlyError,
  quietly,
  runPageAction,
  withPermissionAnswer,
} from '@/lib/push/pageActions';
import { useChatStoreApi } from '@/store/ChatStoreProvider';

type PageStatus = 'loading' | 'ready' | 'unsupported' | 'server-off';

export interface PushEnable {
  status: PageStatus;
  devices: PushDevice[];
  showPreviews: boolean;
  storedDevice: StoredDevice | null;
  permission: NotificationPermissionState | 'unsupported';
  busy: boolean;
  testing: boolean;
  testSent: boolean;
  errorMessage: string;
  enableOnThisDevice: () => void;
  disableOnThisDevice: () => void;
  removeOtherDevice: (id: string) => void;
  togglePreviews: (value: boolean) => void;
  sendTest: () => void;
}

/** The push page's state and actions, moved out of NotificationsPage (T-0119). */
export function usePushEnable(): PushEnable {
  const storeApi = useChatStoreApi();
  const [loadedStatus, setStatus] = useState<PageStatus>('loading');
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [showPreviews, setShowPreviews] = useState(true);
  const [permission, setPermission] = useState<NotificationPermissionState | 'unsupported'>(
    'default',
  );
  const [storedDevice, setStoredDevice] = useState<StoredDevice | null>(() => readStoredDevice());
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const supported =
    pushSupport({
      serviceWorker: typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
      PushManager: typeof window !== 'undefined' ? window.PushManager : undefined,
    }) === 'supported';
  const status: PageStatus = supported ? loadedStatus : 'unsupported';

  // The first load (and a change of support). Every state change is a setter
  // call inside the Effect; a failure becomes the page message.
  const loadPage = (): Effect.Effect<void, unknown> => {
    if (!supported) {
      return Effect.void;
    }
    return Effect.gen(function* () {
      const permissionNow = permissionStateOf({
        Notification: typeof Notification === 'undefined' ? undefined : Notification,
      });
      const served = yield* fromApi(() => getPushConfig()).pipe(
        Effect.as(true),
        Effect.catchIf(
          (failure: ApiFailure) => failure.status === 404 || failure.code === 'push_unavailable',
          () => Effect.succeed(false),
        ),
      );
      if (!served) {
        yield* Effect.sync(() => setStatus('server-off'));
        return;
      }
      const [loadedDevices, settings] = yield* Effect.all(
        [fromApi(() => listPushDevices()), fromApi(() => getPushSettings())],
        { concurrency: 'unbounded' },
      );
      const stored = readStoredDevice();
      const kept =
        stored !== null && loadedDevices.some((device) => device.id === stored.id) ? stored : null;
      if (stored !== null && kept === null) {
        writeStoredDevice(null);
      }
      yield* Effect.sync(() => {
        setDevices(loadedDevices);
        setShowPreviews(settings.showPreviews);
        setPermission(permissionNow);
        setStoredDevice(kept);
        setStatus('ready');
      });
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          setErrorMessage(friendlyError(error));
          setStatus('ready');
        }),
      ),
    );
  };
  useQuery(loadPage, [supported]);

  const refreshDevices = fromApi(() => listPushDevices()).pipe(
    Effect.map((list) => setDevices(list)),
  );

  const enableOnThisDevice = (): void => {
    setBusy(true);
    setErrorMessage('');
    setTestSent(false);
    const browser = realPushBrowser();
    if (browser === undefined) {
      setStatus('unsupported');
      setBusy(false);
      return;
    }
    // The permission prompt is asked here, inside the click: browsers ignore
    // it anywhere else. The subscribe step below awaits this same answer.
    const asked = withPermissionAnswer(browser, browser.Notification.requestPermission());
    runPageAction(
      Effect.gen(function* () {
        const config = yield* fromApi(() => getPushConfig());
        const { subscription } = yield* attempt(() =>
          subscribeBrowser(asked, config.vapidPublicKey),
        );
        const registered: RegisteredDevice = yield* fromApi(() =>
          registerPushDevice({
            endpoint: subscription.endpoint,
            keys: subscription.keys,
            userAgent: deviceLabel(),
          }),
        ).pipe(
          // The server row was never created, but the browser subscription
          // above is live: remove it so a failed registration leaves no
          // orphaned PushManager subscription behind (N2).
          Effect.tapError(() => quietly(attempt(() => unsubscribeBrowser(browser)))),
        );
        yield* attempt(() =>
          storeApi
            .getState()
            .setPushPair({ pushJid: registered.jid, node: registered.node, enable: true }),
        ).pipe(
          // The enable IQ needs a live XMPP session: without it the device
          // would never ring, so roll everything back instead of orphaning
          // it — the server row and the browser subscription (F6).
          Effect.tapError(() =>
            quietly(fromApi(() => removePushDevice(registered.id))).pipe(
              Effect.andThen(quietly(attempt(() => unsubscribeBrowser(browser)))),
            ),
          ),
        );
        const stored = { id: registered.id, node: registered.node };
        yield* Effect.sync(() => {
          writeStoredDevice(stored);
          setStoredDevice(stored);
          setPermission(browser.Notification.permission);
        });
        yield* refreshDevices;
      }).pipe(Effect.ensuring(Effect.sync(() => setBusy(false)))),
      setErrorMessage,
    );
  };

  const disableOnThisDevice = (): void => {
    if (storedDevice === null) {
      return;
    }
    const device = storedDevice;
    setBusy(true);
    setErrorMessage('');
    setTestSent(false);
    runPageAction(
      Effect.gen(function* () {
        const browser = realPushBrowser();
        if (browser !== undefined) {
          const config = yield* fromApi(() => getPushConfig()).pipe(
            Effect.orElseSucceed(() => null),
          );
          if (config !== null) {
            // Best effort: the row is removed below either way.
            yield* quietly(
              attempt(() =>
                storeApi
                  .getState()
                  .setPushPair({ pushJid: config.pushJid, node: device.node, enable: false }),
              ),
            );
          }
          yield* quietly(attempt(() => unsubscribeBrowser(browser)));
        }
        yield* fromApi(() => removePushDevice(device.id)).pipe(
          Effect.catchIf(
            (failure: ApiFailure) => failure.status === 404,
            () => Effect.void,
          ),
        );
        writeStoredDevice(null);
        setStoredDevice(null);
        yield* refreshDevices;
      }).pipe(Effect.ensuring(Effect.sync(() => setBusy(false)))),
      setErrorMessage,
    );
  };

  const removeOtherDevice = (id: string): void => {
    setErrorMessage('');
    runPageAction(
      fromApi(() => removePushDevice(id)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            // Removing this device from the list clears the local handle too —
            // otherwise the page would keep offering Disable/Test for a row that
            // no longer exists until the next load reconciles it.
            if (storedDevice !== null && storedDevice.id === id) {
              writeStoredDevice(null);
              setStoredDevice(null);
            }
          }),
        ),
        Effect.andThen(refreshDevices),
      ),
      setErrorMessage,
    );
  };

  const togglePreviews = (value: boolean): void => {
    setErrorMessage('');
    const previous = showPreviews;
    setShowPreviews(value);
    runPageAction(
      fromApi(() => setPushSettings(value)).pipe(
        Effect.tapError(() => Effect.sync(() => setShowPreviews(previous))),
      ),
      setErrorMessage,
    );
  };

  const sendTest = (): void => {
    if (storedDevice === null) {
      return;
    }
    const device = storedDevice;
    setTesting(true);
    setTestSent(false);
    setErrorMessage('');
    runPageAction(
      fromApi(() => sendTestPushNotification(device.id)).pipe(
        Effect.tap(() => Effect.sync(() => setTestSent(true))),
        Effect.ensuring(Effect.sync(() => setTesting(false))),
      ),
      setErrorMessage,
    );
  };

  return {
    status,
    devices,
    showPreviews,
    storedDevice,
    permission,
    busy,
    testing,
    testSent,
    errorMessage,
    enableOnThisDevice,
    disableOnThisDevice,
    removeOtherDevice,
    togglePreviews,
    sendTest,
  };
}
