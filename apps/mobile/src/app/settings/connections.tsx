import { useFocusEffect, useRouter } from 'expo-router';
import {
  ChevronLeft,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Zap,
} from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';

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
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT, ACCENT_FOREGROUND, ICON } from '@/lib/colors';
import type { ProviderConnection } from '@/lib/connections-api';

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
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const { api } = useConnectionsApi();

  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [errorInfo, setErrorInfo] = useState<ConnectionsErrorInfo>({ message: '' });
  const [showForm, setShowForm] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const testingRef = useRef(false);
  const [testResults, setTestResults] = useState<Record<string, boolean>>({});
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [busy, setBusy] = useState(false);
  // Guards against a double tap landing before React re-renders the disabled
  // button, so one Remove can never DELETE twice.
  const busyRef = useRef(false);

  const reload = useCallback(() => {
    setStatus('loading');
    void api
      .listConnections()
      .then((list) => {
        setConnections(list);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        setErrorInfo(describeConnectionsError(error, 'Could not load your connections.'));
        setStatus('error');
      });
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const test = (id: string): void => {
    // A second tap that lands before the disabled state propagates must
    // not fire a second test (the server rate-limits key tests per user).
    if (testingRef.current) {
      return;
    }
    testingRef.current = true;
    setTestingId(id);
    setTestErrors((previous) => {
      if (!(id in previous)) return previous;
      const { [id]: _removed, ...rest } = previous;
      void _removed;
      return rest;
    });
    void api
      .testConnection(id)
      .then((result) => {
        setTestResults((previous) => ({ ...previous, [id]: result.ok }));
        if (!result.ok) {
          setTestErrors((previous) => ({ ...previous, [id]: 'The key was rejected.' }));
        }
      })
      .catch(() => {
        setTestResults((previous) => ({ ...previous, [id]: false }));
        setTestErrors((previous) => ({ ...previous, [id]: 'Could not test the key.' }));
      })
      .finally(() => {
        testingRef.current = false;
        setTestingId(null);
      });
  };

  const confirmRemove = (id: string): void => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setRemoveError('');
    void api
      .deleteConnection(id)
      .then(() => {
        setConnections((previous) => previous.filter((connection) => connection.id !== id));
        setConfirmingId(null);
      })
      .catch((error: unknown) => {
        setRemoveError(describeConnectionsError(error, 'Could not remove the connection.').message);
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center gap-1 px-2 py-2">
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={ICON[scheme]} />
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
            <Plus size={22} color={ICON[scheme]} />
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
            <View className="items-center gap-3 pt-16">
              <ActivityIndicator color={ACCENT[scheme]} />
              <Text className="text-[15px] text-muted-foreground">Loading connections…</Text>
            </View>
          ) : null}

          {status === 'error' ? (
            <View className="items-center gap-3 pt-12">
              <Text accessibilityRole="alert" className="text-center text-[15px] text-danger">
                {errorInfo.message}
              </Text>
              <Button
                variant="outline"
                size="sm"
                accessibilityLabel="Retry loading connections"
                onPress={reload}
              >
                <RefreshCw size={16} color={ICON[scheme]} />
                <Text>Retry</Text>
              </Button>
            </View>
          ) : null}

          {status === 'ready' && connections.length === 0 && !showForm ? (
            <View className="items-center gap-3 pt-16">
              <KeyRound size={32} color={ICON[scheme]} />
              <Text className="px-4 text-center text-[15px] text-muted-foreground">
                No provider connections yet.
              </Text>
              <Button
                variant="default"
                size="sm"
                accessibilityLabel="Add a connection"
                onPress={() => setShowForm(true)}
              >
                <Plus size={16} color={ACCENT_FOREGROUND[scheme]} />
                <Text>Add a connection</Text>
              </Button>
            </View>
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
                              onPress={() => {
                                setConfirmingId(null);
                                setRemoveError('');
                              }}
                            >
                              <Text>Cancel</Text>
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              accessibilityLabel="Confirm remove"
                              disabled={busy}
                              onPress={() => confirmRemove(connection.id)}
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
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Test ${providerLabel(connection.provider)} key`}
                              disabled={testingId === connection.id}
                              onPress={() => test(connection.id)}
                              className="rounded-full p-2 active:bg-surface-raised disabled:opacity-50"
                            >
                              <Zap size={16} color={ICON[scheme]} />
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Remove ${providerLabel(connection.provider)} connection`}
                              onPress={() => {
                                setConfirmingId(connection.id);
                                setRemoveError('');
                              }}
                              className="rounded-full p-2 active:bg-surface-raised"
                            >
                              <Trash2 size={16} color={ICON[scheme]} />
                            </Pressable>
                          </View>
                        </View>
                      ),
                    )}
                  </Card>
                </View>
              ) : null}

              {showForm ? (
                <AddConnectionForm
                  scheme={scheme}
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
  scheme,
  onCancel,
  onSaved,
}: {
  scheme: 'light' | 'dark';
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
  const busyRef = useRef(false);

  const submit = (): void => {
    if (busyRef.current) {
      return;
    }
    const trimmedKey = key.trim();
    if (trimmedKey === '') {
      setError('Paste your API key.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    void saveConnection(api, { provider, key: trimmedKey, label: label.trim() }).then((outcome) => {
      // Write-only: the transition empties the field on success and keeps
      // the typed key for retry on failure.
      setKey(keyAfterSave(outcome, trimmedKey));
      setShowKey(false);
      if (outcome.connection !== null) {
        onSaved(outcome.connection);
      } else {
        setError(outcome.error);
      }
      busyRef.current = false;
      setBusy(false);
    });
  };

  return (
    <View className="gap-3 rounded-xl border border-border bg-surface p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-[16px] font-semibold text-foreground">New connection</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the form"
          onPress={onCancel}
          className="rounded-full p-1 active:bg-surface-raised"
        >
          <X size={16} color={ICON[scheme]} />
        </Pressable>
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showKey ? 'Hide key' : 'Show key'}
            onPress={() => setShowKey((value) => !value)}
            className="rounded-full p-2 active:bg-surface-raised"
          >
            {showKey ? (
              <EyeOff size={16} color={ICON[scheme]} />
            ) : (
              <Eye size={16} color={ICON[scheme]} />
            )}
          </Pressable>
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
