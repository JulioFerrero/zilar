import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Brain, Trash2 } from 'lucide-react-native';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { AiMemoryApiError, type AiMemory, type AiMemoryApi } from '@/lib/ai-memory-api';

// The cover lines carry a leading block reference (`#16` or `#0-15`) that is
// only meaningful to the server; the section strips it before showing a line.
const LINE_PREFIX = /^#\d+(?:-\d+)? /;

/** Fixed user-facing line when the memory fails to load. */
export const MEMORY_LOAD_FAILED_MESSAGE = 'Could not load the memory';

/** Fixed user-facing line when forgetting a fact fails. */
export const MEMORY_FORGET_FAILED_MESSAGE = 'Could not forget that fact';

/** Fixed user-facing line when clearing the memory fails. */
export const MEMORY_CLEAR_FAILED_MESSAGE = 'Could not clear the memory';

export type AiMemoryStatus = 'loading' | 'ready' | 'error';

export interface AiMemorySectionState {
  open: boolean;
  status: AiMemoryStatus;
  memory: AiMemory | null;
  forgetError: string;
  forgettingId: string | null;
  clearError: string;
  confirmingClear: boolean;
}

export interface AiMemorySectionActions {
  onShow: () => void;
  onHide: () => void;
  onRetry: () => void;
  onForget: (factId: string) => void;
  onAskClear: () => void;
  onCancelClear: () => void;
  onConfirmClear: () => void;
}

/** The memory without one fact, for the optimistic row removal after Forget. */
export function removeFact(memory: AiMemory, factId: string): AiMemory {
  return { ...memory, facts: memory.facts.filter((fact) => fact.id !== factId) };
}

/**
 * Forgets one fact on the server. A 404 means the fact is already gone, which
 * the caller treats as success; any other failure is rethrown.
 */
export async function requestForgetFact(
  api: AiMemoryApi,
  chat: string,
  aiId: string,
  factId: string,
): Promise<void> {
  try {
    await api.forgetFact(chat, aiId, factId);
  } catch (error) {
    if (error instanceof AiMemoryApiError && error.status === 404) {
      return;
    }
    throw error;
  }
}

/** Clears the memory on the server, then reloads and returns the empty one. */
export async function clearAiMemory(
  api: AiMemoryApi,
  chat: string,
  aiId: string,
): Promise<AiMemory> {
  await api.clear(chat, aiId);
  return api.getMemory(chat, aiId);
}

/**
 * The open/closed body of the memory section, split out so tests can render
 * each state without mounting the loading effect.
 */
export function AiMemorySectionContent({
  state,
  aiName,
  actions,
  initiallyOpen = false,
}: {
  state: AiMemorySectionState;
  aiName: string;
  actions: AiMemorySectionActions;
  /** When true the section mounts already open (the rooms sheet), so the
   * Show and Hide buttons are hidden. */
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
 * T-0449: the AI's memory in this DM. It stays collapsed, and makes no
 * request, until the owner opens it; then it lists the pinned facts and the
 * cover lines, and lets the owner forget a fact or clear the whole memory.
 */
export function AiMemorySection({
  api,
  chat,
  aiId,
  aiName,
  initiallyOpen = false,
}: {
  api: AiMemoryApi;
  chat: string;
  aiId: string;
  aiName: string;
  /**
   * Mounts the section already open (the rooms sheet): it loads at once
   * and shows neither the Show nor the Hide button.
   */
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [status, setStatus] = useState<AiMemoryStatus>('loading');
  const [memory, setMemory] = useState<AiMemory | null>(null);
  const [forgetError, setForgetError] = useState('');
  const [forgettingId, setForgettingId] = useState<string | null>(null);
  const [clearError, setClearError] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const loaded = await api.getMemory(chat, aiId);
        if (!active) return;
        setMemory(loaded);
        setStatus('ready');
      } catch {
        if (!active) return;
        setStatus('error');
      }
    })();
    return () => {
      active = false;
    };
  }, [open, chat, aiId, api, reloadTick]);

  // Guards against a second Forget landing before React re-renders the
  // disabled button, so one fact can never be forgotten twice.
  const forgettingRef = useRef<string | null>(null);

  // The loading status is set from the event that starts a load (Show, Retry
  // or a reload), not synchronously inside the effect.
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
    void (async () => {
      try {
        await requestForgetFact(api, chat, aiId, factId);
        setMemory((current) => (current === null ? current : removeFact(current, factId)));
      } catch {
        setForgetError(MEMORY_FORGET_FAILED_MESSAGE);
      } finally {
        forgettingRef.current = null;
        setForgettingId(null);
      }
    })();
  };

  const confirmClear = (): void => {
    setConfirmingClear(false);
    setClearError('');
    void (async () => {
      try {
        const reloaded = await clearAiMemory(api, chat, aiId);
        setMemory(reloaded);
        setStatus('ready');
      } catch {
        setClearError(MEMORY_CLEAR_FAILED_MESSAGE);
      }
    })();
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
