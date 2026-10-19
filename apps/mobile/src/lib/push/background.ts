// ejabberd wakes the device with a data-only FCM message carrying ids and no text, so Google never sees content; the task asks the server for a preview, then posts locally. The task is defined at module scope, imported before `expo-router/entry`, so a headless cold start has it.

import { Effect } from 'effect';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { ApiError, runApi } from '@zilar/api-contract';

import { ENV_MOCK } from '../../mock/gate';
import { getActiveChatId } from './active-chat';
import { API_URL } from '../auth';
import { createApiClient } from '../effect/api-client';
import { getSessionToken } from '../session-token';
import { channelForWake, parseChatKind, type PushChatKind } from './channels';
import { recordPushReceived } from './last-received';

export const WAKE_TASK = 'zilar-background-notification';

const GENERIC_TITLE = 'Zilar';
const GENERIC_BODY = 'New message';

const TEST_WAKE_CHAT_ID = 'zilar:test';
const TEST_WAKE_BODY = 'Push notifications work on this device.';

/**
 * A test wake is the one post with no `chatId`, so it is always shown.
 */
export const TEST_WAKE_IDENTIFIER = 'zilar-test';

const MOCK_MODE = ENV_MOCK === '1';

export interface WakePayload {
  chatId: string;
  messageId?: string;
  /**
   * The server sends no kind yet, so this is undefined and `channelForWake` falls back.
   */
  chatKind?: PushChatKind;
}

export interface WakeDeps {
  getToken?: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  apiUrl?: string;
}

/**
 * SDK 57 hands a data-only payload on `data.dataString` (a JSON string), but the keys may also sit on `data` itself, so both shapes are accepted.
 */
function parseWake(data: { dataString?: string; [key: string]: unknown }): WakePayload | undefined {
  let raw: unknown = data;
  if (typeof data.dataString === 'string' && data.dataString !== '') {
    try {
      raw = JSON.parse(data.dataString);
    } catch {
      return undefined;
    }
  }
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const chatId = record['chatId'];
  if (typeof chatId !== 'string' || chatId === '') {
    return undefined;
  }
  const messageId = record['messageId'];
  const chatKind = parseChatKind(record['chatKind']);
  const payload: WakePayload = { chatId };
  if (typeof messageId === 'string' && messageId !== '') {
    payload.messageId = messageId;
  }
  if (chatKind !== undefined) {
    payload.chatKind = chatKind;
  }
  return payload;
}

/**
 * A headless task cannot surface a failed post, so it warns exactly once; the title, the body and the token are never logged.
 */
async function schedule(
  request: Parameters<typeof Notifications.scheduleNotificationAsync>[0],
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync(request);
  } catch (error) {
    console.warn('native push: the notification could not be posted', error);
  }
}

/**
 * `trigger: { channelId }` is SDK 57's immediate, channel-aware trigger; `trigger: null` cannot set the channel, so it falls back to a generic one.
 */
function post(
  title: string,
  body: string,
  chatId: string,
  chatKind: PushChatKind | undefined,
  ids?: { messageId: string; archiveId?: string },
  unread?: number,
): Promise<void> {
  const data: Record<string, string> = { chatId };
  if (ids !== undefined) {
    data['messageId'] = ids.messageId;
    if (ids.archiveId !== undefined) {
      data['archiveId'] = ids.archiveId;
    }
  }
  return schedule({
    // One notification per chat: the stable identifier replaces the previous one instead of stacking.
    identifier: `chat:${chatId}`,
    content: {
      title,
      body,
      data,
      categoryIdentifier: MESSAGE_CATEGORY,
      ...(unread === undefined || unread < 1 ? {} : { badge: unread }),
    },
    trigger: { channelId: channelForWake(chatKind).id },
  });
}

/**
 * No `chatId`, so a tap opens the app without a chat and the foreground handler never hides it.
 */
function postTest(): Promise<void> {
  return schedule({
    identifier: TEST_WAKE_IDENTIFIER,
    content: { title: GENERIC_TITLE, body: TEST_WAKE_BODY, data: {} },
    trigger: { channelId: channelForWake(undefined).id },
  });
}

