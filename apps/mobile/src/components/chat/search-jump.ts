import type { UiMessage } from '@zilar/chat-core';
import { Effect } from 'effect';

// The search-jump retry driver, UI-free so it can be unit-tested in Node: a tap calls `openAtMessage`, which pages back until the hit loads or gives up; the give-up path opens the chat at its bottom with `?notFound=1`.

export interface SearchJumpDeps {
  openAtMessage: (chatId: string, messageId: string) => Promise<UiMessage>;
  pushChat: (chatId: string) => void;
  pushChatNotFound: (chatId: string) => void;
  onNotFound: (chatId: string) => void;
}

// Opens one search hit: success lands on the message, failure lands at the bottom with the notice, never a loop. Only not-found lands at the bottom; any other error propagates.
export function openSearchHitEffect(
  deps: SearchJumpDeps,
  chatId: string,
  messageId: string,
): Effect.Effect<'landed' | 'not-found', unknown> {
  return Effect.tryPromise({
    try: () => deps.openAtMessage(chatId, messageId),
    catch: (error) => error,
  }).pipe(
    Effect.matchEffect({
      onSuccess: () =>
        Effect.sync(() => {
          deps.pushChat(chatId);
          return 'landed' as const;
        }),
      onFailure: (error) => {
        if (!isMessageNotFound(error)) {
          return Effect.fail(error);
        }
        return Effect.sync(() => {
          deps.pushChatNotFound(chatId);
          deps.onNotFound(chatId);
          return 'not-found' as const;
        });
      },
    }),
  );
}

function isMessageNotFound(error: unknown): boolean {
  return error instanceof Error && error.message === 'message_not_found';
}
