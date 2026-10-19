import { useFocusEffect, useRouter } from 'expo-router';
import { Deferred, Effect } from 'effect';
import { KeyRound, Plus, MoreHorizontal } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { providerLabel } from '@zilar/chat-core';
import { ApiError } from '@zilar/api-contract';
import { makeAisApi, type Connection } from '@zilar/client-core';
import { KeyStep } from '@/components/ais/new-ai/key-step';
import { ProviderStep } from '@/components/ais/new-ai/provider-step';
import { ConnectionSheet } from '@/components/connections/connection-sheet';
import { useKeyCheck } from '@/components/connections/use-key-check';
import { useApi } from '@/lib/use-mockable-api';
import { usePullToRefresh } from '@/components/settings/screen-shell';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StateMessage } from '@/components/ui/state-message';
import { StepTrack, type StepTrackStep } from '@/components/ui/step-track';
import { Text } from '@/components/ui/text';
import { Toast, type ToastMessage } from '@/components/ui/toast';
import { MUTED_FOREGROUND, ICON } from '@/lib/colors';
import { useAction } from '@/lib/effect/use-action';
import { IconButton } from '@/components/ui/icon-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { cn } from '@/lib/utils';

interface ConnectionsErrorInfo {
  message: string;
}

// Maps the connection error codes to fixed plain sentences. Unknown codes
// answer the `fallback` the call site passes: user-facing text is never the
// server's raw message.
function describeConnectionsError(error: unknown, fallback: string): ConnectionsErrorInfo {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'connection_in_use':
        return { message: 'An AI still uses this connection. Switch the AI first.' };
      case 'rate_limited':
        return { message: 'Too many requests. Try again in a few minutes.' };
      case 'not_found':
        return { message: 'That connection no longer exists.' };
      case 'network_error':
        return { message: 'Could not reach the server.' };
      case 'key_unreadable':
        return { message: 'The stored key could not be read. Remove it and add it again.' };
      case 'connections_unavailable':
        return { message: 'Connections are not set up on this server.' };
      default:
        return { message: fallback };
    }
  }
  return { message: error instanceof Error ? error.message : fallback };
}

type PageStatus = 'loading' | 'ready' | 'error';

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record;
  }
  const { [key]: _removed, ...rest } = record;
  void _removed;
  return rest;
}

/**
 * The host of a custom connection's base URL, e.g. `api.groq.com`. The server
 * stores a validated https URL, so a plain split is enough and never throws.
 */
function hostOf(baseUrl: string): string {
  const withoutScheme = baseUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  return withoutScheme.split('/')[0] ?? baseUrl;
}

function addedDate(createdAt: string): string {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(
    new Date(createdAt),
  );
}

