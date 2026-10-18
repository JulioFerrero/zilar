// `data.chatId` is the chat JID the routes already use. A live tap navigates at once; a cold-start tap waits for the session and the mounted navigator, or the push is lost.

import { Effect } from 'effect';
import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { useSession } from '@/auth/session';

function chatIdFrom(response: Notifications.NotificationResponse): string | undefined {
  const chatId = response.notification.request.content.data?.['chatId'];
  return typeof chatId === 'string' && chatId !== '' ? chatId : undefined;
}

function openChat(chatId: string): void {
  router.push({ pathname: '/chat/[id]', params: { id: chatId } });
}

export function NotificationRouter(): null {
  const status = useSession().status;
  // Undefined until the root navigator mounts; pushing before that throws and would be swallowed.
  const navigationState = useRootNavigationState();
  const navigatorReady = navigationState?.key !== undefined;
  // The cold-start tap is held until the session and the navigator are ready.
  const pendingChat = useRef<string | null>(null);
  const [pendingTick, setPendingTick] = useState(0);

  // A live tap navigates directly, but only while the session is signed in.
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

  // Read it once and clear it, so a later mount does not reopen the same chat.
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
