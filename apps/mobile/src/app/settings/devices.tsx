// effect-plain: a settings screen; its async is confirm-dialog UI state around the shared Devices hook.
import type { AuthSession } from '@zilar/api-contract';
import { describeUserAgent, formatListTime, formatShortDate } from '@zilar/chat-core';
import { makeDevicesApi, useDevices } from '@zilar/client-core';
import { useFocusEffect, useRouter } from 'expo-router';
import { MonitorSmartphone } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { RefreshControl, View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { useApi } from '@/lib/use-mockable-api';

type Confirm = { kind: 'one'; session: AuthSession } | { kind: 'all' } | null;

/**
 * Every signed-in session, this app first, with a Sign out per other one behind an in-screen confirm. No IP address and no token are shown.
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
  const { api, mock } = useApi(makeDevicesApi);
  const {
    status,
    sessions,
    current,
    others,
    error,
    setError,
    refresh,
    signOut,
    signOutAll,
    busyIds,
    bulkBusy,
  } = useDevices(api);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  // The confirm closes either way; the hook keeps a row whose sign-out failed.
  const signOutOne = async (session: AuthSession): Promise<void> => {
    try {
      await signOut(session.id);
    } finally {
      setConfirm(null);
    }
  };

  const signOutOthers = async (): Promise<void> => {
    try {
      await signOutAll();
    } finally {
      setConfirm(null);
    }
  };

  const confirmingAll = confirm?.kind === 'all';
  const signingOut =
    confirm?.kind === 'one' ? busyIds.has(confirm.session.id) : confirmingAll ? bulkBusy : false;

  return (
    <SettingsScreenShell
      title="Devices"
      subtitle="Where you are signed in. Sign out a device you no longer use."
      onBack={() => router.back()}
      contentPaddingBottom={32}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={MUTED_FOREGROUND}
          onRefresh={() => {
            setRefreshing(true);
            void refresh().finally(() => setRefreshing(false));
          }}
        />
      }
      after={
        <>
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
                void signOutOthers();
              } else if (confirm?.kind === 'one') {
                void signOutOne(confirm.session);
              }
            }}
            confirmAccessibilityLabel={
              confirmingAll ? 'Sign out all other devices' : 'Sign out device'
            }
            accessibilityLabel={
              confirmingAll ? 'Sign out all other devices' : 'Sign out this device'
            }
          />
        </>
      }
    >
      {status === 'loading' ? <StateMessage kind="loading" title="Loading devices…" /> : null}

      {status === 'error' ? (
        <StateMessage
          kind="error"
          title={error}
          action={{
            label: 'Retry',
            accessibilityLabel: 'Retry loading devices',
            onPress: () => void refresh(),
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
    </SettingsScreenShell>
  );
}

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
