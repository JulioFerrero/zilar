// The badge mirrors the web `totalBadgeUnread` rule: the sum of `unread` over chats that are not muted. Errors are ignored.
//
// The two natives are lazy-required: `expo-notifications` pulls in `expo`, whose module body reads `__DEV__` (Metro defines it, Vitest not), so a static import breaks every store test.

import { totalBadgeUnread, type ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';

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

export function syncBadge(chats: readonly ChatSummary[]): Effect.Effect<void> {
  return Effect.suspend(() =>
    Effect.tryPromise({
      try: () => natives().setBadgeCountAsync(totalBadgeUnread(chats)),
      catch: (error) => error,
    }).pipe(Effect.ignore),
  );
}

function presentedChatId(notification: {
  request: { content: { data?: Record<string, unknown> | null } };
}): string | undefined {
  const chatId = notification.request.content.data?.['chatId'];
  return typeof chatId === 'string' && chatId !== '' ? chatId : undefined;
}

/**
 * Posted notifications carry `data.chatId`, so the tray is enumerated and this chat's are dismissed. Best effort.
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
