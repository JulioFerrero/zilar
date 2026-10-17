import type { AuthSession, AuthSessions } from '@zilar/api-contract';
import { describeUserAgent, formatListTime, formatShortDate } from '@zilar/chat-core';
import { Effect } from 'effect';
import { useFocusEffect, useGlobalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, MonitorSmartphone } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import { AuthApiError, listSessions, revokeSession } from '@/lib/auth-api';
import { ICON } from '@/lib/colors';
import { interruptFiber } from '@/lib/effect/timers';
import { getSessionToken } from '@/lib/session-token';
import { ENV_MOCK, mockParamAllowed, mockToken } from '@/mock/gate';

type PageStatus = 'loading' | 'ready' | 'error';

const LOAD_ERROR = 'Could not load your devices. Try again.';
const SIGN_OUT_ERROR = 'Could not sign out. Try again.';

/** The two calls the screen needs, whatever the mode behind them (T-1250). */
interface DevicesApi {
  list(): Promise<AuthSessions>;
  revoke(id: string): Promise<void>;
}

/** The production calls: bearer auth, `fetch`, and the build-time API URL. */
function createRealDevicesApi(): DevicesApi {
  return {
    list: async () => listSessions(API_URL, await bearerToken()),
    revoke: async (id) => {
      await revokeSession(API_URL, await bearerToken(), id);
    },
  };
}

async function bearerToken(): Promise<string> {
  const token = await getSessionToken();
  if (token === undefined) {
    throw new AuthApiError(401, 'unauthorized', 'No session');
  }
  return token;
}

/** Builds the mock-mode calls on the shared mock backend, behind a literal
 * build-time condition: Metro folds it to `false` in a release build, so the
 * mock module stays out of the bundle (the recipe of `use-profile-api`). */
function createMockDevicesApi(): DevicesApi {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mockFetch } = require('@/mock/backend') as typeof import('@/mock/backend');
    return {
      list: async () => listSessions(API_URL, await mockToken(), mockFetch),
      revoke: async (id) => {
        await revokeSession(API_URL, await mockToken(), id, mockFetch);
      },
    };
  }
  throw new Error('The mock API is not part of this build');
}

/** The mock gate the sibling `use-*-api` hooks use: the route's `?mock=` param
 * or the bundle-time `EXPO_PUBLIC_ZILAR_MOCK` env, with `false`/`0`/empty off. */
function devicesMockActive(
  envMock: string | undefined,
  params: Record<string, string | string[] | undefined>,
  paramAllowed: boolean,
): boolean {
  const rawParam = params['mock'];
  const param = paramAllowed ? (Array.isArray(rawParam) ? rawParam[0] : rawParam) : undefined;
  const requested = param !== undefined ? param : envMock;
  if (requested === undefined || requested === '' || requested === '0') {
    return false;
  }
  return requested !== 'false';
}

interface DevicesApiHandle {
  api: DevicesApi;
  /** True when the mock is active (used to label the screen). */
  mock: boolean;
}

/** Picks the real API or the mock one from the route's `?mock=` param or the env. */
function useDevicesApi(): DevicesApiHandle {
  const params = useGlobalSearchParams();
  const envMock = ENV_MOCK;
  const mock = devicesMockActive(envMock, params, mockParamAllowed({ dev: __DEV__, envMock }));
  const api = useMemo(() => (mock ? createMockDevicesApi() : createRealDevicesApi()), [mock]);
  return { api, mock };
}

type Confirm = { kind: 'one'; session: AuthSession } | { kind: 'all' } | null;

/**
 * Settings → Devices (T-1250, mirrors the web `DevicesPage`): every signed-in
 * session, this app first with a "This device" label, and a Sign out per other
 * one behind an in-screen confirm. No IP address and no token are shown.
 */
export default function DevicesScreen() {
  return (
    <RequireAuth>
      <DevicesList />
    </RequireAuth>
  );
}

