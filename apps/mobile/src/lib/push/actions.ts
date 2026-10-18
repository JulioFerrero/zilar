// Both actions run in the headless wake task, so neither opens the app. The notification is dismissed only after the server accepted, so a failure leaves it for a retry or a plain tap.

import * as Notifications from 'expo-notifications';
import { Effect } from 'effect';
import { ApiError, runApi } from '@zilar/api-contract';

import { API_URL } from '../auth';
import { createApiClient } from '../effect/api-client';
import { getSessionToken } from '../session-token';
import type { WakeDeps } from './background';

export const MESSAGE_CATEGORY = 'message';
export const REPLY_ACTION = 'reply';
export const READ_ACTION = 'read';

const MAX_REPLY_LENGTH = 4000;
/** A reply already in flight answers 409; retry once after this pause. */
const REPLY_RETRY_DELAY_MS = 2000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every action sets `opensAppToForeground: false`: the library defaults it to true, which would open the app. Best effort.
 */
export async function registerMessageCategory(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(MESSAGE_CATEGORY, [
      {
        identifier: REPLY_ACTION,
        buttonTitle: 'Reply',
        textInput: { submitButtonTitle: 'Send', placeholder: 'Message' },
        options: { opensAppToForeground: false },
      },
      {
        identifier: READ_ACTION,
        buttonTitle: 'Mark as read',
        options: { opensAppToForeground: false },
      },
    ]);
  } catch (error) {
    console.warn('native push: the message category could not be registered', error);
  }
}

function dataString(notification: Notifications.Notification, key: string): string | undefined {
  const value = notification.request.content.data?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function clientFor(deps: WakeDeps): ReturnType<typeof createApiClient> {
  return createApiClient({
    getToken: deps.getToken ?? getSessionToken,
    fetchImpl: deps.fetchImpl ?? fetch,
    apiUrl: deps.apiUrl ?? API_URL,
  });
}

async function reply(chatId: string, text: string, deps: WakeDeps): Promise<void> {
  const client = clientFor(deps);
  // The same id goes out on the retry: the server recognises the in-flight attempt instead of sending twice.
  const payload = { clientId: crypto.randomUUID(), text };
  try {
    await runApi(client.chats.reply({ params: { jid: chatId }, payload }));
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) {
      throw error;
    }
    await delay(REPLY_RETRY_DELAY_MS);
    await runApi(client.chats.reply({ params: { jid: chatId }, payload }));
  }
}

async function markRead(
  chatId: string,
  archiveId: string,
  messageId: string | undefined,
  deps: WakeDeps,
): Promise<void> {
  await runApi(
    clientFor(deps).chats.markRead({
      params: { jid: chatId },
      payload: {
        messageId: archiveId,
        ...(messageId === undefined ? {} : { displayed: messageId }),
      },
    }),
  );
}

function runAction(
  action: () => Promise<void>,
  notification: Notifications.Notification,
): Promise<void> {
  // Best effort: a failure warns without the text, never reaches the headless task, and the notification stays.
  return Effect.runPromise(
    Effect.tryPromise({
      try: async () => {
        await action();
        await Notifications.dismissNotificationAsync(notification.request.identifier);
      },
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() =>
          console.warn('native push: the notification action could not be handled', error),
        ),
      ),
    ),
  );
}

/**
 * Never logs the text or the token, and never throws out of the headless task.
 */
export async function onNotificationAction(
  response: Notifications.NotificationResponse,
  deps: WakeDeps = {},
): Promise<void> {
  const { actionIdentifier, notification } = response;
  if (actionIdentifier !== REPLY_ACTION && actionIdentifier !== READ_ACTION) {
    return;
  }
  const chatId = dataString(notification, 'chatId');
  if (chatId === undefined) {
    return;
  }
  if (actionIdentifier === REPLY_ACTION) {
    const text = response.userText?.trim().slice(0, MAX_REPLY_LENGTH) ?? '';
    if (text === '') {
      return;
    }
    await runAction(() => reply(chatId, text, deps), notification);
    return;
  }
  const archiveId = dataString(notification, 'archiveId');
  if (archiveId === undefined) {
    return;
  }
  const messageId = dataString(notification, 'messageId');
  await runAction(() => markRead(chatId, archiveId, messageId, deps), notification);
}
