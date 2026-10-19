import { Effect } from 'effect';
import { useEffect, useRef, useState } from 'react';
import type { AiMemoryView } from '@zilar/api-contract';
import type { makeChatExtrasApi } from './chat-extras-api';
import { toApiFailure } from './errors';
import { interruptFiber } from './use-delayed';

export const MEMORY_LOAD_FAILED_MESSAGE = 'Could not load the memory';

export const MEMORY_FORGET_FAILED_MESSAGE = 'Could not forget that fact';

export const MEMORY_CLEAR_FAILED_MESSAGE = 'Could not clear the memory';

type AiMemoryStatus = 'loading' | 'ready' | 'error';

export interface AiMemorySectionState {
  open: boolean;
  status: AiMemoryStatus;
  memory: AiMemoryView | null;
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

export type AiMemoryApi = Pick<
  ReturnType<typeof makeChatExtrasApi>,
  'clearAiMemory' | 'forgetAiMemoryFact' | 'getAiMemory'
>;

function removeFact(memory: AiMemoryView, factId: string): AiMemoryView {
  return { ...memory, facts: memory.facts.filter((fact) => fact.id !== factId) };
}

/** A 404 means the fact is already gone, which the caller treats as success. */
const requestForgetFactEffect = (api: AiMemoryApi, chat: string, aiId: string, factId: string) =>
  Effect.tryPromise({
    try: () => api.forgetAiMemoryFact(chat, aiId, factId),
    catch: (cause) => cause,
  }).pipe(
    Effect.catch((error) =>
      toApiFailure(error).status === 404 ? Effect.void : Effect.fail(error),
    ),
  );

const clearAiMemoryEffect = (api: AiMemoryApi, chat: string, aiId: string) =>
  Effect.tryPromise({ try: () => api.clearAiMemory(chat, aiId), catch: (cause) => cause }).pipe(
    Effect.flatMap(() =>
      Effect.tryPromise({ try: () => api.getAiMemory(chat, aiId), catch: (cause) => cause }),
    ),
  );

// The cover lines carry a leading block reference (`#16` or `#0-15`) that is only meaningful to the server; the section strips it.
export const LINE_PREFIX = /^#\d+(?:-\d+)? /;

/**
 * The AI's memory in this DM: it makes no request until the owner opens it.
 */
export function useAiMemory(
  api: AiMemoryApi,
  chat: string,
  aiId: string,
  initiallyOpen = false,
): { state: AiMemorySectionState; actions: AiMemorySectionActions } {
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
    setForgetError('');
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

  return {
    state: { open, status, memory, forgetError, forgettingId, clearError, confirmingClear },
    actions: {
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
    },
  };
}
