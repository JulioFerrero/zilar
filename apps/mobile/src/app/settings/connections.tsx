import { Effect } from 'effect';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronLeft, Eye, EyeOff, KeyRound, Plus, Trash2, X, Zap } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { providerLabel } from '@/components/ais/providers';
import {
  describeConnectionsError,
  type ConnectionsErrorInfo,
} from '@/components/connections/errors';
import { keyAfterSave, saveConnection } from '@/components/connections/save-connection';
import { useConnectionsApi } from '@/components/connections/use-connections-api';
import { Button } from '@/components/ui/button';
import { Card, SectionLabel } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { ICON } from '@/lib/colors';
import type { ProviderConnection } from '@/lib/connections-api';
import { useAction } from '@/lib/effect/use-action';

type PageStatus = 'loading' | 'ready' | 'error';

const PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'xai',
  'openrouter',
  'github',
] as const;

/**
 * Settings → Connections (mirrors web's `ConnectionsPage`): the provider
 * list with Test / Delete, and the add form with a provider picker and a
 * secure API key field. The key is write-only: the field state is cleared
 * the moment the save succeeds, and the key is never rendered, logged or
 * stored anywhere else.
 *
 * The screen's state stays in React `useState` as before; each network call
 * is an Effect run by `useAction`, which writes the results back into that
 * state. `useAction` also gives the single-flight guard (a second tap while
 * one call runs is ignored) and interrupts a running call on unmount.
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
  const { api } = useConnectionsApi();

  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [errorInfo, setErrorInfo] = useState<ConnectionsErrorInfo>({ message: '' });
  const [showForm, setShowForm] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, boolean>>({});
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [busy, setBusy] = useState(false);

  // Latest reload wins: a focus reload replaces a load still in flight.
  const [, load] = useAction(
    () =>
      Effect.tryPromise({
        try: () => api.listConnections(),
        catch: (cause): ConnectionsErrorInfo =>
          describeConnectionsError(cause, 'Could not load your connections.'),
      }).pipe(
        Effect.tap((list) =>
          Effect.sync(() => {
            setConnections(list);
            setStatus('ready');
          }),
        ),
        Effect.catch((info) =>
          Effect.sync(() => {
            setErrorInfo(info);
            setStatus('error');
          }),
        ),
      ),
    { mode: 'replace' },
  );

  const reload = useCallback(() => {
    setStatus('loading');
    load(undefined);
  }, [load]);

  // A second tap on any Test is ignored while one test runs (one lock for
  // all rows, as the server rate-limits key tests per user).
  const [, runTest] = useAction((id: string) =>
    Effect.sync(() => {
      setTestingId(id);
      setTestErrors((previous) => {
        if (!(id in previous)) return previous;
        const { [id]: _removed, ...rest } = previous;
        void _removed;
        return rest;
      });
    }).pipe(
      Effect.andThen(
        Effect.tryPromise({
          try: () => api.testConnection(id),
          catch: (cause) => cause,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              setTestResults((previous) => ({ ...previous, [id]: result.ok }));
              if (!result.ok) {
                setTestErrors((previous) => ({ ...previous, [id]: 'The key was rejected.' }));
              }
            }),
          ),
          Effect.catch(() =>
            Effect.sync(() => {
              setTestResults((previous) => ({ ...previous, [id]: false }));
              setTestErrors((previous) => ({ ...previous, [id]: 'Could not test the key.' }));
            }),
          ),
        ),
      ),
      Effect.ensuring(Effect.sync(() => setTestingId(null))),
    ),
  );

  // A second tap on any Remove is ignored while one removal runs.
  const [, removeConnection] = useAction((id: string) =>
    Effect.sync(() => {
      setBusy(true);
      setRemoveError('');
    }).pipe(
      Effect.andThen(
        Effect.tryPromise({
          try: () => api.deleteConnection(id),
          catch: (cause): ConnectionsErrorInfo =>
            describeConnectionsError(cause, 'Could not remove the connection.'),
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              setConnections((previous) => previous.filter((connection) => connection.id !== id));
              setConfirmingId(null);
            }),
          ),
          Effect.catch((info) => Effect.sync(() => setRemoveError(info.message))),
        ),
      ),
      Effect.ensuring(Effect.sync(() => setBusy(false))),
    ),
  );

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const askRemove = (id: string): void => {
    setConfirmingId(id);
    setRemoveError('');
  };

  const cancelRemove = (): void => {
    setConfirmingId(null);
    setRemoveError('');
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center gap-1 px-2 py-2">
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={ICON} />
        </IconButton>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[20px] font-semibold leading-6 text-foreground">
            Connections
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-[14px] leading-5 text-muted-foreground">
            Provider accounts for your AIs.
          </Text>
        </View>
        {status === 'ready' ? (
          <IconButton label="Add a connection" onPress={() => setShowForm(true)}>
            <Plus size={22} color={ICON} />
          </IconButton>
        ) : null}
      </View>

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
                    {connections.map((connection) =>
                      confirmingId === connection.id ? (
                        <View key={connection.id} className="gap-2 px-3 py-2.5">
                          <Text className="text-[15px] font-medium text-foreground">
                            Remove {providerLabel(connection.provider)}?
                          </Text>
                          {removeError !== '' ? (
                            <Text accessibilityRole="alert" className="text-[13px] text-danger">
                              {removeError}
                            </Text>
                          ) : null}
                          <View className="flex-row justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              accessibilityLabel="Cancel removing"
                              disabled={busy}
                              onPress={cancelRemove}
                            >
                              <Text>Cancel</Text>
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              accessibilityLabel="Confirm remove"
                              disabled={busy}
                              onPress={() => removeConnection(connection.id)}
                            >
                              <Text>{busy ? 'Removing…' : 'Remove'}</Text>
                            </Button>
                          </View>
                        </View>
                      ) : (
                        <View
                          key={connection.id}
                          className="flex-row items-center gap-3 px-3 py-2.5"
                        >
                          <View className="min-w-0 flex-1">
                            <View className="flex-row flex-wrap items-center gap-2">
                              <Text className="text-[15px] font-medium text-foreground">
                                {providerLabel(connection.provider)}
                              </Text>
                              <Text className="rounded-full bg-surface-raised px-2 py-0.5 text-[11px] text-foreground">
                                {connection.status}
                              </Text>
                            </View>
                            <Text
                              numberOfLines={1}
                              className="mt-0.5 text-[13px] text-muted-foreground"
                            >
                              {connection.label ?? 'No label'}
                            </Text>
                            {testResults[connection.id] === true ? (
                              <Text className="text-[13px] text-online">Key works</Text>
                            ) : null}
                            {testErrors[connection.id] !== undefined ? (
                              <Text accessibilityRole="alert" className="text-[13px] text-danger">
                                {testErrors[connection.id]}
                              </Text>
                            ) : null}
                          </View>
                          <View className="flex-row shrink-0 gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 rounded-full"
                              accessibilityLabel={`Test ${providerLabel(connection.provider)} key`}
                              disabled={testingId === connection.id}
                              onPress={() => runTest(connection.id)}
                            >
                              <Zap size={16} color={ICON} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 rounded-full"
                              accessibilityLabel={`Remove ${providerLabel(connection.provider)} connection`}
                              onPress={() => askRemove(connection.id)}
                            >
                              <Trash2 size={16} color={ICON} />
                            </Button>
                          </View>
                        </View>
                      ),
                    )}
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

/**
 * The add form: a provider picker and a secure key field. The key lives in
 * this component's state only, and is cleared the moment the save resolves —
 * it is never rendered back, logged or passed anywhere but the POST body.
 */
function AddConnectionForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (connection: ProviderConnection) => void;
}) {
  const { api } = useConnectionsApi();
  const [provider, setProvider] = useState<string>(PROVIDERS[0]);
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [, saveForm] = useAction(
    (draft: { readonly provider: string; readonly key: string; readonly label: string }) =>
      Effect.sync(() => {
        setBusy(true);
        setError('');
      }).pipe(
        Effect.andThen(Effect.promise(() => saveConnection(api, draft))),
        Effect.tap((outcome) =>
          Effect.sync(() => {
            // Write-only: the transition empties the field on success and keeps
            // the typed key for retry on failure.
            setKey(keyAfterSave(outcome, draft.key));
            setShowKey(false);
            if (outcome.connection !== null) {
              onSaved(outcome.connection);
            } else {
              setError(outcome.error);
            }
          }),
        ),
        Effect.ensuring(Effect.sync(() => setBusy(false))),
      ),
  );

  const submit = (): void => {
    if (busy) {
      return;
    }
    const trimmedKey = key.trim();
    if (trimmedKey === '') {
      setError('Paste your API key.');
      return;
    }
    saveForm({ provider, key: trimmedKey, label: label.trim() });
  };

  return (
    <View className="gap-3 rounded-xl border border-border bg-surface p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-[16px] font-semibold text-foreground">New connection</Text>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full"
          accessibilityLabel="Close the form"
          onPress={onCancel}
        >
          <X size={16} color={ICON} />
        </Button>
      </View>

      <View className="gap-1">
        <Text className="text-[14px] font-medium text-foreground">Provider</Text>
        <View className="flex-row flex-wrap gap-2">
          {PROVIDERS.map((id) => {
            const selected = id === provider;
            return (
              <Pressable
                key={id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={providerLabel(id)}
                onPress={() => setProvider(id)}
                className={
                  selected
                    ? 'rounded-full bg-accent px-3 py-1.5 active:opacity-90'
                    : 'rounded-full border border-border-strong px-3 py-1.5 active:bg-surface-raised'
                }
              >
                <Text
                  className={
                    selected
                      ? 'text-[14px] font-medium text-accent-foreground'
                      : 'text-[14px] text-foreground'
                  }
                >
                  {providerLabel(id)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View className="gap-1">
        <Text className="text-[14px] font-medium text-foreground">API key</Text>
        <View className="flex-row items-center gap-1">
          <TextField
            value={key}
            onChangeText={setKey}
            accessibilityLabel="API key"
            secureTextEntry={!showKey}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={16384}
            placeholder="Paste your key"
            className="min-w-0 flex-1"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full"
            accessibilityLabel={showKey ? 'Hide key' : 'Show key'}
            onPress={() => setShowKey((value) => !value)}
          >
            {showKey ? <EyeOff size={16} color={ICON} /> : <Eye size={16} color={ICON} />}
          </Button>
        </View>
      </View>

      <View className="gap-1">
        <Text className="text-[14px] font-medium text-foreground">Label (optional)</Text>
        <TextField
          value={label}
          onChangeText={setLabel}
          accessibilityLabel="Label"
          maxLength={256}
          placeholder="Work project"
        />
      </View>

      {error !== '' ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {error}
        </Text>
      ) : null}

      <View className="flex-row items-center gap-2">
        <Button
          variant="default"
          size="sm"
          accessibilityLabel="Save the connection"
          disabled={busy}
          onPress={submit}
        >
          <Text>{busy ? 'Saving…' : 'Save'}</Text>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          accessibilityLabel="Cancel"
          disabled={busy}
          onPress={onCancel}
        >
          <Text>Cancel</Text>
        </Button>
      </View>
    </View>
  );
}
