import { useRouter } from 'expo-router';
import { KeyRound } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { AddKeySheet } from '@/components/connections/add-key-sheet';
import { ConnectionCard } from '@/components/connections/connection-card';
import { ConnectionsHeader } from '@/components/connections/connections-header';
import { useConnections } from '@/components/connections/use-connections';
import { Card, SectionLabel } from '@/components/ui/card';
import { StateMessage } from '@/components/ui/state-message';

/**
 * Settings → Connections (mirrors web's `ConnectionsPage`): the provider
 * list with Test / Delete, and the Add key sheet (Provider → Key) shared with
 * the New AI flow. The key is write-only: it travels only inside the key check
 * and is never rendered, logged or stored anywhere else.
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
  const {
    connections,
    status,
    errorInfo,
    testingId,
    testResults,
    testErrors,
    confirmingId,
    removeError,
    busy,
    reload,
    runTest,
    removeConnection,
    askRemove,
    cancelRemove,
  } = useConnections();
  const [addOpen, setAddOpen] = useState(false);
  // Remounts the sheet (and so its key state) on every open, like New AI does.
  const [addSession, setAddSession] = useState(0);

  const openAdd = (): void => {
    setAddSession((session) => session + 1);
    setAddOpen(true);
  };

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
      >
        <View className="gap-4 p-4">
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
              title="No provider connections yet."
              action={{
                label: 'Add a connection',
                accessibilityLabel: 'Add a connection',
                onPress: openAdd,
              }}
            />
          ) : null}

          {status === 'ready' && connections.length > 0 ? (
            <View className="gap-4">
              <View className="gap-2">
                <SectionLabel>Connections</SectionLabel>
                <Card>
                  {connections.map((connection) => (
                    <ConnectionCard
                      key={connection.id}
                      connection={connection}
                      confirming={confirmingId === connection.id}
                      removeError={removeError}
                      busy={busy}
                      testing={testingId === connection.id}
                      works={testResults[connection.id] === true}
                      testError={testErrors[connection.id]}
                      onCancelRemove={cancelRemove}
                      onConfirmRemove={() => removeConnection(connection.id)}
                      onTest={() => runTest(connection.id)}
                      onAskRemove={() => askRemove(connection.id)}
                    />
                  ))}
                </Card>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <AddKeySheet
        key={addSession}
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          setAddOpen(false);
          reload();
        }}
      />
    </SafeAreaView>
  );
}
