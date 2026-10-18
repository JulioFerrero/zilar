import type { ChatSummary } from '@zilar/chat-core';
import { fromApi } from '@/lib/effect/api-effect';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStoreApi } from '@/store/ChatStoreProvider';

const MUTE_ERROR = 'Could not update notifications. Try again.';

export interface MuteToggle {
  muted: boolean;
  busy: boolean;
  error: string | undefined;
  toggle: () => void;
}

export function useMuteToggle(chat: ChatSummary): MuteToggle {
  const storeApi = useChatStoreApi();
  const [state, runToggle] = useAction((next: 'forever' | null) =>
    fromApi(() => storeApi.getState().setMuted(chat.id, next)),
  );
  const muted = chat.muted === true;
  const busy = isWaiting(state);

  return {
    muted,
    busy,
    error: !busy && failureOf(state) !== undefined ? MUTE_ERROR : undefined,
    toggle: () => {
      if (!busy) {
        runToggle(muted ? null : 'forever');
      }
    },
  };
}
