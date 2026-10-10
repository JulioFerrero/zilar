import { Effect } from 'effect';
import type { MediaItem } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';
import { scrollToMessage } from '@/lib/scrollToMessage';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import type { JumpTarget } from './mediaModel';

// Opens an item at its message: the panel closes and the bubble is scrolled
// into view. Each row calls this with its own action, so two rows can jump
// at once while a second click on the same row waits for the first.
export function useShowInChat(target: JumpTarget): (item: MediaItem) => void {
  const storeApi = useChatStoreApi();
  const [, open] = useAction((item: MediaItem) =>
    fromApi(() => storeApi.getState().openAtMessage(target.chatId, item.messageId)).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          target.onOpened();
          window.requestAnimationFrame(() => {
            scrollToMessage(item.messageId);
          });
        }),
      ),
      Effect.tapError(() => Effect.sync(target.onFailed)),
    ),
  );
  return (item) => {
    target.onStart();
    open(item);
  };
}
