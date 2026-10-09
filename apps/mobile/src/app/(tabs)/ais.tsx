import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Effect } from 'effect';
import { Plus, Zap } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { useColorScheme } from 'nativewind';

import { RequireAisAuth } from '@/components/ais/require-ais-auth';
import { AiActionsSheet } from '@/components/ais/ai-actions-sheet';
import { AiRow } from '@/components/ais/ai-row';
import { DeleteConfirmDialog } from '@/components/ais/delete-confirm';
import { describeAisError, type AisErrorInfo } from '@/components/ais/errors';
import { type RunAction } from '@/components/ais/run-state';
import { AisScreenShell } from '@/components/ais/screen-shell';
import { useAisApi } from '@/components/ais/use-ais-api';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ACCENT, ICON } from '@/lib/colors';
import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT_FOREGROUND } from '@/lib/depth';
import { AisApiError, type PublicAi } from '@/lib/ais-api';

type PageStatus = 'loading' | 'ready' | 'error';

// Returns a copy of `keys` with `key` added (on) or removed (off).
function withKey(keys: ReadonlySet<string>, key: string, on: boolean): ReadonlySet<string> {
  const next = new Set(keys);
  if (on) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
}

// The AI api calls keep their own error class: describeAisError and the 409
// check read AisApiError, so these are not mapped to ApiFailure (fromApi).
const apiCall = <A,>(call: () => Promise<A>) =>
  Effect.tryPromise({ try: call, catch: (cause: unknown) => cause });

export default function AisScreen() {
  return (
    <RequireAisAuth>
      <AisList />
    </RequireAisAuth>
  );
}

