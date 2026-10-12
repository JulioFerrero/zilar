// The headless FCM wake (T-1143, plan §4.4-4.5). ejabberd wakes a native device
// with a data-only FCM message carrying `{ chatId, messageId?, serverId }` and no
// text, so Google never sees the content. The task makes one HTTPS call
// (`push.preview`) to let the server build the title and body with the same mute,
// private-topic and "Show previews" rules Web Push uses, then posts a local
// notification. A tap on it is routed by `tap.ts`.
//
// The task is defined here at module scope and registered once; the root layout
// imports this module before any route so the task is defined on a cold start.

import { Effect } from 'effect';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';
import { ApiError, runApi } from '@zilar/api-contract';

import { ENV_MOCK } from '../../mock/gate';
import { API_URL } from '../auth';
import { createApiClient } from '../effect/api-client';
import { getSessionToken } from '../session-token';

/** The task name ejabberd's publish is delivered to; defined and registered below. */
export const WAKE_TASK = 'zilar-background-notification';

/** The Android channel every push lands in (plan §4.2). */
const CHANNEL_ID = 'messages';

/** The generic text shown when the server is not asked for a preview. */
const GENERIC_TITLE = 'Zilar';
const GENERIC_BODY = 'New message';

/** A test wake (`chatId: 'zilar:test'`) draws its own fixed text, no preview. */
const TEST_WAKE_CHAT_ID = 'zilar:test';
const TEST_WAKE_BODY = 'Push notifications work on this device.';

/**
 * The identifier the test-wake post carries, so the foreground handler can
 * tell it apart from chat posts (which carry none) and show only it while the
 * app is open.
 */
export const TEST_WAKE_IDENTIFIER = 'zilar-test';

/** A mock build has no real server: define nothing and post nothing. */
const MOCK_MODE = ENV_MOCK === '1';

/** The ids the server put in the wake; `messageId` is absent on some wakes. */
export interface WakePayload {
  chatId: string;
  messageId?: string;
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
  return typeof messageId === 'string' && messageId !== '' ? { chatId, messageId } : { chatId };
}

/** Posts one local notification on the messages channel, opened by its `chatId`. */
function post(title: string, body: string, chatId: string): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: { title, body, data: { chatId } },
    trigger: { channelId: CHANNEL_ID },
  });
}

/** Posts the test-wake notification: the fixed text, and no `chatId`, so a
 * tap opens the app without opening a chat (`tap.ts` ignores a missing one).
 * The identifier marks it as the test wake (see `isTestWake` below), because a
 * locally scheduled post has no `data.chatId` to match on. */
function postTest(): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    identifier: TEST_WAKE_IDENTIFIER,
    content: { title: GENERIC_TITLE, body: TEST_WAKE_BODY, data: {} },
    trigger: { channelId: CHANNEL_ID },
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
    await post(GENERIC_TITLE, GENERIC_BODY, payload.chatId);
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
    await post(GENERIC_TITLE, GENERIC_BODY, payload.chatId);
    return;
  }
  await post(preview.title, preview.body, preview.chatId);
}

/**
 * True when the incoming notification is the test wake. The identifier is the
 * primary match; the fixed title and body are the fallback for wakes scheduled
 * before the identifier existed. A chat post never matches: bodies are message
 * text or the shorter generic "New message", and they carry no identifier.
 */
export function isTestWake(notification: Notifications.Notification): boolean {
  if (notification.request.identifier === TEST_WAKE_IDENTIFIER) {
    return true;
  }
  const content = notification.request.content;
  return content.title === GENERIC_TITLE && content.body === TEST_WAKE_BODY;
}

/**
 * The wake handler, exported for tests. A test wake is posted even while the
 * app is open (the settings test is always tapped from the open app); other
 * wakes are skipped then (the live chat already shows the message). Never logs
 * the title, the body or the token, and never throws out of the headless task.
 */
export async function onWake(payload: WakePayload, deps: WakeDeps = {}): Promise<void> {
  if (MOCK_MODE) {
    return;
  }
  const isTest = payload.chatId === TEST_WAKE_CHAT_ID;
  if (!isTest && AppState.currentState === 'active') {
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

  // Shows a locally scheduled notification even while the app is open, but
  // only the test wake: chat posts stay silent then (the live chat already
  // shows them). Without a handler nothing scheduled while the app runs is
  // presented, so the settings test — always tapped from the open app — would
  // never be seen.
  Notifications.setNotificationHandler({
    handleNotification: (notification) =>
      Promise.resolve(
        isTestWake(notification)
          ? {
              shouldShowBanner: true,
              shouldShowList: true,
              shouldPlaySound: false,
              shouldSetBadge: false,
            }
          : {
              shouldShowBanner: false,
              shouldShowList: false,
              shouldPlaySound: false,
              shouldSetBadge: false,
            },
      ),
  });
}
