import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Brain, Trash2 } from 'lucide-react-native';
import { Effect } from 'effect';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { interruptFiber, type makeChatExtrasApi } from '@zilar/client-core';
import { ApiError, type AiMemoryView } from '@zilar/api-contract';

const MEMORY_LOAD_FAILED_MESSAGE = 'Could not load the memory';

const MEMORY_FORGET_FAILED_MESSAGE = 'Could not forget that fact';

const MEMORY_CLEAR_FAILED_MESSAGE = 'Could not clear the memory';

type AiMemoryStatus = 'loading' | 'ready' | 'error';

interface AiMemorySectionState {
  open: boolean;
  status: AiMemoryStatus;
  memory: AiMemoryView | null;
  forgetError: string;
  forgettingId: string | null;
  clearError: string;
  confirmingClear: boolean;
}

interface AiMemorySectionActions {
  onShow: () => void;
  onHide: () => void;
  onRetry: () => void;
  onForget: (factId: string) => void;
  onAskClear: () => void;
  onCancelClear: () => void;
  onConfirmClear: () => void;
}

function removeFact(memory: AiMemoryView, factId: string): AiMemoryView {
  return { ...memory, facts: memory.facts.filter((fact) => fact.id !== factId) };
}

/** A 404 means the fact is already gone, which the caller treats as success. */
const requestForgetFactEffect = (
  api: ReturnType<typeof makeChatExtrasApi>,
  chat: string,
  aiId: string,
  factId: string,
) =>
  Effect.tryPromise({
    try: () => api.forgetAiMemoryFact(chat, aiId, factId),
    catch: (cause) => cause,
  }).pipe(
    Effect.catch((error) =>
      error instanceof ApiError && error.status === 404 ? Effect.void : Effect.fail(error),
    ),
  );

const clearAiMemoryEffect = (
  api: ReturnType<typeof makeChatExtrasApi>,
  chat: string,
  aiId: string,
) =>
  Effect.tryPromise({ try: () => api.clearAiMemory(chat, aiId), catch: (cause) => cause }).pipe(
    Effect.flatMap(() =>
      Effect.tryPromise({ try: () => api.getAiMemory(chat, aiId), catch: (cause) => cause }),
    ),
  );

// The cover lines carry a leading block reference (`#16` or `#0-15`) that is only meaningful to the server; the section strips it.
const LINE_PREFIX = /^#\d+(?:-\d+)? /;

