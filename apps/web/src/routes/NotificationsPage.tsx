import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Effect, Schema } from 'effect';
import { Bell, BellOff } from 'lucide-react';
import {
  ApiError,
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
  isIosDevice,
  isStandaloneDisplay,
  permissionStateOf,
  pushSupport,
  realPushBrowser,
  subscribeBrowser,
  unsubscribeBrowser,
  type NotificationPermissionState,
  type PushBrowser,
} from '@/lib/push';
import { fromApi } from '@/lib/effect/api-effect';
import { ApiFailure } from '@/lib/effect/errors';
import { useQuery } from '@/lib/effect/use-query';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { Button } from '@/components/ui/button';
import { Card, SectionLabel } from '@/components/ui/card';
import { StateMessage } from '@/components/ui/state-message';
import { Switch } from '@/components/ui/switch';
import { useChatStoreApi } from '@/store/ChatStoreProvider';

const DEVICE_KEY = 'zilar:pushDevice';

interface StoredDevice {
  id: string;
  node: string;
}

// The stored handle is a JSON object with a string id and node; anything else reads as none.
const decodeStoredDevice = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String, node: Schema.String })),
);

/** Reads the stored handle at this sync edge. A blocked or corrupt storage reads as none. */
function readStoredDevice(): StoredDevice | null {
  return Effect.runSync(
    Effect.try(() => {
      const raw = window.localStorage.getItem(DEVICE_KEY);
      return raw === null ? null : decodeStoredDevice(raw);
    }).pipe(Effect.orElseSucceed(() => null)),
  );
}

function writeStoredDevice(device: StoredDevice | null): void {
  // A blocked storage must never break the page.
  Effect.runSync(
    Effect.try(() => {
      if (device === null) {
        window.localStorage.removeItem(DEVICE_KEY);
      } else {
        window.localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
      }
    }).pipe(Effect.orElseSucceed(() => undefined)),
  );
}

/** A browser or store Promise. Its own error reaches friendlyError unchanged. */
function attempt<A>(run: () => Promise<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: run, catch: (error: unknown) => error });
}

/** Best effort: a failure here never reaches the page message. */
function quietly<A>(effect: Effect.Effect<A, unknown>): Effect.Effect<void> {
  return effect.pipe(Effect.orElseSucceed(() => undefined));
}

/**
 * Starts a page action in the background. It is not tied to the page's life:
 * leaving the page does not cancel a subscribe, a registration or a rollback
 * in flight. Its failure becomes the page message.
 */
function runPageAction(
  effect: Effect.Effect<void, unknown>,
  showError: (message: string) => void,
): void {
  Effect.runFork(
    effect.pipe(
      Effect.tapError((error) => Effect.sync(() => showError(friendlyError(error)))),
      Effect.catchCause(() => Effect.void),
    ),
  );
}

/** The same browser, with the permission step answered by a prompt already asked for. */
function withPermissionAnswer(
  browser: PushBrowser,
  answer: Promise<NotificationPermissionState>,
): PushBrowser {
  return {
    serviceWorker: browser.serviceWorker,
    Notification: {
      get permission() {
        return browser.Notification.permission;
      },
      requestPermission: () => answer,
    },
  };
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiFailure || error instanceof ApiError) {
    if (error.code === 'rate_limited') {
      return 'Too many tries — wait a little and try again.';
    }
    if (error.code === 'device_gone') {
      return 'That device stopped receiving push. Remove it and enable again.';
    }
    if (error.code === 'push_unavailable') {
      return 'Push is not configured on this server yet.';
    }
    return error.message;
  }
  if (error instanceof Error) {
    if (error.message.startsWith('notification permission')) {
      return 'The browser did not grant permission. Allow notifications for this site, then try again.';
    }
    if (error.message.includes('cannot toggle push')) {
      return 'The chat connection is offline. Open Zilar, wait for it to connect, then try again.';
    }
    return error.message;
  }
  return 'Something went wrong. Try again.';
}

type PageStatus = 'loading' | 'ready' | 'unsupported' | 'server-off';

