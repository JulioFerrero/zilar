import { ApiError } from '@zilar/api-contract';
import {
  aiHealth,
  formatLimit,
  formatUsd,
  spendFraction,
  type AiHealthState,
  type ChatSummary,
} from '@zilar/chat-core';
import { useFocusEffect, useRouter } from 'expo-router';
import { Effect } from 'effect';
import { Plus, Zap } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { RequireAisAuth } from '@/components/ais/require-ais-auth';
import { describeAisError, type AisErrorInfo } from '@/components/ais/errors';
import { NewAiSheet } from '@/components/ais/new-ai/new-ai-sheet';
import { AisScreenShell } from '@/components/ais/screen-shell';
import { makeAisApi, type PublicAi } from '@zilar/client-core';
import { useApi } from '@/lib/use-mockable-api';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ACCENT, ICON } from '@/lib/colors';
import { ACCENT_FOREGROUND } from '@/lib/depth';
import { useChatStoreApi } from '@/store/chat-store-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AiBadge } from '@/components/chat/ai-badge';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { cn } from '@/lib/utils';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';

function AiActionsSheet({
  ai,
  onOpenChat,
  onEdit,
  onDelete,
  onToggleRun,
  runBusy,
  runError,
  onClose,
}: {
  ai: PublicAi | null;
  onOpenChat: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleRun: (action: RunAction) => void;
  /** The button shows "Stopping…" / "Resuming…" and ignores taps so a double-tap cannot send a second request. */
  runBusy: boolean;
  /** The sheet stays open on failure so the owner can read the inline error and retry. */
  runError: string;
  onClose: () => void;
}) {
  const action = ai === null ? null : runAction(ai);
  return (
    <ActionSheet
      visible={ai !== null}
      onClose={onClose}
      closeLabel="Close AI actions"
      error={runError}
      header={
        ai === null ? undefined : (
          <View className="flex-row items-center gap-3 px-4 py-3">
            <EntityAvatar
              person={{ id: ai.jid, name: ai.name, avatarUrl: ai.avatarUrl }}
              size={36}
            />
            <Text numberOfLines={1} className="min-w-0 flex-1 text-[16px] font-semibold">
              {ai.name}
            </Text>
          </View>
        )
      }
    >
      <ActionSheetItem label="Open chat" onPress={onOpenChat} />
      <ActionSheetItem label="Edit" onPress={onEdit} />
      {action !== null ? (
        <ActionSheetItem
          label={
            action === 'stop' ? (runBusy ? 'Stopping…' : 'Stop') : runBusy ? 'Resuming…' : 'Resume'
          }
          accessibilityLabel={action === 'stop' ? 'Stop AI' : 'Resume AI'}
          disabled={runBusy}
          onPress={() => onToggleRun(action)}
        />
      ) : null}
      <ActionSheetItem label="Delete" onPress={onDelete} destructive />
    </ActionSheet>
  );
}

/**
 * A `Modal`, not `Alert.alert`: the app has no `Alert` anywhere, and its other confirmations are Modals too.
 */
