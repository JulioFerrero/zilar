// Reply and Mark as read on a chat notification (T-1896, plan
// `notification-actions` §1). Both actions run in the headless wake task when
// the app is backgrounded or killed, so neither opens the app. Reply sends
// `chats.reply` with a stable `clientId`; Mark as read stores the caller's read
// mark with the notification's archive id and its origin id as `displayed`.
// The notification is dismissed only after the server accepted the call, so a
// failure leaves it in place for a retry or a plain tap.

import * as Notifications from 'expo-notifications';
import { Effect } from 'effect';
import { ApiError, runApi } from '@zilar/api-contract';

import { API_URL } from '../auth';
import { createApiClient } from '../effect/api-client';
import { getSessionToken } from '../session-token';
import type { WakeDeps } from './background';

/** The category id chat notifications attach (Android shows its actions). */
export const MESSAGE_CATEGORY = 'message';
/** The text action that sends an inline reply. */
export const REPLY_ACTION = 'reply';
/** The action that stores the read mark without opening the app. */
export const READ_ACTION = 'read';

/** The server's reply cap (`chats.reply` validates the same 4,000). */
const MAX_REPLY_LENGTH = 4000;
/** A reply already in flight answers 409; retry once after this pause. */
const REPLY_RETRY_DELAY_MS = 2000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stores the category and its two actions. Every action sets
 * `opensAppToForeground: false` explicitly: the library defaults it to true,
 * and either action would then open the app instead of running headless.
 * Best effort: a failed registration warns and never throws.
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

/** A non-empty string in the notification data, or undefined. */
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

/** Sends a reply with a fresh `clientId`, retrying once on `reply_in_flight`. */
async function reply(chatId: string, text: string, deps: WakeDeps): Promise<void> {
  const client = clientFor(deps);
  // The same id goes out again on the retry: the server uses it to recognise
  // the first, still-in-flight attempt instead of sending the text twice.
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

/** Stores the read mark; the origin id travels as `displayed` when known. */
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

/** Runs one action and dismisses its notification only once it succeeded. */
function runAction(
  action: () => Promise<void>,
  notification: Notifications.Notification,
): Promise<void> {
  // Best effort, through Effect like the wake itself: a failure warns without
  // the text and never reaches the headless task, and the notification stays.
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
 * Handles a notification action without opening the app. Reply needs a
 * non-empty `userText`; Mark as read needs the archive id. A plain tap, another
 * action or missing ids do nothing. On success the notification is dismissed;
 * on failure it stays so the user can retry or tap. Never logs the text or the
 * token, and never throws out of the headless task.
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
