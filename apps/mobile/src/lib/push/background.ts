// The headless FCM wake (T-1143, plan §4.4-4.5). ejabberd wakes a native device
// with a data-only FCM message carrying `{ chatId, messageId?, serverId }` and no
// text, so Google never sees the content. The task makes one HTTPS call
// (`push.preview`) to let the server build the title and body with the same mute,
// private-topic and "Show previews" rules Web Push uses, then posts a local
// notification. A tap on it is routed by `tap.ts`.
//
// The task is defined here at module scope and registered once. `index.ts`, the
// Metro entry, imports this module before `expo-router/entry`, so the task is
// defined even on a headless cold start, where the router never renders.

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

/** The task name ejabberd's publish is delivered to; defined and registered below. */
export const WAKE_TASK = 'zilar-background-notification';

/** The generic text shown when the server is not asked for a preview. */
const GENERIC_TITLE = 'Zilar';
const GENERIC_BODY = 'New message';

/** A test wake (`chatId: 'zilar:test'`) draws its own fixed text, no preview. */
const TEST_WAKE_CHAT_ID = 'zilar:test';
const TEST_WAKE_BODY = 'Push notifications work on this device.';

/**
 * The identifier the test-wake post carries. A test wake is the one post with
 * no `chatId`, so it is always shown (see `postTest` and the handler below).
 */
export const TEST_WAKE_IDENTIFIER = 'zilar-test';

/** A mock build has no real server: define nothing and post nothing. */
const MOCK_MODE = ENV_MOCK === '1';

/** The ids the server put in the wake; `messageId` is absent on some wakes. */
export interface WakePayload {
  chatId: string;
  messageId?: string;
  /**
   * T-1302 (MUX-23): the chat kind the server would put on the wake under
   * `chatKind`. It does not send one yet, so this is undefined in practice and
   * `channelForWake` falls back (see the Report).
   */
  chatKind?: PushChatKind;
}

export interface WakeDeps {
  getToken?: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  apiUrl?: string;
}

/**
 * Reads the wake out of the FCM data. SDK 57 hands a data-only payload to the
 * task on `data.dataString` (a JSON string); the keys may also sit on `data`
 * itself, so both shapes are accepted. A payload without a `chatId` is ignored.
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
 * Schedules one local notification, best effort. A failed post is the one
 * failure that would otherwise be invisible (a headless task cannot surface
 * it), so it warns exactly once; the title, the body and the token are never
 * logged.
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
 * Posts one local notification on its chat-kind channel, opened by `chatId`.
 * `trigger: { channelId }` is SDK 57's immediate, channel-aware trigger: the JS
 * layer turns a bare `channelId` into `{ type: 'channel' }`
 * (`scheduleNotificationAsync.js`, `parseTrigger`) and Android's
 * `NotificationScheduler.triggerFromParams` maps `channel` to
 * `ChannelAwareTrigger`, which `ExpoSchedulingDelegate.scheduleNotification`
 * presents at once. `trigger: null` cannot set the channel: SDK 57's content
 * has no `channelId`, so a null trigger falls back to a generic channel
 * (`BaseNotificationBuilder.channelId`).
 */
function post(
  title: string,
  body: string,
  chatId: string,
  chatKind: PushChatKind | undefined,
): Promise<void> {
  return schedule({
    content: { title, body, data: { chatId } },
    trigger: { channelId: channelForWake(chatKind).id },
  });
}

/** Posts the test-wake notification: the fixed text, and no `chatId`, so a
 * tap opens the app without opening a chat (`tap.ts` ignores a missing one).
 * The identifier marks it as the test wake; no `chatId` also means the
 * foreground handler never hides it. */
function postTest(): Promise<void> {
  return schedule({
    identifier: TEST_WAKE_IDENTIFIER,
    content: { title: GENERIC_TITLE, body: TEST_WAKE_BODY, data: {} },
    trigger: { channelId: channelForWake(undefined).id },
  });
}

/**
 * Fetches the preview for one message and posts it. A 404 means the message is
 * muted, hidden or gone, so nothing is shown; any other failure (network, 5xx,
 * expired session) falls back to the generic text, because the server already
 * decided to wake this phone.
 */
async function handleWake(payload: WakePayload, deps: Required<WakeDeps>): Promise<void> {
  const token = await deps.getToken();
  if (token === undefined) {
    return;
  }
  // A test wake proves the pipe works: it draws its own fixed text and never
  // fetches a preview (the tap opens the app, not a chat).
  if (payload.chatId === TEST_WAKE_CHAT_ID) {
    await postTest();
    return;
  }
  if (payload.messageId === undefined) {
    await post(GENERIC_TITLE, GENERIC_BODY, payload.chatId, payload.chatKind);
    return;
  }
  const client = createApiClient(deps);
  let preview: { title: string; body: string; chatId: string };
  try {
    preview = await runApi(client.push.preview({ query: { messageId: payload.messageId } }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return;
    }
    await post(GENERIC_TITLE, GENERIC_BODY, payload.chatId, payload.chatKind);
    return;
  }
  await post(preview.title, preview.body, preview.chatId, payload.chatKind);
}

/** The chat id a notification was posted for, when it carries one. */
function notificationChatId(notification: Notifications.Notification): string | undefined {
  const chatId = notification.request.content.data?.['chatId'];
  return typeof chatId === 'string' && chatId !== '' ? chatId : undefined;
}

/**
 * The wake handler, exported for tests. A wake is dropped only for the chat
 * the app currently shows (its message is already on screen); every other
 * wake — killed, backgrounded, or the foreground on another screen — is
 * posted, and the test wake is always posted. Never logs the title, the body
 * or the token, and never throws out of the headless task.
 */
export async function onWake(payload: WakePayload, deps: WakeDeps = {}): Promise<void> {
  if (MOCK_MODE) {
    return;
  }
  // The OS delivered a wake: remember it for the Settings diagnostics line,
  // even when the app is open and the post below is skipped. Best effort.
  await recordPushReceived();
  if (payload.chatId !== TEST_WAKE_CHAT_ID && getActiveChatId() === payload.chatId) {
    return;
  }
  const resolved: Required<WakeDeps> = {
    getToken: deps.getToken ?? getSessionToken,
    fetchImpl: deps.fetchImpl ?? fetch,
    apiUrl: deps.apiUrl ?? API_URL,
  };
  // Best effort, through Effect: a failure is warned without its content and
  // never reaches the headless task.
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

if (!MOCK_MODE) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(WAKE_TASK, async ({ data }) => {
    if ('actionIdentifier' in data) {
      return Notifications.BackgroundNotificationTaskResult.NoData; // a tap, routed by tap.ts
    }
    const wake = parseWake(data.data);
    if (wake !== undefined) {
      await onWake(wake);
    }
    return Notifications.BackgroundNotificationTaskResult.NoData;
  });

  // Best effort: a failed registration is warned, not thrown.
  void Notifications.registerTaskAsync(WAKE_TASK).catch((error) => {
    console.warn('native push: the wake task could not be registered', error);
  });

  // Shows a posted wake unless it is for the chat the app currently shows:
  // the OS asks this handler whenever the app process is foreground, so a
  // wake that runs in a headless context while the app is open (T-1358) must
  // still be presented. The test wake carries no `chatId`, so it always shows.
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