function DeleteConfirmDialog({
  aiName,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  aiName: string | null;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      visible={aiName !== null}
      title={`Delete ${aiName ?? 'AI'}?`}
      message="This removes the AI's chat account and its provider key."
      error={error}
      confirmLabel="Remove"
      busyLabel="Removing…"
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

type PageStatus = 'loading' | 'ready' | 'error';

function withKey(keys: ReadonlySet<string>, key: string, on: boolean): ReadonlySet<string> {
  const next = new Set(keys);
  if (on) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
}

// These keep their own error class: describeAisError and the 409 check read ApiError.
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
  const { api } = useApi(makeAisApi);
  const store = useChatStoreApi();

  const [ais, setAis] = useState<PublicAi[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [errorInfo, setErrorInfo] = useState<AisErrorInfo>({ message: '', unavailable: false });

  const [actionAi, setActionAi] = useState<PublicAi | null>(null);
  const [confirmAi, setConfirmAi] = useState<PublicAi | null>(null);
  const [deleteError, setDeleteError] = useState('');
  // A partial save is reported by the chat screen it opens, so the notice is not lost behind the sheet.
  const [newAiOpen, setNewAiOpen] = useState(false);
  // A fresh session on each open, so a closed sheet never reopens on an old provider's name or key.
  const [newAiSession, setNewAiSession] = useState(0);
  const openNewAi = (): void => {
    setNewAiSession((session) => session + 1);
    setNewAiOpen(true);
  };
  // `runError` renders inline on failure (the sheet stays open to retry); a 409 also reloads the list. One call at a time: a second tap while one waits is dropped.
  const [runError, setRunError] = useState('');

  // A reload with the list on screen refreshes it in place: only a load with nothing to show takes the loading state or the error view.
  const reload = useCallback(() => {
    setStatus((current) => (current === 'ready' ? current : 'loading'));
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
            setStatus((current) => (current === 'ready' ? current : 'error'));
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

  // On a 409 the AI is not in a state this action applies to: the sheet closes and the list reloads so the row matches the server. One call per AI at a time; other AIs are not blocked.
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

  // Stop and resume answer the fresh public AI, so the row is swapped from server truth without a second GET.
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
          if (error instanceof ApiError && error.status === 409) {
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

  // The AI's chat is not in the roster yet, so add it before opening it; a partial save rides a `notice` param that the chat shows once.
  const handleCreated = (ai: PublicAi, partialFailure: boolean): void => {
    setNewAiOpen(false);
    const summary: ChatSummary = {
      id: ai.jid,
      title: ai.name,
      kind: 'dm',
      isAI: true,
      space: 'personal',
      unread: 0,
      muted: false,
      online: false,
      // An empty new AI chat sorts by the AI's creation time, so it leads the list until a message lands.
      createdAt: new Date(ai.createdAt),
    };
    store.setState((state) => ({
      chats: state.chats.some((chat) => chat.id === summary.id)
        ? state.chats
        : [summary, ...state.chats],
    }));
    router.push({
      pathname: '/chat/[id]',
      params: partialFailure ? { id: ai.jid, notice: 'partial' } : { id: ai.jid },
    });
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
        scroll
        tabName="ais"
        right={
          <IconButton label="New AI" onPress={openNewAi}>
            <Plus size={22} color={ICON} />
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
            <Zap size={32} color={ACCENT} />
            <Text className="px-4 text-center text-[15px] text-muted-foreground">
              You have no AIs yet. Create one to give it a chat account and a budget.
            </Text>
            <Button onPress={openNewAi}>
              <Plus size={16} color={ACCENT_FOREGROUND} />
              <Text>Create an AI</Text>
            </Button>
          </View>
        )}

        {status === 'ready' && ais.length > 0 && (
          <View className="overflow-hidden rounded-2xl border border-divider bg-surface">
            {ais.map((ai, index) => (
              <AiRow
                key={ai.id}
                ai={ai}
                last={index === ais.length - 1}
                onPress={() => setActionAi(ai)}
              />
            ))}
          </View>
        )}
      </AisScreenShell>

      <NewAiSheet
        key={newAiSession}
        visible={newAiOpen}
        onClose={() => setNewAiOpen(false)}
        onCreated={handleCreated}
      />

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

/**
 * `disabled` AIs (provisioning in flight) offer neither: the row already says "Setting up" and the buttons would race the server.
 */
type RunAction = 'stop' | 'resume';

function runAction(ai: Pick<PublicAi, 'status'>): RunAction | null {
  if (ai.status === 'active') {
    return 'stop';
  }
  if (ai.status === 'stopped') {
    return 'resume';
  }
  return null;
}

const HEALTH: Record<AiHealthState, { label: string; colour: string }> = {
  working: { label: 'Working', colour: 'bg-online' },
  failing: { label: 'Failing', colour: 'bg-danger' },
  paused: { label: 'Paused by its limit', colour: 'bg-[#f59e0b]' },
  stopped: { label: 'Stopped', colour: 'bg-subtle-foreground' },
};

const FIX_LABELS: Record<string, string> = {
  replace_key: 'Replace key',
  change_model: 'Change model',
};

function AiRow({ ai, last, onPress }: { ai: PublicAi; last: boolean; onPress: () => void }) {
  const router = useRouter();
  const health = aiHealth(ai);
  const dot = HEALTH[health.state];
  const usage = ai.usage ?? null;
  const dailyLimit = ai.limits.perDayUsd;
  const fraction = spendFraction(ai);
  const full = usage !== null && dailyLimit !== null && usage.todayUsd >= dailyLimit;
  const fixLabel = health.fix === undefined ? undefined : FIX_LABELS[health.fix];

  const openFix = (): void => {
    if (health.fix === 'change_model') {
      router.push({ pathname: '/ais/[id]', params: { id: ai.id } });
      return;
    }
    router.push('/settings/connections');
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ai.name}
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-3 px-3.5 py-3 active:bg-list-hover',
        !last && 'border-b border-divider',
      )}
    >
      <View className="relative shrink-0">
        <EntityAvatar
          person={{ id: ai.jid, name: ai.name, avatarUrl: ai.avatarUrl }}
          size={40}
          ai
        />
        <View
          accessibilityRole="image"
          accessibilityLabel={dot.label}
          className={cn(
            'absolute right-0 bottom-0 size-3 rounded-full border-2 border-surface',
            dot.colour,
          )}
        />
      </View>
      <View className="min-w-0 flex-1 flex-col gap-[3px]">
        <View className="flex-row items-center gap-1.5">
          <Text numberOfLines={1} className="shrink text-[16px] font-semibold text-foreground">
            {ai.name}
          </Text>
          <AiBadge />
        </View>
        <Text numberOfLines={2} className="text-[14px] text-muted-foreground">
          {health.state === 'stopped' ? (
            `Stopped · ${ai.model}`
          ) : health.state === 'failing' ? (
            <>
              <Text className="text-danger">{health.reason}</Text>
              {fixLabel === undefined ? (
                ` · ${ai.model}`
              ) : (
                <>
                  {' · '}
                  <Text
                    accessibilityRole="link"
                    accessibilityLabel={fixLabel}
                    onPress={openFix}
                    className="text-accent underline"
                  >
                    {fixLabel}
                  </Text>
                </>
              )}
            </>
          ) : health.state === 'paused' ? (
            <>
              <Text className="text-[#f59e0b]">Daily limit reached</Text>
              {` · ${ai.model}`}
            </>
          ) : (
            ai.model
          )}
        </Text>
      </View>
      <View className="w-24 shrink-0 flex-col items-end gap-[5px]">
        {usage === null ? (
          <Text className="font-mono text-[12px] text-muted-foreground">—</Text>
        ) : dailyLimit === null ? (
          <Text className="font-mono text-[12px] text-foreground">{formatUsd(usage.todayUsd)}</Text>
        ) : (
          <>
            <Text className="font-mono text-[12px] text-foreground">
              {formatUsd(usage.todayUsd)}
              <Text className="text-subtle-foreground">{` / ${formatLimit(dailyLimit)}`}</Text>
            </Text>
            <View className="h-1 w-[72px] overflow-hidden rounded-[2px] bg-well">
              <View
                className={cn('h-full', full ? 'bg-[#f59e0b]' : 'bg-foreground')}
                style={{ width: `${(fraction ?? 0) * 100}%` }}
              />
            </View>
          </>
        )}
      </View>
    </Pressable>
  );
}
