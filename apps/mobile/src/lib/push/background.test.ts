import { beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '@/test/wait';

const notifications = vi.hoisted(() => ({
  scheduleNotificationAsync: vi.fn(async () => 'notification-1'),
  setNotificationCategoryAsync: vi.fn(async () => null),
  registerTaskAsync: vi.fn(async () => null),
  setNotificationHandler: vi.fn(),
  BackgroundNotificationTaskResult: { NewData: 0, NoData: 1, Failed: 2 },
}));

const taskManager = vi.hoisted(() => ({ defineTask: vi.fn() }));

const appState = vi.hoisted(() => ({ currentState: 'background' as string }));

// `onWake` records the receipt time in SecureStore (`last-received.ts`); the
// dynamic import needs the module mocked under Vitest.
const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(async () => null as string | null),
  setItemAsync: vi.fn(async () => undefined),
}));

vi.mock('expo-notifications', () => notifications);
vi.mock('expo-task-manager', () => taskManager);
vi.mock('react-native', () => ({ AppState: appState }));
vi.mock('expo-secure-store', () => secureStore);

import { onWake } from './background';
import { setActiveChatId } from './active-chat';

const API_URL = 'http://server.test';

/** A fetch that answers every call with the same JSON response. */
function previewFetch(body: unknown, status = 200): typeof fetch {
  return (async () => jsonResponse(body, status)) as typeof fetch;
}

const token = async () => 'session-token';

beforeEach(() => {
  appState.currentState = 'background';
  setActiveChatId(null);
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
      content: {
        title: 'Ada',
        body: 'see you there',
        data: { chatId: 'preview-chat', messageId: 'msg-1' },
        categoryIdentifier: 'message',
      },
      trigger: { channelId: 'groups' },
    });
  });

  it('posts on the channel for the wake chat kind (T-1302)', async () => {
    const fetchImpl = previewFetch({ title: 'Ada', body: 'hi', chatId: 'dm-1' });

    await onWake(
      { chatId: 'dm-1', messageId: 'msg-1', chatKind: 'dm' },
      { getToken: token, fetchImpl, apiUrl: API_URL },
    );

    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: {
        title: 'Ada',
        body: 'hi',
        data: { chatId: 'dm-1', messageId: 'msg-1' },
        categoryIdentifier: 'message',
      },
      trigger: { channelId: 'direct-messages' },
    });
  });

  it('carries the preview archive id for Mark as read (T-1896)', async () => {
    const fetchImpl = previewFetch({
      title: 'Ada',
      body: 'hi',
      chatId: 'dm-1',
      archiveId: '1700000000000',
    });

    await onWake(
      { chatId: 'dm-1', messageId: 'msg-1' },
      { getToken: token, fetchImpl, apiUrl: API_URL },
    );

    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: {
        title: 'Ada',
        body: 'hi',
        data: { chatId: 'dm-1', messageId: 'msg-1', archiveId: '1700000000000' },
        categoryIdentifier: 'message',
      },
      trigger: { channelId: 'groups' },
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

  it('posts nothing while the app is open on that chat', async () => {
    setActiveChatId('chat-1');
    const fetchImpl = vi.fn(
      previewFetch({ title: 'Ada', body: 'see you there', chatId: 'chat-1' }),
    );

    await onWake(
      { chatId: 'chat-1', messageId: 'msg-1' },
      { getToken: token, fetchImpl, apiUrl: API_URL },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('posts a wake for the foreground when another chat is open', async () => {
    setActiveChatId('other-chat');
    const fetchImpl = previewFetch({ title: 'Ada', body: 'see you there', chatId: 'chat-1' });

    await onWake(
      { chatId: 'chat-1', messageId: 'msg-1' },
      { getToken: token, fetchImpl, apiUrl: API_URL },
    );

    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('posts the test wake even while a chat is open', async () => {
    setActiveChatId('chat-1');

    await onWake({ chatId: 'zilar:test' }, { getToken: token, apiUrl: API_URL });

    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: 'zilar-test',
      content: {
        title: 'Zilar',
        body: 'Push notifications work on this device.',
        data: {},
      },
      trigger: { channelId: 'groups' },
    });
  });
});
