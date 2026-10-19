import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Notifications from 'expo-notifications';

import { jsonResponse } from '@/test/wait';

const notifications = vi.hoisted(() => ({
  dismissNotificationAsync: vi.fn(async () => undefined),
  setNotificationCategoryAsync: vi.fn(async () => null),
  registerTaskAsync: vi.fn(async () => null),
  setNotificationHandler: vi.fn(),
  BackgroundNotificationTaskResult: { NewData: 0, NoData: 1, Failed: 2 },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
}));

vi.mock('expo-notifications', () => notifications);
vi.mock('react-native', () => ({ AppState: { currentState: 'background' } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
}));
vi.mock('expo-task-manager', () => ({ defineTask: vi.fn() }));

import { onNotificationAction, READ_ACTION, REPLY_ACTION } from './background';

const API_URL = 'http://server.test';
const token = async () => 'session-token';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** A fetch that records every call and answers from `responses` in order. */
function recordingFetch(responses: Response[], calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift();
    if (next === undefined) {
      throw new Error('unexpected request');
    }
    return next;
  }) as typeof fetch;
}

interface ResponseInput {
  action: string;
  data?: Record<string, string>;
  userText?: string;
  identifier?: string;
}

function notificationResponse({
  action,
  data = {},
  userText,
  identifier = 'notification-1',
}: ResponseInput): Notifications.NotificationResponse {
  return {
    actionIdentifier: action,
    ...(userText === undefined ? {} : { userText }),
    notification: {
      date: 0,
      request: { identifier, content: { data }, trigger: null },
    },
  } as unknown as Notifications.NotificationResponse;
}

function depsFor(fetchImpl: typeof fetch) {
  return { getToken: token, fetchImpl, apiUrl: API_URL };
}

function bodyOf(call: Call | undefined): Record<string, unknown> {
  return (call?.body ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  vi.mocked(notifications.dismissNotificationAsync).mockClear();
});

describe('onNotificationAction (T-1896)', () => {
  it('sends a Reply with the typed text and a client id, then dismisses', async () => {
    const calls: Call[] = [];
    const fetchImpl = recordingFetch([jsonResponse(null, 204)], calls);

    await onNotificationAction(
      notificationResponse({
        action: REPLY_ACTION,
        data: { chatId: 'chat-1', messageId: 'origin-1', archiveId: '1700000000000' },
        userText: '  see you there  ',
      }),
      depsFor(fetchImpl),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://server.test/api/chats/chat-1/reply');
    expect(calls[0]?.method).toBe('POST');
    expect(bodyOf(calls[0])['text']).toBe('see you there');
    expect(bodyOf(calls[0])['clientId']).toEqual(expect.any(String));
    expect(notifications.dismissNotificationAsync).toHaveBeenCalledWith('notification-1');
  });

  it('retries a 409 once with the same client id', async () => {
    vi.useFakeTimers();
    try {
      const calls: Call[] = [];
      const fetchImpl = recordingFetch(
        [
          jsonResponse({ error: { code: 'reply_in_flight', message: 'In flight' } }, 409),
          jsonResponse(null, 204),
        ],
        calls,
      );

      const pending = onNotificationAction(
        notificationResponse({
          action: REPLY_ACTION,
          data: { chatId: 'chat-1', messageId: 'origin-1', archiveId: '1700000000000' },
          userText: 'hello',
        }),
        depsFor(fetchImpl),
      );
      await vi.advanceTimersByTimeAsync(2000);
      await pending;

      expect(calls).toHaveLength(2);
      expect(bodyOf(calls[0])['clientId']).toBe(bodyOf(calls[1])['clientId']);
      expect(notifications.dismissNotificationAsync).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks the chat read with the archive id and the origin id as displayed', async () => {
    const calls: Call[] = [];
    const fetchImpl = recordingFetch([jsonResponse(null, 204)], calls);

    await onNotificationAction(
      notificationResponse({
        action: READ_ACTION,
        data: { chatId: 'chat-1', messageId: 'origin-9', archiveId: '1700000000000' },
      }),
      depsFor(fetchImpl),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://server.test/api/chats/chat-1/read');
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.body).toEqual({ messageId: '1700000000000', displayed: 'origin-9' });
    expect(notifications.dismissNotificationAsync).toHaveBeenCalledWith('notification-1');
  });

  it('makes no request for a plain tap or without a chat id', async () => {
    const calls: Call[] = [];
    const fetchImpl = recordingFetch([], calls);
    const deps = depsFor(fetchImpl);

    await onNotificationAction(
      notificationResponse({
        action: notifications.DEFAULT_ACTION_IDENTIFIER,
        data: { chatId: 'chat-1' },
      }),
      deps,
    );
    await onNotificationAction(
      notificationResponse({
        action: REPLY_ACTION,
        data: { messageId: 'origin-1' },
        userText: 'hello',
      }),
      deps,
    );

    expect(calls).toHaveLength(0);
    expect(notifications.dismissNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('notification categories', () => {
  it('registers Reply and Mark as read when the module loads', async () => {
    vi.resetModules();
    notifications.setNotificationCategoryAsync.mockClear();
    await import('./background');
    await vi.waitFor(() => {
      expect(notifications.setNotificationCategoryAsync).toHaveBeenCalledWith(
        'message',
        expect.arrayContaining([
          expect.objectContaining({ identifier: REPLY_ACTION }),
          expect.objectContaining({ identifier: READ_ACTION }),
        ]),
      );
    });
  });
});