export function AiMemorySectionContent({
  state,
  aiName,
  actions,
  initiallyOpen = false,
}: {
  state: AiMemorySectionState;
  aiName: string;
  actions: AiMemorySectionActions;
  initiallyOpen?: boolean;
}) {
  const { open, status, memory, forgetError, forgettingId, clearError, confirmingClear } = state;
  return (
    <View accessibilityLabel="Memory" className="gap-2 border-t border-divider pt-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-[14px] font-medium">Memory</Text>
        {open && !initiallyOpen ? (
          <Button
            variant="ghost"
            size="sm"
            accessibilityLabel="Hide memory"
            onPress={actions.onHide}
          >
            <Text>Hide memory</Text>
          </Button>
        ) : null}
      </View>

      {!open ? (
        <View className="items-start gap-2">
          <Text className="text-[13px] text-muted-foreground">
            What {aiName} remembers from this chat. It reads this before replying.
          </Text>
          <Button
            variant="ghost"
            size="lg"
            accessibilityLabel="Show memory"
            onPress={actions.onShow}
          >
            <Brain size={16} />
            <Text>Show memory</Text>
          </Button>
        </View>
      ) : null}

      {open && status === 'loading' ? (
        <StateMessage kind="loading" size="inline" title="Loading the memory…" />
      ) : null}

      {open && status === 'error' ? (
        <StateMessage
          kind="error"
          title={MEMORY_LOAD_FAILED_MESSAGE}
          action={{ label: 'Retry', accessibilityLabel: 'Retry', onPress: actions.onRetry }}
        />
      ) : null}

      {open && status === 'ready' && memory !== null ? (
        <>
          <View className="gap-2">
            <Text className="text-[13px] font-medium text-muted-foreground">Pinned facts</Text>
            {forgetError !== '' ? (
              <Text accessibilityRole="alert" className="text-[13px] text-danger">
                {forgetError}
              </Text>
            ) : null}
            {memory.facts.length === 0 ? (
              <Text className="text-[13px] text-muted-foreground">Nothing pinned yet.</Text>
            ) : (
              <View className="gap-1.5">
                {memory.facts.map((fact) => (
                  <View key={fact.id} className="flex-row items-start justify-between gap-2">
                    <Text className="flex-1 text-[13px]">{fact.text}</Text>
                    {memory.canChange ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        accessibilityLabel="Forget this fact"
                        disabled={forgettingId === fact.id}
                        className="h-7 w-7 rounded-full"
                        onPress={() => actions.onForget(fact.id)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </View>

          <View className="gap-2">
            <Text className="text-[13px] font-medium text-muted-foreground">
              Earlier in this chat
            </Text>
            {memory.lines.length === 0 ? (
              <Text className="text-[13px] text-muted-foreground">
                Nothing older than the recent messages yet.
              </Text>
            ) : (
              <View className="gap-1.5">
                {memory.lines.map((line, index) => (
                  <Text key={index} className="text-[13px] text-muted-foreground">
                    {line.replace(LINE_PREFIX, '')}
                  </Text>
                ))}
              </View>
            )}
          </View>

          {memory.canChange ? (
            <View className="items-start gap-2">
              {clearError !== '' ? (
                <Text accessibilityRole="alert" className="text-[13px] text-danger">
                  {clearError}
                </Text>
              ) : null}
              <Button
                variant="outline"
                size="lg"
                accessibilityLabel="Clear memory"
                onPress={actions.onAskClear}
              >
                <Text className="text-danger">Clear memory</Text>
              </Button>
            </View>
          ) : null}
        </>
      ) : null}

      {open && confirmingClear ? (
        <ConfirmDialog
          visible
          title="Clear memory?"
          message={`${aiName} forgets the pinned facts and the summaries of this chat. The messages stay, and it still reads the recent ones.`}
          confirmLabel="Clear"
          busyLabel="Clearing…"
          busy={false}
          onCancel={actions.onCancelClear}
          onConfirm={actions.onConfirmClear}
          confirmAccessibilityLabel="Clear"
          cancelAccessibilityLabel="Cancel"
          accessibilityLabel="Clear memory"
        />
      ) : null}
    </View>
  );
}

/**
 * The AI's memory in this DM: it makes no request until the owner opens it.
 */
export function AiMemorySection({
  api,
  chat,
  aiId,
  aiName,
  initiallyOpen = false,
}: {
  api: ReturnType<typeof makeChatExtrasApi>;
  chat: string;
  aiId: string;
  aiName: string;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [status, setStatus] = useState<AiMemoryStatus>('loading');
  const [memory, setMemory] = useState<AiMemoryView | null>(null);
  const [forgetError, setForgetError] = useState('');
  const [forgettingId, setForgettingId] = useState<string | null>(null);
  const [clearError, setClearError] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!open) {
      return;
    }
    const load = Effect.tryPromise({
      try: () => api.getAiMemory(chat, aiId),
      catch: (cause) => cause,
    }).pipe(
      Effect.matchEffect({
        onFailure: () => Effect.sync(() => setStatus('error')),
        onSuccess: (loaded) =>
          Effect.sync(() => {
            setMemory(loaded);
            setStatus('ready');
          }),
      }),
    );
    const fiber = Effect.runFork(load);
    return () => {
      interruptFiber(fiber);
    };
  }, [open, chat, aiId, api, reloadTick]);

  // Guards a second Forget landing before React re-renders the disabled button, so one fact is never forgotten twice.
  const forgettingRef = useRef<string | null>(null);

  const startLoad = (): void => {
    setStatus('loading');
    setForgetError('');
    setClearError('');
    setReloadTick((tick) => tick + 1);
  };

  const forget = (factId: string): void => {
    if (forgettingRef.current !== null) return;
    forgettingRef.current = factId;
    setForgettingId(factId);
    setForgetError('');
    Effect.runFork(
      requestForgetFactEffect(api, chat, aiId, factId).pipe(
        Effect.matchEffect({
          onFailure: () => Effect.sync(() => setForgetError(MEMORY_FORGET_FAILED_MESSAGE)),
          onSuccess: () =>
            Effect.sync(() =>
              setMemory((current) => (current === null ? current : removeFact(current, factId))),
            ),
        }),
        Effect.ensuring(
          Effect.sync(() => {
            forgettingRef.current = null;
            setForgettingId(null);
          }),
        ),
      ),
    );
  };

  const confirmClear = (): void => {
    setConfirmingClear(false);
    setClearError('');
    Effect.runFork(
      clearAiMemoryEffect(api, chat, aiId).pipe(
        Effect.matchEffect({
          onFailure: () => Effect.sync(() => setClearError(MEMORY_CLEAR_FAILED_MESSAGE)),
          onSuccess: (reloaded) =>
            Effect.sync(() => {
              setMemory(reloaded);
              setStatus('ready');
            }),
        }),
      ),
    );
  };

  return (
    <AiMemorySectionContent
      aiName={aiName}
      initiallyOpen={initiallyOpen}
      state={{
        open,
        status,
        memory,
        forgetError,
        forgettingId,
        clearError,
        confirmingClear,
      }}
      actions={{
        onShow: () => {
          setOpen(true);
          startLoad();
        },
        onHide: () => setOpen(false),
        onRetry: startLoad,
        onForget: forget,
        onAskClear: () => {
          setClearError('');
          setConfirmingClear(true);
        },
        onCancelClear: () => setConfirmingClear(false),
        onConfirmClear: confirmClear,
      }}
    />
  );
}
