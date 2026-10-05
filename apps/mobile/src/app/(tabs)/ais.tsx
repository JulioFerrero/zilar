import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Plus, RefreshCw, Zap } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
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
import { Text } from '@/components/ui/text';
import { ACCENT, ICON } from '@/lib/colors';
import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT_FOREGROUND } from '@/lib/depth';
import { AisApiError, type PublicAi } from '@/lib/ais-api';

type PageStatus = 'loading' | 'ready' | 'error';

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
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  // Guards against a double tap landing before React re-renders the disabled
  // button, so one confirm can never send two DELETEs.
  const deletingRef = useRef(false);
  // T-0095: the kill switch state. `runBusy` keeps the action-sheet button
  // disabled while a request is in flight and shows "Stopping…" / "Resuming…".
  // `runError` renders inline in the sheet on failure (the sheet stays open
  // so the owner can retry), and a 409 also reloads the list because the AI
  // changed under them.
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState('');
  // A second ref like `deletingRef`: it stops a second tap that lands before
  // the disabled state has propagated through React.
  const runRef = useRef(false);

  const reload = useCallback(() => {
    setStatus('loading');
    void api
      .listAis()
      .then((list) => {
        setAis(list);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        setErrorInfo(describeAisError(error, 'Could not load your AIs'));
        setStatus('error');
      });
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
  const toggleRun = (next: RunAction): void => {
    if (actionAi === null || runRef.current) {
      return;
    }
    runRef.current = true;
    setRunBusy(true);
    setRunError('');
    const request = next === 'stop' ? api.stopAi(actionAi.id) : api.resumeAi(actionAi.id);
    void request
      .then((fresh) => {
        setAis((previous) => previous.map((ai) => (ai.id === fresh.id ? fresh : ai)));
        setActionAi(null);
      })
      .catch((error: unknown) => {
        if (error instanceof AisApiError && error.status === 409) {
          // The AI is not in a state this action applies to (still being set
          // up, or changed elsewhere). Reload so the row says so, and close
          // the sheet: its Stop / Resume button would otherwise be stale.
          setActionAi(null);
          reload();
          return;
        }
        setRunError(describeAisError(error, 'Could not change the AI state').message);
      })
      .finally(() => {
        runRef.current = false;
        setRunBusy(false);
      });
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

  const confirmDelete = (): void => {
    if (confirmAi === null || deletingRef.current) {
      return;
    }
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError('');
    void api
      .deleteAi(confirmAi.id)
      .then(() => {
        setAis((previous) => previous.filter((ai) => ai.id !== confirmAi.id));
        setConfirmAi(null);
      })
      .catch((error: unknown) => {
        setDeleteError(describeAisError(error, 'Could not delete the AI').message);
      })
      .finally(() => {
        deletingRef.current = false;
        setDeleting(false);
      });
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
        {status === 'loading' && (
          <View className="items-center gap-3 pt-16">
            <ActivityIndicator color={ACCENT[scheme]} />
            <Text className="text-[15px] text-muted-foreground">Loading…</Text>
          </View>
        )}

        {status === 'error' && (
          <View className="items-center gap-3 px-2 pt-12">
            <Text accessibilityRole="alert" className="text-center text-[15px] text-danger">
              {errorInfo.message}
            </Text>
            {errorInfo.unavailable ? (
              <Text className="text-center text-[14px] text-muted-foreground">
                AI management is not available on this server.
              </Text>
            ) : null}
            <Button variant="outline" onPress={reload}>
              <RefreshCw size={16} color={ICON[scheme]} />
              <Text>Retry</Text>
            </Button>
          </View>
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
