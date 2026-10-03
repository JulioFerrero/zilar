import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
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
} from '@/lib/push';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { Button } from '@/components/ui/button';
import { useChatStoreApi } from '@/store/ChatStoreProvider';

const DEVICE_KEY = 'zilar:pushDevice';

interface StoredDevice {
  id: string;
  node: string;
}

function readStoredDevice(): StoredDevice | null {
  try {
    const raw = window.localStorage.getItem(DEVICE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as { id?: unknown }).id === 'string' &&
      typeof (parsed as { node?: unknown }).node === 'string'
    ) {
      return parsed as StoredDevice;
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredDevice(device: StoredDevice | null): void {
  try {
    if (device === null) {
      window.localStorage.removeItem(DEVICE_KEY);
    } else {
      window.localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
    }
  } catch {
    // A blocked storage must never break the page.
  }
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
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
  const [status, setStatus] = useState<PageStatus>('loading');
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

  type PageData =
    | { status: 'unsupported' }
    | { status: 'server-off' }
    | {
        status: 'ready';
        devices: PushDevice[];
        showPreviews: boolean;
        permission: NotificationPermissionState | 'unsupported';
        storedDevice: StoredDevice | null;
      };

  // Pure data load: every state change happens in the effect's `.then`
  // below (the lint rule forbids setState inside this callback).
  const load = useCallback(async (): Promise<PageData> => {
    if (!supported) {
      return { status: 'unsupported' };
    }
    const permission = permissionStateOf({
      Notification: typeof Notification === 'undefined' ? undefined : Notification,
    });
    try {
      await getPushConfig();
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 404 || error.code === 'push_unavailable')
      ) {
        return { status: 'server-off' };
      }
      throw error;
    }
    const [devices, settings] = await Promise.all([listPushDevices(), getPushSettings()]);
    const stored = readStoredDevice();
    const kept =
      stored !== null && devices.some((device) => device.id === stored.id) ? stored : null;
    if (stored !== null && kept === null) {
      writeStoredDevice(null);
    }
    return {
      status: 'ready',
      devices,
      showPreviews: settings.showPreviews,
      permission,
      storedDevice: kept,
    };
  }, [supported]);

  useEffect(() => {
    let active = true;
    load()
      .then((data) => {
        if (!active) {
          return;
        }
        if (data.status !== 'ready') {
          setStatus(data.status);
          return;
        }
        setDevices(data.devices);
        setShowPreviews(data.showPreviews);
        setPermission(data.permission);
        setStoredDevice(data.storedDevice);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (active) {
          setErrorMessage(friendlyError(error));
          setStatus('ready');
        }
      });
    return () => {
      active = false;
    };
  }, [load]);

  const refreshDevices = async (): Promise<void> => {
    setDevices(await listPushDevices());
  };

  const enableOnThisDevice = async (): Promise<void> => {
    setBusy(true);
    setErrorMessage('');
    setTestSent(false);
    try {
      const browser = realPushBrowser();
      if (browser === undefined) {
        setStatus('unsupported');
        return;
      }
      const config = await getPushConfig();
      // The permission prompt fires only from this click (browsers ignore
      // it anywhere else).
      const { subscription } = await subscribeBrowser(browser, config.vapidPublicKey);
      let registered: RegisteredDevice;
      try {
        registered = await registerPushDevice({
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          userAgent: deviceLabel(),
        });
      } catch (registerError) {
        // The server row was never created, but the browser subscription
        // above is live: remove it so a failed registration leaves no
        // orphaned PushManager subscription behind (N2).
        await unsubscribeBrowser(browser).catch(() => undefined);
        throw registerError;
      }
      try {
        await storeApi
          .getState()
          .setPushPair({ pushJid: registered.jid, node: registered.node, enable: true });
      } catch (pairError) {
        // The enable IQ needs a live XMPP session: without it the device
        // would never ring, so roll everything back instead of orphaning
        // it — the server row and the browser subscription (F6).
        await removePushDevice(registered.id).catch(() => undefined);
        await unsubscribeBrowser(browser).catch(() => undefined);
        throw pairError;
      }
      const stored = { id: registered.id, node: registered.node };
      writeStoredDevice(stored);
      setStoredDevice(stored);
      setPermission(browser.Notification.permission);
      await refreshDevices();
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const disableOnThisDevice = async (): Promise<void> => {
    if (storedDevice === null) {
      return;
    }
    setBusy(true);
    setErrorMessage('');
    setTestSent(false);
    try {
      const browser = realPushBrowser();
      if (browser !== undefined) {
        const config = await getPushConfig().catch(() => null);
        if (config !== null) {
          // Best effort: the row is removed below either way.
          await storeApi
            .getState()
            .setPushPair({ pushJid: config.pushJid, node: storedDevice.node, enable: false })
            .catch(() => undefined);
        }
        await unsubscribeBrowser(browser).catch(() => undefined);
      }
      await removePushDevice(storedDevice.id).catch((error: unknown) => {
        if (!(error instanceof ApiError) || error.status !== 404) {
          throw error;
        }
      });
      writeStoredDevice(null);
      setStoredDevice(null);
      await refreshDevices();
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const removeOtherDevice = async (id: string): Promise<void> => {
    setErrorMessage('');
    try {
      await removePushDevice(id);
      // Removing this device from the list clears the local handle too —
      // otherwise the page would keep offering Disable/Test for a row that
      // no longer exists until the next load reconciles it.
      if (storedDevice !== null && storedDevice.id === id) {
        writeStoredDevice(null);
        setStoredDevice(null);
      }
      await refreshDevices();
    } catch (error) {
      setErrorMessage(friendlyError(error));
    }
  };

  const togglePreviews = async (value: boolean): Promise<void> => {
    setErrorMessage('');
    const previous = showPreviews;
    setShowPreviews(value);
    try {
      await setPushSettings(value);
    } catch (error) {
      setShowPreviews(previous);
      setErrorMessage(friendlyError(error));
    }
  };

  const sendTest = async (): Promise<void> => {
    if (storedDevice === null) {
      return;
    }
    setTesting(true);
    setTestSent(false);
    setErrorMessage('');
    try {
      await sendTestPushNotification(storedDevice.id);
      setTestSent(true);
    } catch (error) {
      setErrorMessage(friendlyError(error));
    } finally {
      setTesting(false);
    }
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
          <p className="text-[14px] text-muted-foreground">Loading notification settings…</p>
        )}
        {status === 'unsupported' && (
          <section aria-label="Notifications on this device" className="flex flex-col gap-2">
            <h2 className="text-[16px] font-semibold">This device</h2>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
              <span className="min-w-0 flex-1 basis-40">
                <span className="block text-[15px] font-medium">Not supported</span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">
                  Push notifications are not supported in this browser. Try a recent Chrome, Edge,
                  Firefox or Safari.
                </span>
              </span>
            </div>
          </section>
        )}
        {status === 'server-off' && (
          <section aria-label="Notifications on this device" className="flex flex-col gap-2">
            <h2 className="text-[16px] font-semibold">This device</h2>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
              <span className="min-w-0 flex-1 basis-40">
                <span className="block text-[15px] font-medium">Not available</span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">
                  Push notifications are not enabled on this server yet.
                </span>
              </span>
            </div>
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
            <section aria-label="This device" className="flex flex-col gap-2">
              <h2 className="text-[16px] font-semibold">This device</h2>
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block text-[15px] font-medium">{deviceState}</span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground">
                    {deviceStateDetail}
                  </span>
                </span>
                {thisDevice === undefined ? (
                  <Button type="button" onClick={() => void enableOnThisDevice()} disabled={busy}>
                    <Bell className="size-4" aria-hidden="true" />
                    {busy ? 'Enabling…' : 'Enable on this device'}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void disableOnThisDevice()}
                    disabled={busy}
                  >
                    <BellOff className="size-4" aria-hidden="true" />
                    {busy ? 'Disabling…' : 'Disable'}
                  </Button>
                )}
              </div>
            </section>
            <section aria-label="Devices" className="flex flex-col gap-2">
              <h2 className="text-[16px] font-semibold">Devices</h2>
              {devices.length === 0 ? (
                <p className="text-[14px] text-muted-foreground">No devices yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {devices.map((device) => (
                    <li
                      key={device.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5"
                    >
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
                        onClick={() => void removeOtherDevice(device.id)}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label="Message previews" className="flex flex-col gap-2">
              <h2 className="text-[16px] font-semibold">Message previews</h2>
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
                <label className="flex min-w-0 flex-1 basis-40 cursor-pointer items-center gap-2 text-[14px]">
                  <input
                    type="checkbox"
                    checked={showPreviews}
                    onChange={(event) => void togglePreviews(event.target.checked)}
                    className="size-4"
                  />
                  Show the first lines of new messages in notifications
                </label>
              </div>
              <p className="text-[13px] text-muted-foreground">
                Off means who and where only — never message text.
              </p>
            </section>
            <section aria-label="Test" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[16px] font-semibold">Test</h2>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void sendTest()}
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