function ConnectionRow({
  connection,
  working,
  reason,
  last,
  onPress,
}: {
  connection: Connection;
  working: boolean;
  reason: string | undefined;
  last: boolean;
  onPress: () => void;
}) {
  const label = providerLabel(connection.provider);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} key actions`}
      onPress={onPress}
      className={cn(
        'min-h-[64px] flex-row items-center gap-3 pl-4 pr-3 active:bg-list-hover',
        last ? undefined : 'border-b border-divider',
      )}
    >
      <View
        accessibilityRole="image"
        accessibilityLabel={working ? 'Working' : 'Not working'}
        className={cn('h-2 w-2 shrink-0 rounded-full', working ? 'bg-online' : 'bg-danger')}
      />
      <View className="min-w-0 flex-1">
        <Text className="text-[16px] font-semibold text-foreground">{label}</Text>
        <Text numberOfLines={1} className="text-[14px] text-muted-foreground">
          {reason !== undefined ? <Text className="text-danger">{reason}</Text> : null}
          {reason !== undefined ? ' · ' : ''}
          {connection.label !== null ? `${connection.label} · ` : ''}
          {connection.baseUrl !== null ? `${hostOf(connection.baseUrl)} · ` : ''}
          {addedDate(connection.createdAt)}
        </Text>
      </View>
      <MoreHorizontal size={18} color={MUTED_FOREGROUND} />
    </Pressable>
  );
}

function ConnectionsHeader({
  onBack,
  onAdd,
  showAdd,
}: {
  onBack: () => void;
  onAdd: () => void;
  showAdd: boolean;
}) {
  return (
    <ScreenHeader
      variant="sub"
      title="Connections"
      onBack={onBack}
      right={
        showAdd ? (
          <IconButton label="Add key" onPress={onAdd}>
            <Plus size={22} color={ICON} />
          </IconButton>
        ) : undefined
      }
    />
  );
}

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

  const onTestFailed = () => setSheetId(null);
  const onReplaced = () => {
    setSheetId(null);
    setToast({ id: Date.now(), text: 'Key replaced', tone: 'notice' });
  };

  const { api } = useApi(makeAisApi);

  const [connections, setConnections] = useState<Connection[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  // `reload` keeps its identity, so a load reads the current status from here:
  // only a screen with nothing shown yet gets the loading message.
  const statusRef = useRef<PageStatus>('loading');
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const [errorInfo, setErrorInfo] = useState<ConnectionsErrorInfo>({ message: '' });
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, boolean>>({});
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [busy, setBusy] = useState(false);
  // Bumped whenever a replace starts. A test that began earlier captured the
  // old value, so its late result belongs to the replaced key and is dropped.
  const replaceGeneration = useRef(0);

  // Latest reload wins: a focus reload replaces a load still in flight.
  const [, load] = useAction(
    (settled: Deferred.Deferred<void>) =>
      Effect.sync(() => {
        // A reload over a ready list keeps the rows on screen.
        if (statusRef.current !== 'ready') {
          setStatus('loading');
        }
        setErrorInfo({ message: '' });
      }).pipe(
        Effect.andThen(
          Effect.tryPromise({
            try: () => api.listConnections(),
            catch: (cause): ConnectionsErrorInfo =>
              describeConnectionsError(cause, 'Could not load your connections.'),
          }),
        ),
        Effect.tap((list) =>
          Effect.sync(() => {
            setConnections(list);
            setStatus('ready');
          }),
        ),
        Effect.catch((info) =>
          Effect.sync(() => {
            setErrorInfo(info);
            // A failed background reload keeps the list; the banner shows why.
            if (statusRef.current !== 'ready') {
              setStatus('error');
            }
          }),
        ),
        Effect.ensuring(Effect.sync(() => Deferred.doneUnsafe(settled, Effect.void))),
      ),
    { mode: 'replace' },
  );

  // Returns a promise that settles when this load ends, so a pull stops on time.
  const reload = useCallback(() => {
    const settled = Deferred.makeUnsafe<void>();
    load(settled);
    return Effect.runPromise(Deferred.await(settled));
  }, [load]);

  // A second tap on any Test is ignored while one test runs (one lock for
  // all rows, as the server rate-limits key tests per user).
  const [, runTest] = useAction((id: string) => {
    // The key this test runs against; a replace started after it bumps the
    // counter, so the late result is dropped instead of trusted for the new key.
    const generation = replaceGeneration.current;
    return Effect.sync(() => {
      setTestingId(id);
      setTestErrors((previous) => withoutKey(previous, id));
    }).pipe(
      Effect.andThen(
        Effect.tryPromise({
          try: () => api.testConnection(id),
          catch: (cause) => cause,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              if (replaceGeneration.current !== generation) {
                return;
              }
              setTestResults((previous) => ({ ...previous, [id]: result.ok }));
              if (!result.ok) {
                setTestErrors((previous) => ({ ...previous, [id]: 'The key was rejected.' }));
                onTestFailed();
              }
            }),
          ),
          Effect.catch(() =>
            Effect.sync(() => {
              if (replaceGeneration.current !== generation) {
                return;
              }
              setTestResults((previous) => ({ ...previous, [id]: false }));
              setTestErrors((previous) => ({ ...previous, [id]: 'Could not test the key.' }));
              onTestFailed();
            }),
          ),
        ),
      ),
      Effect.ensuring(Effect.sync(() => setTestingId(null))),
    );
  });

  // The new key is untested, so its row forgets this screen's last result.
  const [, runReplaceKey] = useAction((input: { id: string; key: string }) =>
    Effect.sync(() => {
      setReplacing(true);
      setReplaceError('');
    }).pipe(
      Effect.andThen(
        Effect.tryPromise({
          try: () => api.replaceConnectionKey(input.id, input.key),
          catch: (cause): ConnectionsErrorInfo =>
            describeConnectionsError(cause, 'Could not replace the key.'),
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              setTestResults((previous) => withoutKey(previous, input.id));
              setTestErrors((previous) => withoutKey(previous, input.id));
              onReplaced();
            }),
          ),
          Effect.catch((info) => Effect.sync(() => setReplaceError(info.message))),
        ),
      ),
      Effect.ensuring(Effect.sync(() => setReplacing(false))),
    ),
  );

  const clearReplaceError = useCallback(() => setReplaceError(''), []);

  const replaceKey = useCallback(
    (id: string, key: string) => {
      // Any test already in flight now describes the old key, so its result is
      // dropped when it lands (see `runTest`).
      replaceGeneration.current += 1;
      runReplaceKey({ id, key });
    },
    [runReplaceKey],
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

  const isWorking = (connection: Connection): boolean =>
    connection.status === 'active' && testErrors[connection.id] === undefined;

  const reasonOf = (connection: Connection): string | undefined =>
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

function AddKeySheet({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const keys = useKeyCheck();
  const [step, setStep] = useState(0);

  const providerLabel =
    keys.choices.find((choice) => choice.id === keys.providerId)?.label ??
    keys.providerId ??
    'Provider';
  const steps: StepTrackStep[] = [
    { value: 'provider', label: keys.providerId === null ? 'Provider' : providerLabel },
    { value: 'key', label: 'Key' },
  ];

  const close = (): void => {
    keys.abandon();
    onClose();
  };

  const primary = (): void => {
    if (step === 0) {
      if (keys.continueProvider()) setStep(1);
      return;
    }
    if (keys.keyVerified) {
      keys.claim();
      onSaved();
      return;
    }
    keys.continueKey();
  };

  const primaryDisabled =
    step === 0
      ? !keys.providerReady
      : keys.checkingKey || (!keys.keyVerified && keys.key.trim() === '');

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      closeLabel="Close Add key"
      title="Add key"
      footer={
        <View className="flex-row items-center gap-2">
          {step > 0 ? (
            <Button variant="ghost" disabled={keys.checkingKey} onPress={() => setStep(0)}>
              <Text>Back</Text>
            </Button>
          ) : null}
          <Button className="flex-1" disabled={primaryDisabled} onPress={primary}>
            <Text>{step === 0 ? 'Continue' : keys.keyVerified ? 'Save' : 'Continue'}</Text>
          </Button>
        </View>
      }
    >
      <View className="gap-4">
        <StepTrack
          steps={steps}
          current={step === 0 ? 'provider' : 'key'}
          onStepPress={() => {
            if (!keys.checkingKey) setStep(0);
          }}
        />
        {step === 0 ? <ProviderStep keys={keys} /> : null}
        {step === 1 ? <KeyStep keys={keys} /> : null}
      </View>
    </BottomSheet>
  );
}
