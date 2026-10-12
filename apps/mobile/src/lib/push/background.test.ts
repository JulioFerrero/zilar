import { beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '@/test/wait';

const notifications = vi.hoisted(() => ({
  scheduleNotificationAsync: vi.fn(async () => 'notification-1'),
  registerTaskAsync: vi.fn(async () => null),
  setNotificationHandler: vi.fn(),
  BackgroundNotificationTaskResult: { NewData: 0, NoData: 1, Failed: 2 },
}));

const taskManager = vi.hoisted(() => ({ defineTask: vi.fn() }));

const appState = vi.hoisted(() => ({ currentState: 'background' as string }));

vi.mock('expo-notifications', () => notifications);
vi.mock('expo-task-manager', () => taskManager);
vi.mock('react-native', () => ({ AppState: appState }));

import { onWake } from './background';

const API_URL = 'http://server.test';

/** A fetch that answers every call with the same JSON response. */
function previewFetch(body: unknown, status = 200): typeof fetch {
  return (async () => jsonResponse(body, status)) as typeof fetch;
}

const token = async () => 'session-token';

beforeEach(() => {
  appState.currentState = 'background';
  vi.mocked(notifications.scheduleNotificationAsync).mockClear();
  vi.mocked(notifications.registerTaskAsync).mockClear();
  vi.mocked(taskManager.defineTask).mockClear();
});

describe('onWake (T-1143)', () => {
  it('posts the server preview on a 200', async () => {
    const fetchImpl = previewFetch({
      title: 'Ada',
      body: 'see you there',
      chatId: 'preview-chat',
    });

    await onWake(
      { chatId: 'wake-chat', messageId: 'msg-1' },
      { getToken: token, fetchImpl, apiUrl: API_URL },
    );

    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: 'Ada', body: 'see you there', data: { chatId: 'preview-chat' } },
      trigger: { channelId: 'messages' },
    });
  });

  it('posts nothing when the server answers 404', async () => {
    const fetchImpl = previewFetch({ error: { code: 'not_found', message: 'Not found' } }, 404);

    await onWake(
      { chatId: 'chat-1', messageId: 'msg-1' },
      { getToken: token, fetchImpl, apiUrl: API_URL },
    );

    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does nothing without a session token', async () => {
    const fetchImpl = vi.fn();

    await onWake(
      { chatId: 'chat-1', messageId: 'msg-1' },
      {
        getToken: async () => undefined,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        apiUrl: API_URL,
      },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('posts nothing while the app is in the foreground', async () => {
    appState.currentState = 'active';
    const fetchImpl = previewFetch({ title: 'Ada', body: 'see you there', chatId: 'chat-1' });

    await onWake(
      { chatId: 'chat-1', messageId: 'msg-1' },
      { getToken: token, fetchImpl, apiUrl: API_URL },
    );

    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('posts the test wake even while the app is in the foreground', async () => {
    appState.currentState = 'active';

    await onWake({ chatId: 'zilar:test' }, { getToken: token, apiUrl: API_URL });

    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: 'zilar-test',
      content: {
        title: 'Zilar',
        body: 'Push notifications work on this device.',
        data: {},
      },
      trigger: { channelId: 'messages' },
    });
  });
});
