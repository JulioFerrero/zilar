import { useRouter } from 'expo-router';
import { KeyRound } from 'lucide-react-native';
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { providerLabel } from '@/components/ais/providers';
import { AddKeySheet } from '@/components/connections/add-key-sheet';
import { ConnectionRow } from '@/components/connections/connection-card';
import { ConnectionSheet } from '@/components/connections/connection-sheet';
import { ConnectionsHeader } from '@/components/connections/connections-header';
import { useConnections } from '@/components/connections/use-connections';
import { usePullToRefresh } from '@/components/settings/screen-shell';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { Toast, type ToastMessage } from '@/components/ui/toast';
import { MUTED_FOREGROUND } from '@/lib/colors';
import type { ProviderConnection } from '@/lib/connections-api';

/**
 * The key is write-only: it travels only inside the key check and the replace call, and is never rendered, logged or stored anywhere else.
 */
export default function ConnectionsScreen() {
  return (
    <RequireAuth>
      <ConnectionsList />
    </RequireAuth>
  );
}

function ConnectionsList() {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [addSession, setAddSession] = useState(0);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [sheetSession, setSheetSession] = useState(0);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const {
    connections,
    status,
    errorInfo,
    testingId,
    testResults,
    testErrors,
    replacing,
    replaceError,
    confirmingId,
    removeError,
    busy,
    reload,
    runTest,
    replaceKey,
    clearReplaceError,
    removeConnection,
    askRemove,
    cancelRemove,
  } = useConnections({
    onTestFailed: () => setSheetId(null),
    onReplaced: () => {
      setSheetId(null);
      setToast({ id: Date.now(), text: 'Key replaced', tone: 'notice' });
    },
  });

  const { refreshing, pullToRefresh } = usePullToRefresh(reload);

  const openAdd = (): void => {
    setAddSession((session) => session + 1);
    setAddOpen(true);
  };

  const openSheet = (id: string): void => {
    clearReplaceError();
    setSheetSession((session) => session + 1);
    setSheetId(id);
  };

  const isWorking = (connection: ProviderConnection): boolean =>
    connection.status === 'active' && testErrors[connection.id] === undefined;

  const reasonOf = (connection: ProviderConnection): string | undefined =>
    isWorking(connection)
      ? undefined
      : connection.status !== 'active'
        ? 'Key revoked'
        : testErrors[connection.id];

  const sheetConnection = connections.find((connection) => connection.id === sheetId) ?? null;
  const confirmingConnection =
    connections.find((connection) => connection.id === confirmingId) ?? null;
  const confirmingLabel =
    confirmingConnection === null ? 'key' : `${providerLabel(confirmingConnection.provider)} key`;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ConnectionsHeader
        onBack={() => router.back()}
        onAdd={openAdd}
        showAdd={status === 'ready'}
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={MUTED_FOREGROUND}
            onRefresh={pullToRefresh}
          />
        }
      >
        <View className="gap-4 py-4">
          {status === 'ready' && errorInfo.message !== '' ? (
            <Text role="alert" className="px-4 text-[13px] text-danger">
              {errorInfo.message}
            </Text>
          ) : null}

          {status === 'loading' ? (
            <StateMessage kind="loading" title="Loading connections…" />
          ) : null}

          {status === 'error' ? (
            <StateMessage
              kind="error"
              title={errorInfo.message}
              action={{
                label: 'Retry',
                accessibilityLabel: 'Retry loading connections',
                onPress: reload,
              }}
            />
          ) : null}

          {status === 'ready' && connections.length === 0 ? (
            <StateMessage
              kind="empty"
              icon={KeyRound}
              title="No keys yet"
              action={{
                label: 'Add key',
                accessibilityLabel: 'Add key',
                onPress: openAdd,
              }}
            />
          ) : null}

          {status === 'ready' && connections.length > 0 ? (
            <View className="mx-4 overflow-hidden rounded-2xl border border-divider bg-surface">
              {connections.map((connection, index) => (
                <ConnectionRow
                  key={connection.id}
                  connection={connection}
                  working={isWorking(connection)}
                  reason={reasonOf(connection)}
                  last={index === connections.length - 1}
                  onPress={() => openSheet(connection.id)}
                />
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <ConnectionSheet
        key={sheetSession}
        connection={sheetConnection}
        working={sheetConnection !== null && isWorking(sheetConnection)}
        tested={sheetConnection !== null && testResults[sheetConnection.id] === true}
        testing={sheetConnection !== null && testingId === sheetConnection.id}
        replacing={replacing}
        replaceError={replaceError}
        onClose={() => {
          clearReplaceError();
          setSheetId(null);
        }}
        onDismissed={() => {
          if (pendingDeleteId !== null) {
            askRemove(pendingDeleteId);
            setPendingDeleteId(null);
          }
        }}
        onTest={() => {
          if (sheetConnection !== null) {
            runTest(sheetConnection.id);
          }
        }}
        onReplaceStart={clearReplaceError}
        onReplace={(key) => {
          if (sheetConnection !== null) {
            replaceKey(sheetConnection.id, key);
          }
        }}
        onDelete={() => {
          if (sheetConnection === null) {
            return;
          }
          setPendingDeleteId(sheetConnection.id);
          setSheetId(null);
        }}
      />

      <ConfirmDialog
        visible={confirmingId !== null}
        title={`Delete ${confirmingLabel}?`}
        message="This removes the provider key from your account."
        error={removeError}
        confirmLabel="Delete"
        busyLabel="Deleting…"
        busy={busy}
        onCancel={cancelRemove}
        onConfirm={() => {
          if (confirmingId !== null) {
            removeConnection(confirmingId);
          }
        }}
        confirmAccessibilityLabel={`Delete ${confirmingLabel}`}
      />

      <AddKeySheet
        key={addSession}
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          setAddOpen(false);
          reload();
        }}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </SafeAreaView>
  );
}