/** Settings → Notifications. Enable on this device, devices, previews, test. */
export function NotificationsPage() {
  const navigate = useNavigate();
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

  const thisDevice =
    storedDevice === null ? undefined : devices.find((entry) => entry.id === storedDevice.id);
  // The "This device" card names the state in words (T-0153): the support
  // check already splits unsupported browsers and servers into their own
  // page states above, so here only permission and registration remain.
  const deviceState: 'Enabled' | 'Not enabled' | 'Blocked by the browser' =
    thisDevice !== undefined
      ? 'Enabled'
      : permission === 'denied'
        ? 'Blocked by the browser'
        : 'Not enabled';
  const deviceStateDetail =
    thisDevice !== undefined
      ? thisDevice.inactive
        ? 'On, but inactive — nothing received in 90 days.'
        : 'Push is on for this device.'
      : permission === 'denied'
        ? 'Allow notifications for this site in the browser settings, then come back and enable.'
        : 'Turn on push for this browser.';
  const showIosHint =
    status === 'ready' &&
    isIosDevice() &&
    !isStandaloneDisplay({
      matchMedia: (query) => window.matchMedia(query),
      standalone: (window.navigator as { standalone?: boolean }).standalone,
    });

  return (
    <SettingsShell
      title="Notifications"
      subtitle="Push this device when a message arrives."
      onBack={() => navigate('/')}
    >
      <div className={SETTINGS_COLUMN}>
        {status === 'loading' && (
          <StateMessage kind="loading" title="Loading notification settings…" />
        )}
        {status === 'unsupported' && (
          <section aria-label="Notifications on this device" className="flex flex-col gap-2">
            <SectionLabel>This device</SectionLabel>
            <Card className="divide-divider">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block text-[15px] font-medium">Not supported</span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground">
                    Push notifications are not supported in this browser. Try a recent Chrome, Edge,
                    Firefox or Safari.
                  </span>
                </span>
              </div>
            </Card>
          </section>
        )}
        {status === 'server-off' && (
          <section aria-label="Notifications on this device" className="flex flex-col gap-2">
            <SectionLabel>This device</SectionLabel>
            <Card className="divide-divider">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block text-[15px] font-medium">Not available</span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground">
                    Push notifications are not enabled on this server yet.
                  </span>
                </span>
              </div>
            </Card>
          </section>
        )}
        {status === 'ready' && (
          <div className="flex flex-col gap-4">
            {showIosHint && (
              <p className="rounded-xl border border-border bg-surface-raised p-3 text-[14px]">
                On iPhone, push needs the installed app (iOS 16.4+): open the Share menu, choose
                “Add to Home Screen”, then open Zilar from the home screen and enable below.
              </p>
            )}
            <section aria-label="Notifications on this device" className="flex flex-col gap-2">
              <SectionLabel>This device</SectionLabel>
              <Card className="divide-divider">
                <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="block text-[15px] font-medium">{deviceState}</span>
                    <span className="mt-0.5 block text-[13px] text-muted-foreground">
                      {deviceStateDetail}
                    </span>
                  </span>
                  {thisDevice === undefined ? (
                    <Button type="button" onClick={() => enableOnThisDevice()} disabled={busy}>
                      <Bell className="size-4" aria-hidden="true" />
                      {busy ? 'Enabling…' : 'Enable on this device'}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => disableOnThisDevice()}
                      disabled={busy}
                    >
                      <BellOff className="size-4" aria-hidden="true" />
                      {busy ? 'Disabling…' : 'Disable'}
                    </Button>
                  )}
                </div>
              </Card>
            </section>
            <section aria-label="Devices" className="flex flex-col gap-2">
              <SectionLabel>Devices</SectionLabel>
              {devices.length === 0 ? (
                <p className="text-[14px] text-muted-foreground">No devices yet.</p>
              ) : (
                <Card>
                  <ul className="divide-y divide-divider">
                    {devices.map((device) => (
                      <li key={device.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1 basis-40 text-[14px]">
                          <p className="truncate text-[15px] font-medium">
                            {device.userAgent ?? 'Unknown device'}
                            {storedDevice !== null && device.id === storedDevice.id
                              ? ' (this device)'
                              : ''}
                          </p>
                          <p className="mt-0.5 text-[13px] text-muted-foreground">
                            Added {new Date(device.createdAt).toLocaleDateString()}
                            {device.inactive ? ' · inactive' : ''}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeOtherDevice(device.id)}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </section>
            <section aria-label="Message previews" className="flex flex-col gap-2">
              <SectionLabel>Message previews</SectionLabel>
              <Card className="divide-divider">
                <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <Switch
                    checked={showPreviews}
                    onCheckedChange={(value) => togglePreviews(value)}
                    label="Show the first lines of new messages in notifications"
                  />
                </div>
              </Card>
              <p className="text-[13px] text-muted-foreground">
                Off means who and where only — never message text.
              </p>
            </section>
            <section aria-label="Test" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionLabel>Test</SectionLabel>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => sendTest()}
                  disabled={testing || storedDevice === null}
                >
                  {testing ? 'Sending…' : 'Send a test notification'}
                </Button>
              </div>
              {testSent && (
                <p className="text-[14px] text-muted-foreground">
                  Sent — close this tab to see it.
                </p>
              )}
            </section>
            {errorMessage !== '' && (
              <p role="alert" className="text-[14px] text-danger">
                {errorMessage}
              </p>
            )}
          </div>
        )}
      </div>
    </SettingsShell>
  );
}