function AisList() {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const params = useLocalSearchParams<{ highlight?: string }>();
  const highlightId = typeof params.highlight === 'string' ? params.highlight : null;
  const { api } = useAisApi();

  const [ais, setAis] = useState<PublicAi[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [errorInfo, setErrorInfo] = useState<AisErrorInfo>({ message: '', unavailable: false });

  const [actionAi, setActionAi] = useState<PublicAi | null>(null);
  const [confirmAi, setConfirmAi] = useState<PublicAi | null>(null);
  const [deleteError, setDeleteError] = useState('');
  // T-0095: the kill switch state. `runError` renders inline in the sheet on
  // failure (the sheet stays open so the owner can retry), and a 409 also
  // reloads the list because the AI changed under them. The action runs one
  // call at a time: a second tap while one waits is dropped.
  const [runError, setRunError] = useState('');

  // The list load. A focus reload, a retry and a 409 reload all come here;
  // leaving the screen does not cancel it (as before).
  const reload = useCallback(() => {
    setStatus('loading');
    Effect.runFork(
      apiCall(() => api.listAis()).pipe(
        Effect.tap((list) =>
          Effect.sync(() => {
            setAis(list);
            setStatus('ready');
          }),
        ),
        Effect.catch((error: unknown) =>
          Effect.sync(() => {
            setErrorInfo(describeAisError(error, 'Could not load your AIs'));
            setStatus('error');
          }),
        ),
      ),
    );
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const closeActions = (): void => {
    setActionAi(null);
    setRunError('');
  };

  // T-0095: stop or resume the AI the sheet is open for. The server's answer
  // is the source of truth, so the list swaps to it on success. On a 409 the
  // AI is not in a state this action applies to; the sheet closes and the list
  // is reloaded so the row matches the server. Any other failure keeps the
  // sheet open so the inline error is visible and the owner can retry.
  // One call per key at a time (one action per row): a second tap on the same
  // AI's action is dropped; other AIs are not blocked. The ref is read only in
  // handlers; the state drives the busy display.
  const inFlight = useRef(new Set<string>());
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(() => new Set());
  const runKeyed = (key: string, call: Effect.Effect<void>): void => {
    if (inFlight.current.has(key)) {
      return;
    }
    inFlight.current.add(key);
    setBusyKeys((keys) => withKey(keys, key, true));
    Effect.runFork(
      call.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            inFlight.current.delete(key);
            setBusyKeys((keys) => withKey(keys, key, false));
          }),
        ),
      ),
    );
  };

  const stopOrResume = (ai: PublicAi, next: RunAction): Effect.Effect<void> =>
    apiCall(() => (next === 'stop' ? api.stopAi(ai.id) : api.resumeAi(ai.id))).pipe(
      Effect.tap((fresh) =>
        Effect.sync(() => {
          setAis((previous) => previous.map((item) => (item.id === fresh.id ? fresh : item)));
          setActionAi((current) => (current?.id === ai.id ? null : current));
        }),
      ),
      Effect.catch((error: unknown) =>
        Effect.sync(() => {
          if (error instanceof AisApiError && error.status === 409) {
            // The AI is not in a state this action applies to (still being set
            // up, or changed elsewhere). Reload so the row says so, and close
            // the sheet: its Stop / Resume button would otherwise be stale.
            setActionAi((current) => (current?.id === ai.id ? null : current));
            reload();
            return;
          }
          setRunError(describeAisError(error, 'Could not change the AI state').message);
        }),
      ),
    );
  const runBusy = actionAi !== null && busyKeys.has(`run:${actionAi.id}`);

  const toggleRun = (next: RunAction): void => {
    if (actionAi === null) {
      return;
    }
    setRunError('');
    runKeyed(`run:${actionAi.id}`, stopOrResume(actionAi, next));
  };

  const openEdit = (ai: PublicAi): void => {
    setActionAi(null);
    router.push({ pathname: '/ais/[id]', params: { id: ai.id } });
  };

  const askDelete = (ai: PublicAi): void => {
    setActionAi(null);
    setDeleteError('');
    setConfirmAi(ai);
  };

  const removeAi = (ai: PublicAi): Effect.Effect<void> =>
    apiCall(() => api.deleteAi(ai.id)).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          setAis((previous) => previous.filter((item) => item.id !== ai.id));
          setConfirmAi((current) => (current?.id === ai.id ? null : current));
        }),
      ),
      Effect.catch((error: unknown) =>
        Effect.sync(() => {
          setDeleteError(describeAisError(error, 'Could not delete the AI').message);
        }),
      ),
    );
  const deleting = confirmAi !== null && busyKeys.has(`delete:${confirmAi.id}`);

  // One confirm per AI at a time: a second confirm on the same AI while its
  // DELETE is in flight is dropped.
  const confirmDelete = (): void => {
    if (confirmAi === null) {
      return;
    }
    setDeleteError('');
    runKeyed(`delete:${confirmAi.id}`, removeAi(confirmAi));
  };

  return (
    <>
      <AisScreenShell
        title="My AIs"
        subtitle="Your AIs, their model and their spending limits."
        scroll
        right={
          <IconButton label="Create AI" onPress={() => router.push('/ais/new')}>
            <Plus size={22} color={ICON[scheme]} />
          </IconButton>
        }
      >
        {status === 'loading' && <StateMessage kind="loading" title="Loading…" />}

        {status === 'error' && (
          <StateMessage
            kind="error"
            title={errorInfo.message}
            hint={
              errorInfo.unavailable ? 'AI management is not available on this server.' : undefined
            }
            action={{ label: 'Retry', onPress: reload }}
          />
        )}

        {status === 'ready' && ais.length === 0 && (
          <View className="items-center gap-3 pt-16">
            <Zap size={32} color={ACCENT[scheme]} />
            <Text className="px-4 text-center text-[15px] text-muted-foreground">
              You have no AIs yet. Create one to give it a chat account and a budget.
            </Text>
            <Button onPress={() => router.push('/ais/new')}>
              <Plus size={16} color={ACCENT_FOREGROUND} />
              <Text>Create an AI</Text>
            </Button>
          </View>
        )}

        {status === 'ready' && ais.length > 0 && (
          <View className="gap-3">
            <Button className="self-start" onPress={() => router.push('/ais/new')}>
              <Plus size={16} color={ACCENT_FOREGROUND} />
              <Text>Create AI</Text>
            </Button>
            <View className="gap-1">
              {ais.map((ai) => (
                <AiRow
                  key={ai.id}
                  ai={ai}
                  highlighted={ai.id === highlightId}
                  onPress={() => setActionAi(ai)}
                />
              ))}
            </View>
          </View>
        )}
      </AisScreenShell>

      <AiActionsSheet
        ai={actionAi}
        onOpenChat={() => {
          if (actionAi !== null) {
            const jid = actionAi.jid;
            setActionAi(null);
            router.push({ pathname: '/chat/[id]', params: { id: jid } });
          }
        }}
        onEdit={() => {
          if (actionAi !== null) {
            openEdit(actionAi);
          }
        }}
        onDelete={() => {
          if (actionAi !== null) {
            askDelete(actionAi);
          }
        }}
        onToggleRun={toggleRun}
        runBusy={runBusy}
        runError={runError}
        onClose={closeActions}
      />

      <DeleteConfirmDialog
        aiName={confirmAi?.name ?? null}
        busy={deleting}
        error={deleteError}
        onCancel={() => setConfirmAi(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
