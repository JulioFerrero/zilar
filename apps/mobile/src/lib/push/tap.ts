// Routes a tap on a local message notification into its chat (T-1143, plan
// §4.5). The notification's `data.chatId` is the chat JID the routes already
// use. Mounted by the root layout. A tap while the app runs navigates at once;
// a cold-start tap waits until both the session is authenticated and the root
// navigator is mounted, or the push would be lost.

import { Effect } from 'effect';
import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { useSession } from '@/auth/session';

/** The chat id carried in the notification data, when it is a string. */
function chatIdFrom(response: Notifications.NotificationResponse): string | undefined {
  const chatId = response.notification.request.content.data?.['chatId'];
  return typeof chatId === 'string' && chatId !== '' ? chatId : undefined;
}

/** Opens the chat a tapped notification points at. */
function openChat(chatId: string): void {
  router.push({ pathname: '/chat/[id]', params: { id: chatId } });
}

/** Opens the chat a tapped notification points at, once the user is signed in. */
export function NotificationRouter(): null {
  const status = useSession().status;
  // Undefined until the root navigator has mounted; pushing before that throws
  // and would be swallowed.
  const navigationState = useRootNavigationState();
  const navigatorReady = navigationState?.key !== undefined;
  // The cold-start tap is held here until the session and the navigator are
  // both ready; the tick re-runs the push effect when the tap arrives late.
  const pendingChat = useRef<string | null>(null);
  const [pendingTick, setPendingTick] = useState(0);

  // A live tap: the app is already mounted, so it navigates directly, but only
  // while the session is signed in (spec §4).
  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const chatId = chatIdFrom(response);
      if (chatId !== undefined) {
        openChat(chatId);
      }
    });
    return () => subscription.remove();
  }, [status]);

  // A cold-start tap: read it once, best effort, hold the chat and clear it so a
  // later mount does not reopen the same chat.
  useEffect(() => {
    let mounted = true;
    void Effect.runPromise(
      Effect.tryPromise({
        try: () => Notifications.getLastNotificationResponseAsync(),
        catch: (error) => error,
      }).pipe(
        Effect.tap((response) =>
          Effect.sync(() => {
            if (!mounted || response === null) {
              return;
            }
            const chatId = chatIdFrom(response);
            if (chatId !== undefined) {
              pendingChat.current = chatId;
              setPendingTick((tick) => tick + 1);
            }
            void Notifications.clearLastNotificationResponseAsync();
          }),
        ),
        Effect.ignore,
      ),
    );
    return () => {
      mounted = false;
    };
  }, []);

  // Push the held tap once the navigator is mounted and the session is signed in.
  useEffect(() => {
    if (!navigatorReady || status !== 'authenticated') {
      return;
    }
    const chatId = pendingChat.current;
    if (chatId === null) {
      return;
    }
    pendingChat.current = null;
    openChat(chatId);
  }, [navigatorReady, status, pendingTick]);

  return null;
}
