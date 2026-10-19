import { Effect } from 'effect';
import { useFocusEffect, useGlobalSearchParams, useRouter } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { runApi, type PushDevice } from '@zilar/api-contract';

import { RequireAuth } from '@/auth/RequireAuth';
import { Button } from '@/components/ui/button';
import { Card, SectionLabel } from '@/components/ui/card';
import { StateMessage } from '@/components/ui/state-message';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { API_URL } from '@/lib/auth';
import { ACCENT_FOREGROUND } from '@/lib/colors';
import { createApiClient } from '@/lib/effect/api-client';
import { fromApi, interruptFiber } from '@zilar/client-core';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { readLastPushReceived } from '@/lib/push/last-received';
import {
  NATIVE_PUSH_USER_AGENT,
  readStoredRegistration,
  registerNativePush,
  type SetPushPair,
} from '@/lib/push/native';
import { getSessionToken } from '@/lib/session-token';
import { ENV_MOCK, apiMockActive, mockParamAllowed, mockToken } from '@/mock/gate';
import { useChatStore } from '@/store/chat-store-provider';
import { deviceName, formatRelativeAudit } from '@zilar/chat-core';

function PushDevicesSection({
  devices,
  thisDeviceId,
}: {
  devices: readonly PushDevice[];
  thisDeviceId: string | null;
}) {
  const now = new Date();
  return (
    <View className="gap-2">
      <SectionLabel>Devices</SectionLabel>
      {devices.length === 0 ? (
        <Text className="text-[14px] text-muted-foreground">No devices yet.</Text>
      ) : (
        <Card>
          {devices.map((device) => (
            <View key={device.id} className="px-3 py-2.5">
              <Text className="text-[15px] font-medium text-foreground">
                {deviceName(device)}
                {thisDeviceId !== null && device.id === thisDeviceId ? ' (this phone)' : ''}
              </Text>
              <Text className="mt-0.5 text-[13px] text-muted-foreground">
                {device.lastUsedAt !== null
                  ? `Last push: ${formatRelativeAudit(new Date(device.lastUsedAt), now)}`
                  : 'No push yet'}
                {device.inactive ? ' · inactive' : ''}
              </Text>
              {device.failedAt !== null ? (
                <Text className="mt-0.5 text-[13px] text-danger">
                  {`Failed ${formatRelativeAudit(new Date(device.failedAt), now)}: ${device.lastFailure ?? 'unknown'}`}
                </Text>
              ) : null}
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

function LastPushReceivedLine({ at }: { at: string | null }) {
  const text =
    at === null
      ? 'Last push received on this phone: never'
      : `Last push received on this phone: ${formatRelativeAudit(new Date(at), new Date())}`;
  return <Text className="px-1 text-[13px] text-muted-foreground">{text}</Text>;
}

type PermissionView = 'enabled' | 'not-enabled' | 'blocked';
type PageStatus = 'loading' | 'ready' | 'error';

const LOAD_ERROR = 'Could not load notification settings. Try again.';
const PREVIEW_ERROR = 'Could not save message previews. Try again.';
const TEST_ERROR = 'Could not send a test notification. Try again.';

export default function NotificationsSettingsScreen() {
  return (
    <RequireAuth>
      <NotificationsSettings />
    </RequireAuth>
  );
}

function permissionViewOf(permission: Notifications.PermissionResponse): PermissionView {
  if (permission.granted) {
    return 'enabled';
  }
  return permission.canAskAgain ? 'not-enabled' : 'blocked';
}

function createRealPushClient() {
  return createApiClient({ getToken: getSessionToken, fetchImpl: fetch, apiUrl: API_URL }).push;
}

/** Built on the shared mock backend behind a literal build-time condition: Metro folds it to `false` in a release build, so the mock module stays out of the bundle. */
function createMockPushClient() {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mockFetch } = require('@/mock/backend') as typeof import('@/mock/backend');
    return createApiClient({ getToken: mockToken, fetchImpl: mockFetch, apiUrl: API_URL }).push;
  }
  throw new Error('The mock API is not part of this build');
}

function usePushClient() {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = apiMockActive(envMock, params, mockParamAllowed({ dev: __DEV__, envMock }));
  return useMemo(() => (mock ? createMockPushClient() : createRealPushClient()), [mock]);
}

function NotificationsSettings() {
  const router = useRouter();
  const push = usePushClient();
  const setPushPair = useChatStore((state) => state.setPushPair);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [permission, setPermission] = useState<PermissionView>('not-enabled');
  const [showPreviews, setShowPreviews] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [testResult, setTestResult] = useState<'sent' | ''>('');
  const [testError, setTestError] = useState('');
  const [devices, setDevices] = useState<readonly PushDevice[]>([]);
  const [thisDeviceId, setThisDeviceId] = useState<string | null>(null);
  const [lastReceivedAt, setLastReceivedAt] = useState<string | null>(null);

  // The load callback keeps its identity between focuses, so it reads the status from a ref: a refresh with settings on screen keeps them, and only an empty screen gets the spinner.
  const statusRef = useRef<PageStatus>('loading');
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const load = useCallback(() => {
    const keepContent = statusRef.current === 'ready';
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    setLoadError('');
    const fiber = Effect.runFork(
      Effect.all(
        [
          Effect.tryPromise({
            try: () => Notifications.getPermissionsAsync(),
            catch: (error) => error,
          }),
          fromApi(() => runApi(push.settings())),
          fromApi(() => runApi(push.list())),
          Effect.tryPromise({ try: () => readLastPushReceived(), catch: () => null }),
          Effect.tryPromise({ try: () => readStoredRegistration(), catch: () => undefined }),
        ],
        { concurrency: 'unbounded' },
      ).pipe(
        Effect.tap(([granted, settings, list, lastReceived, registration]) =>
          Effect.sync(() => {
            setPermission(permissionViewOf(granted));
            setShowPreviews(settings.showPreviews);
            setDevices(list.devices);
            setLastReceivedAt(lastReceived);
            setThisDeviceId(registration?.id ?? null);
            setStatus('ready');
          }),
        ),
        Effect.tapError(() =>
          Effect.sync(() => {
            if (keepContent) {
              return;
            }
            setLoadError(LOAD_ERROR);
            setStatus('error');
          }),
        ),
      ),
    );
    return () => {
      interruptFiber(fiber);
    };
  }, [push]);

  useFocusEffect(load);

  const refreshPermission = useCallback(() => {
    Effect.runFork(
      Effect.tryPromise({
        try: () => Notifications.getPermissionsAsync(),
        catch: (error) => error,
      }).pipe(
        Effect.tap((granted) => Effect.sync(() => setPermission(permissionViewOf(granted)))),
        Effect.ignore,
      ),
    );
  }, []);

  const [enableState, enable] = useAction(() =>
    Effect.tryPromise({
      try: () =>
        registerNativePush({ setPushPair: setPushPair as SetPushPair }).then(() =>
          Notifications.getPermissionsAsync(),
        ),
      catch: (error) => error,
    }).pipe(
      Effect.tap((granted) => Effect.sync(() => setPermission(permissionViewOf(granted)))),
      Effect.asVoid,
      Effect.ignore,
    ),
  );

  const [previewState, togglePreviews] = useAction((value: boolean) =>
    Effect.sync(() => {
      setPreviewError('');
      setShowPreviews(value);
    }).pipe(
      Effect.andThen(
        fromApi(() => runApi(push.updateSettings({ payload: { showPreviews: value } }))),
      ),
      Effect.tap((settings) => Effect.sync(() => setShowPreviews(settings.showPreviews))),
      Effect.catch(() =>
        Effect.sync(() => {
          setShowPreviews(!value);
          setPreviewError(PREVIEW_ERROR);
        }),
      ),
    ),
  );

  const [testState, sendTest] = useAction(() =>
    Effect.sync(() => {
      setTestError('');
      setTestResult('');
    }).pipe(
      Effect.andThen(
        Effect.tryPromise({
          try: () =>
            Notifications.getDevicePushTokenAsync().then(({ data }) =>
              typeof data === 'string' && data !== ''
                ? data
                : Promise.reject(new Error('no token')),
            ),
          catch: (error) => error,
        }),
      ),
      Effect.andThen((token) =>
        fromApi(() =>
          runApi(
            push.subscribe({
              payload: { kind: 'fcm', token, userAgent: NATIVE_PUSH_USER_AGENT },
            }),
          ),
        ),
      ),
      Effect.andThen((registration) =>
        fromApi(() => runApi(push.test({ payload: { subscriptionId: registration.id } }))),
      ),
      Effect.tap(() => Effect.sync(() => setTestResult('sent'))),
      // A failed refresh must not turn a successful send into an error.
      Effect.tap(() =>
        Effect.all(
          [
            fromApi(() => runApi(push.list())),
            Effect.tryPromise({ try: () => readLastPushReceived(), catch: () => null }),
          ],
          { concurrency: 'unbounded' },
        ).pipe(
          Effect.tap(([list, lastReceived]) =>
            Effect.sync(() => {
              setDevices(list.devices);
              setLastReceivedAt(lastReceived);
            }),
          ),
          Effect.ignore,
        ),
      ),
      Effect.catch(() => Effect.sync(() => setTestError(TEST_ERROR))),
    ),
  );

  const enabling = isWaiting(enableState);
  const savingPreviews = isWaiting(previewState);
  const testing = isWaiting(testState);

  return (
    <SettingsScreenShell
      title="Notifications"
      subtitle="Push this phone when a message arrives."
      onBack={() => router.back()}
      onRefresh={() => {
        load();
      }}
    >
      {status === 'loading' ? <StateMessage kind="loading" title="Loading…" /> : null}

      {status === 'error' ? (
        <StateMessage
          kind="error"
          title={loadError}
          action={{ label: 'Retry', onPress: () => load() }}
        />
      ) : null}

      {status === 'ready' ? (
        <View className="gap-6">
          <View className="gap-2">
            <SectionLabel>On this phone</SectionLabel>
            <Card>
              <View className="flex-row flex-wrap items-center gap-3 px-3 py-2.5">
                <View className="min-w-0 flex-1 basis-40">
                  <Text className="text-[15px] font-medium text-foreground">
                    {permission === 'enabled'
                      ? 'Enabled'
                      : permission === 'blocked'
                        ? 'Blocked'
                        : 'Not enabled'}
                  </Text>
                  <Text className="mt-0.5 text-[13px] text-muted-foreground">
                    {permission === 'enabled'
                      ? 'Push is on for this phone.'
                      : permission === 'blocked'
                        ? 'Notifications are blocked for Zilar. Allow them in the system settings.'
                        : 'Turn on push for this phone.'}
                  </Text>
                </View>
                {permission === 'blocked' ? (
                  <Button
                    accessibilityLabel="Open settings"
                    onPress={() => {
                      void Linking.openSettings().then(() => refreshPermission());
                    }}
                  >
                    <Text>Open settings</Text>
                  </Button>
                ) : permission === 'not-enabled' ? (
                  <Button
                    accessibilityLabel="Enable notifications on this phone"
                    disabled={enabling}
                    onPress={() => enable(undefined)}
                  >
                    <Bell size={16} color={ACCENT_FOREGROUND} />
                    <Text>{enabling ? 'Enabling…' : 'Enable'}</Text>
                  </Button>
                ) : null}
              </View>
            </Card>
          </View>

          <View className="gap-2">
            <PushDevicesSection devices={devices} thisDeviceId={thisDeviceId} />
            <LastPushReceivedLine at={lastReceivedAt} />
          </View>

          <View className="gap-2">
            <SectionLabel>Message previews</SectionLabel>
            <Card>
              <View className="px-3 py-2.5">
                <Switch
                  label="Show the first lines of new messages in notifications"
                  value={showPreviews}
                  disabled={savingPreviews}
                  onValueChange={(value) => togglePreviews(value)}
                />
              </View>
            </Card>
            <Text className="text-[13px] text-muted-foreground">
              Off means who and where only — never message text.
            </Text>
            {previewError !== '' ? (
              <Text accessibilityRole="alert" className="text-[14px] text-danger">
                {previewError}
              </Text>
            ) : null}
          </View>

          <View className="gap-2">
            <SectionLabel>Test</SectionLabel>
            <Button
              variant="outline"
              accessibilityLabel="Send test notification"
              disabled={testing}
              onPress={() => sendTest(undefined)}
            >
              <Text>{testing ? 'Sending…' : 'Send test notification'}</Text>
            </Button>
            {testResult === 'sent' ? (
              <Text className="text-[14px] text-muted-foreground">Sent.</Text>
            ) : null}
            {testError !== '' ? (
              <Text accessibilityRole="alert" className="text-[14px] text-danger">
                {testError}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </SettingsScreenShell>
  );
}