/**
 * A 404 means the message is muted, hidden or gone, so nothing is shown; any other failure falls back to the generic text, because the server already decided to wake this phone.
 */
async function handleWake(payload: WakePayload, deps: Required<WakeDeps>): Promise<void> {
  const token = await deps.getToken();
  if (token === undefined) {
    return;
  }
  // A test wake draws its own fixed text and never fetches a preview.
  if (payload.chatId === TEST_WAKE_CHAT_ID) {
    await postTest();
    return;
  }
  if (payload.messageId === undefined) {
    await post(GENERIC_TITLE, GENERIC_BODY, payload.chatId, payload.chatKind);
    return;
  }
  const client = createApiClient(deps);
  let preview: { title: string; body: string; chatId: string; archiveId?: string; unread?: number };
  try {
    preview = await runApi(client.push.preview({ query: { messageId: payload.messageId } }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return;
    }
    await post(GENERIC_TITLE, GENERIC_BODY, payload.chatId, payload.chatKind);
    return;
  }
  await post(
    preview.title,
    preview.body,
    preview.chatId,
    payload.chatKind,
    {
      messageId: payload.messageId,
      ...(preview.archiveId === undefined ? {} : { archiveId: preview.archiveId }),
    },
    preview.unread,
  );
}

function notificationChatId(notification: Notifications.Notification): string | undefined {
  const chatId = notification.request.content.data?.['chatId'];
  return typeof chatId === 'string' && chatId !== '' ? chatId : undefined;
}

/**
 * A wake is dropped only for the chat the app currently shows; every other wake is posted. Never logs the title, the body or the token, and never throws out of the headless task.
 */
export async function onWake(payload: WakePayload, deps: WakeDeps = {}): Promise<void> {
  if (MOCK_MODE) {
    return;
  }
  // Remember the wake for the Settings diagnostics line, even when the post below is skipped. Best effort.
  await recordPushReceived();
  if (payload.chatId !== TEST_WAKE_CHAT_ID && getActiveChatId() === payload.chatId) {
    return;
  }
  const resolved: Required<WakeDeps> = {
    getToken: deps.getToken ?? getSessionToken,
    fetchImpl: deps.fetchImpl ?? fetch,
    apiUrl: deps.apiUrl ?? API_URL,
  };
  // Best effort: a failure is warned without its content and never reaches the headless task.
  await Effect.runPromise(
    Effect.tryPromise({
      try: () => handleWake(payload, resolved),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => console.warn('native push: the wake could not be handled', error)),
      ),
    ),
  );
}

// Both actions run in the headless wake task, so neither opens the app. The notification is dismissed only after the server accepted, so a failure leaves it for a retry or a plain tap.

const MESSAGE_CATEGORY = 'message';
export const REPLY_ACTION = 'reply';
export const READ_ACTION = 'read';

const MAX_REPLY_LENGTH = 4000;
/** A reply already in flight answers 409; retry once after this pause. */
const REPLY_RETRY_DELAY_MS = 2000;

if (!MOCK_MODE) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(WAKE_TASK, async ({ data }) => {
    if ('actionIdentifier' in data) {
      if (data.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
        await onNotificationAction(data);
      }
      return Notifications.BackgroundNotificationTaskResult.NoData;
    }
    const wake = parseWake(data.data);
    if (wake !== undefined) {
      await onWake(wake);
    }
    return Notifications.BackgroundNotificationTaskResult.NoData;
  });

  void registerMessageCategory();

  void Notifications.registerTaskAsync(WAKE_TASK).catch((error) => {
    console.warn('native push: the wake task could not be registered', error);
  });

  // The OS asks this handler whenever the app process is foreground, so a wake from a headless context while the app is open must still be presented.
  Notifications.setNotificationHandler({
    handleNotification: (notification) => {
      const openChatId = getActiveChatId();
      const shown = notificationChatId(notification) !== openChatId;
      return Promise.resolve({
        shouldShowBanner: shown,
        shouldShowList: shown,
        shouldPlaySound: false,
        shouldSetBadge: false,
      });
    },
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every action sets `opensAppToForeground: false`: the library defaults it to true, which would open the app. Best effort.
 */
async function registerMessageCategory(): Promise<void> {
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
