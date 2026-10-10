import { useRouter } from 'expo-router';
import { KeyRound } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { AddConnectionForm } from '@/components/connections/add-connection-form';
import { ConnectionCard } from '@/components/connections/connection-card';
import { ConnectionsHeader } from '@/components/connections/connections-header';
import { useConnections } from '@/components/connections/use-connections';
import { Card, SectionLabel } from '@/components/ui/card';
import { StateMessage } from '@/components/ui/state-message';

/**
 * Settings → Connections (mirrors web's `ConnectionsPage`): the provider
 * list with Test / Delete, and the add form with a provider picker and a
 * secure API key field. The key is write-only: the field state is cleared
 * the moment the save succeeds, and the key is never rendered, logged or
 * stored anywhere else.
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
    showForm,
    testingId,
    testResults,
    testErrors,
    confirmingId,
    removeError,
    busy,
    setConnections,
    setShowForm,
    reload,
    runTest,
    removeConnection,
    askRemove,
    cancelRemove,
  } = useConnections();

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ConnectionsHeader
        onBack={() => router.back()}
        onAdd={() => setShowForm(true)}
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

          {status === 'ready' && connections.length === 0 && !showForm ? (
            <StateMessage
              kind="empty"
              icon={KeyRound}
              title="No provider connections yet."
              action={{
                label: 'Add a connection',
                accessibilityLabel: 'Add a connection',
                onPress: () => setShowForm(true),
              }}
            />
          ) : null}

          {status === 'ready' && (connections.length > 0 || showForm) ? (
            <View className="gap-4">
              {connections.length > 0 ? (
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
              ) : null}

              {showForm ? (
                <AddConnectionForm
                  onCancel={() => setShowForm(false)}
                  onSaved={(created) => {
                    setConnections((previous) => [created, ...previous]);
                    setShowForm(false);
                  }}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
