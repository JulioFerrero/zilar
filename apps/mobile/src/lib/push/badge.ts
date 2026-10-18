// The app-icon badge and the tray dismissal on mobile (T-1206, fix-plan row
// 9). The badge mirrors the web `totalBadgeUnread` rule: the sum of `unread`
// over chats that are not muted (the mute flag is merged into the rows by
// `applyChatPrefs`, the same `muted` the chat list reads in
// `components/chat/chat-list-item.tsx`). Both run on a fiber like other
// background work, and errors are ignored.
//
// The two natives are lazy-required (like the mock-gated requires in
// `chat-store-provider.tsx`): `expo-notifications` pulls in `expo`, whose
// module body reads the `__DEV__` global Metro defines but Vitest does not,
// so a static import breaks every store test that never mocked notifications.

import { totalBadgeUnread, type ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';

/** The three notification calls used, behind a lazy require (see above). */
interface BadgeNatives {
  setBadgeCountAsync(count: number): Promise<boolean>;
  getPresentedNotificationsAsync(): Promise<
    {
      request: {
        identifier: string;
        content: { data?: Record<string, unknown> | null };
      };
    }[]
  >;
  dismissNotificationAsync(identifier: string): Promise<void>;
}

function natives(): BadgeNatives {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-notifications') as BadgeNatives;
}

/** Sets the app-icon badge to the unread sum, best effort. */
export function syncBadge(chats: readonly ChatSummary[]): Effect.Effect<void> {
  return Effect.suspend(() =>
    Effect.tryPromise({
      try: () => natives().setBadgeCountAsync(totalBadgeUnread(chats)),
      catch: (error) => error,
    }).pipe(Effect.ignore),
  );
}

/** The chat id carried in a presented notification's data, when it is a string. */
function presentedChatId(notification: {
  request: { content: { data?: Record<string, unknown> | null } };
}): string | undefined {
  const chatId = notification.request.content.data?.['chatId'];
  return typeof chatId === 'string' && chatId !== '' ? chatId : undefined;
}

/**
 * Dismisses the tray notifications of one chat, best effort. Posted
 * notifications carry `data.chatId` (see `lib/push/background.ts`), so the
 * presented tray is enumerated and the ones for this chat are dismissed.
 */
export function dismissChatNotifications(chatId: string): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () => natives().getPresentedNotificationsAsync(),
    catch: (error) => error,
  }).pipe(
    Effect.flatMap((presented) =>
      Effect.tryPromise({
        try: () =>
          Promise.all(
            presented
              .filter((notification) => presentedChatId(notification) === chatId)
              .map((notification) =>
                natives().dismissNotificationAsync(notification.request.identifier),
              ),
          ),
        catch: (error) => error,
      }),
    ),
    Effect.ignore,
  );
}