function DevicesList() {
  const router = useRouter();
  const { api, mock } = useDevicesApi();

  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [signingOut, setSigningOut] = useState(false);

  // The load callback keeps its identity between focuses, so it reads the
  // status from a ref: a refresh with the devices on screen keeps them and
  // only a screen with nothing to show yet gets the spinner (T-1906).
  const statusRef = useRef<PageStatus>('loading');
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const load = useCallback(() => {
    const keepContent = statusRef.current === 'ready';
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    setError('');
    const fiber = Effect.runFork(
      Effect.tryPromise({ try: () => api.list(), catch: (cause) => cause }).pipe(
        Effect.tap((body) =>
          Effect.sync(() => {
            setSessions([...body.sessions]);
            setStatus('ready');
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            // A failed background refresh keeps the devices; the next focus retries.
            if (keepContent) {
              return;
            }
            setError(LOAD_ERROR);
            setStatus('error');
          }),
        ),
      ),
    );
    return () => {
      interruptFiber(fiber);
    };
  }, [api]);

  useFocusEffect(load);

  const current = sessions.find((session) => session.current);
  const others = sessions.filter((session) => !session.current);

  // One other device: drop the row on success, a failure keeps it and shows the
  // fixed sentence. The confirm closes either way.
  const signOutOne = async (session: AuthSession): Promise<void> => {
    setSigningOut(true);
    setError('');
    try {
      await api.revoke(session.id);
      setSessions((rows) => rows.filter((row) => row.id !== session.id));
    } catch {
      setError(SIGN_OUT_ERROR);
    } finally {
      setSigningOut(false);
      setConfirm(null);
    }
  };

  // "Sign out all other devices": one call per row, then reload the list so the
  // rows that did sign out drop and a partial failure keeps the rest.
  const signOutAll = async (ids: string[]): Promise<void> => {
    setSigningOut(true);
    setError('');
    try {
      const results = await Promise.allSettled(ids.map((id) => api.revoke(id)));
      if (results.some((result) => result.status === 'rejected')) {
        setError(SIGN_OUT_ERROR);
      }
      const body = await api.list();
      setSessions([...body.sessions]);
    } catch {
      setError(SIGN_OUT_ERROR);
    } finally {
      setSigningOut(false);
      setConfirm(null);
    }
  };

  const confirmingAll = confirm?.kind === 'all';

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center gap-1 px-2 py-2">
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={ICON} />
        </IconButton>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[20px] font-semibold leading-6 text-foreground">
            Devices
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-[14px] leading-5 text-muted-foreground">
            Where you are signed in. Sign out a device you no longer use.
          </Text>
        </View>
      </View>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View className="p-4">
          {status === 'loading' ? <StateMessage kind="loading" title="Loading devices…" /> : null}

          {status === 'error' ? (
            <StateMessage
              kind="error"
              title={error}
              action={{
                label: 'Retry',
                accessibilityLabel: 'Retry loading devices',
                onPress: () => load(),
              }}
            />
          ) : null}

          {status === 'ready' && sessions.length === 0 ? (
            <View className="items-center gap-3 pt-16">
              <MonitorSmartphone size={32} color={ICON} />
              <Text className="px-4 text-center text-[15px] text-muted-foreground">
                No devices are signed in.
              </Text>
            </View>
          ) : null}

          {status === 'ready' && sessions.length > 0 ? (
            <View className="gap-2">
              {others.length > 0 ? (
                <Card>
                  <View className="flex-row flex-wrap items-center gap-3 px-3 py-2.5">
                    <View className="min-w-0 flex-1">
                      <Text className="text-[14px] text-foreground">
                        {`Signed in on ${others.length} other ${others.length === 1 ? 'device' : 'devices'}.`}
                      </Text>
                    </View>
                    <Button
                      variant="outline"
                      size="sm"
                      accessibilityLabel="Sign out all other devices"
                      onPress={() => {
                        setError('');
                        setConfirm({ kind: 'all' });
                      }}
                    >
                      <Text>Sign out all other devices</Text>
                    </Button>
                  </View>
                </Card>
              ) : null}

              <Card>
                {current !== undefined ? <CurrentDeviceRow session={current} /> : null}
                {others.map((session) => (
                  <OtherDeviceRow
                    key={session.id}
                    session={session}
                    onAsk={() => {
                      setError('');
                      setConfirm({ kind: 'one', session });
                    }}
                  />
                ))}
              </Card>

              {error !== '' ? (
                <Text accessibilityRole="alert" className="mt-1 text-[14px] text-danger">
                  {error}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
      {mock ? (
        <View className="items-center border-t border-divider px-4 py-1">
          <Text className="text-[12px] text-muted-foreground">Mock data</Text>
        </View>
      ) : null}
      <ConfirmDialog
        visible={confirm !== null}
        title={confirmingAll ? 'Sign out all other devices?' : 'Sign out this device?'}
        message="It will need a sign-in code to get back in."
        confirmLabel={confirmingAll ? 'Sign out all' : 'Sign out'}
        busyLabel="Signing out…"
        busy={signingOut}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'all') {
            void signOutAll(others.map((session) => session.id));
          } else if (confirm?.kind === 'one') {
            void signOutOne(confirm.session);
          }
        }}
        confirmAccessibilityLabel={confirmingAll ? 'Sign out all other devices' : 'Sign out device'}
        accessibilityLabel={confirmingAll ? 'Sign out all other devices' : 'Sign out this device'}
      />
    </SafeAreaView>
  );
}

/** The device line every row shows, from the shared parser and date helpers. */
function DeviceSummary({ session }: { session: AuthSession }) {
  const now = new Date();
  return (
    <View className="min-w-0 flex-1">
      <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
        {describeUserAgent(session.userAgent)}
      </Text>
      <Text numberOfLines={1} className="mt-0.5 text-[13px] text-muted-foreground">
        {`Last active ${formatListTime(new Date(session.updatedAt), now)} · Signed in ${formatShortDate(new Date(session.createdAt))}`}
      </Text>
    </View>
  );
}

/** This app's own session: labelled, with no Sign out. */
function CurrentDeviceRow({ session }: { session: AuthSession }) {
  return (
    <View className="flex-row items-center gap-3 px-3 py-2.5">
      <DeviceSummary session={session} />
      <View className="shrink-0 rounded-full bg-badge-muted px-2 py-0.5">
        <Text className="text-[11px] text-foreground">This device</Text>
      </View>
    </View>
  );
}

/** One other device with its own Sign out, behind the screen's confirm. */
function OtherDeviceRow({ session, onAsk }: { session: AuthSession; onAsk: () => void }) {
  return (
    <View className="flex-row items-center gap-3 px-3 py-2.5">
      <DeviceSummary session={session} />
      <Button
        variant="outline"
        size="sm"
        accessibilityLabel={`Sign out ${describeUserAgent(session.userAgent)}`}
        onPress={onAsk}
      >
        <Text>Sign out</Text>
      </Button>
    </View>
  );
}
