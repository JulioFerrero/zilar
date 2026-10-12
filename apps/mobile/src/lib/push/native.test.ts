import { beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '@/test/wait';

const notifications = vi.hoisted(() => ({
  setNotificationChannelAsync: vi.fn(async () => null),
  getPermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
  getDevicePushTokenAsync: vi.fn(async () => ({ type: 'android' as const, data: 'fcm-token-1' })),
  getExpoPushTokenAsync: vi.fn(async () => ({ type: 'expo' as const, data: 'expo-token-1' })),
  addPushTokenListener: vi.fn((_listener: (event: { data: string }) => void) => ({
    remove: vi.fn(),
  })),
  AndroidImportance: { UNKNOWN: 0, HIGH: 4 },
}));

const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(async () => null as string | null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

vi.mock('expo-notifications', () => notifications);
vi.mock('expo-secure-store', () => secureStore);
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

import {
  ensurePushPair,
  PUSH_REGISTRATION_KEY,
  registerNativePush,
  unregisterNativePush,
  watchPushTokenRolls,
} from './native';

const REGISTRATION = { id: 'sub-1', node: 'zilar-node', jid: 'me@zilar.test' };

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function captureFetch(): { calls: FetchCall[]; fetchImpl: typeof fetch } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({
      url: String(input),
      method,
      body: init.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown),
    });
    if (method === 'DELETE') {
      return jsonResponse({ removed: true });
    }
    return jsonResponse(REGISTRATION);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

beforeEach(() => {
  vi.mocked(notifications.setNotificationChannelAsync).mockReset();
  vi.mocked(notifications.setNotificationChannelAsync).mockResolvedValue(null);
  vi.mocked(notifications.getPermissionsAsync).mockReset();
  vi.mocked(notifications.getPermissionsAsync).mockResolvedValue({ granted: true });
  vi.mocked(notifications.requestPermissionsAsync).mockReset();
  vi.mocked(notifications.requestPermissionsAsync).mockResolvedValue({ granted: true });
  vi.mocked(notifications.getDevicePushTokenAsync).mockReset();
  vi.mocked(notifications.getDevicePushTokenAsync).mockResolvedValue({
    type: 'android',
    data: 'fcm-token-1',
  });
  vi.mocked(notifications.getExpoPushTokenAsync).mockClear();
  vi.mocked(secureStore.getItemAsync).mockReset();
  vi.mocked(secureStore.getItemAsync).mockResolvedValue(null);
  vi.mocked(secureStore.setItemAsync).mockReset();
  vi.mocked(secureStore.setItemAsync).mockResolvedValue(undefined);
  vi.mocked(secureStore.deleteItemAsync).mockReset();
  vi.mocked(secureStore.deleteItemAsync).mockResolvedValue(undefined);
});

describe('registerNativePush (T-1139)', () => {
  it('registers the FCM token and never asks for an Expo push token', async () => {
    const { calls, fetchImpl } = captureFetch();
    const setPushPair = vi.fn(async () => undefined);

    await registerNativePush({
      setPushPair,
      getToken: async () => 'session-token',
      fetchImpl,
      apiUrl: 'http://server.test',
    });

    const post = calls.find((call) => call.method === 'POST');
    expect(post?.url).toBe('http://server.test/api/push/subscriptions');
    expect(post?.body).toEqual({ kind: 'fcm', token: 'fcm-token-1', userAgent: 'Zilar Android' });
    expect(setPushPair).toHaveBeenCalledWith({
      pushJid: REGISTRATION.jid,
      node: REGISTRATION.node,
      enable: true,
    });
    expect(vi.mocked(notifications.getExpoPushTokenAsync)).not.toHaveBeenCalled();
    expect(vi.mocked(secureStore.setItemAsync)).toHaveBeenCalledWith(
      PUSH_REGISTRATION_KEY,
      JSON.stringify(REGISTRATION),
    );
  });

  it('sends nothing when the permission is denied', async () => {
    vi.mocked(notifications.getPermissionsAsync).mockResolvedValue({ granted: false });
    vi.mocked(notifications.requestPermissionsAsync).mockResolvedValue({ granted: false });
    const { calls, fetchImpl } = captureFetch();
    const setPushPair = vi.fn(async () => undefined);

    await registerNativePush({
      setPushPair,
      getToken: async () => 'session-token',
      fetchImpl,
      apiUrl: 'http://server.test',
    });

    expect(calls).toHaveLength(0);
    expect(setPushPair).not.toHaveBeenCalled();
    expect(vi.mocked(secureStore.setItemAsync)).not.toHaveBeenCalled();
  });

  it('registers once when the token listener echoes the same token', async () => {
    const listeners: Array<(event: { data: string }) => void> = [];
    vi.mocked(notifications.addPushTokenListener).mockImplementation((listener) => {
      listeners.push(listener);
      return { remove: vi.fn() };
    });
    const { calls, fetchImpl } = captureFetch();
    const setPushPair = vi.fn(async () => undefined);
    const deps = {
      setPushPair,
      getToken: async () => 'session-token',
      fetchImpl,
      apiUrl: 'http://server.test',
    };

    watchPushTokenRolls(deps);
    const registration = registerNativePush(deps);
    listeners[0]?.({ data: 'fcm-token-1' });
    await registration;

    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(setPushPair).toHaveBeenCalledTimes(1);
  });
});

describe('ensurePushPair (T-1152)', () => {
  it('re-sends the enable with the saved node, and does nothing with no saved registration', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      vi.mocked(secureStore.getItemAsync).mockResolvedValue(JSON.stringify(REGISTRATION));
      const setPushPair = vi.fn(async () => undefined);

      await ensurePushPair({ setPushPair });

      expect(setPushPair).toHaveBeenCalledTimes(1);
      expect(setPushPair).toHaveBeenCalledWith({
        pushJid: REGISTRATION.jid,
        node: REGISTRATION.node,
        enable: true,
      });

      vi.mocked(secureStore.getItemAsync).mockResolvedValue(null);
      const idlePair = vi.fn(async () => undefined);

      await ensurePushPair({ setPushPair: idlePair });

      expect(idlePair).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('unregisterNativePush (T-1139)', () => {
  it('deletes the saved device and clears the key', async () => {
    vi.mocked(secureStore.getItemAsync).mockResolvedValue(JSON.stringify(REGISTRATION));
    const { calls, fetchImpl } = captureFetch();

    await unregisterNativePush({
      getToken: async () => 'session-token',
      fetchImpl,
      apiUrl: 'http://server.test',
    });

    const remove = calls.find((call) => call.method === 'DELETE');
    expect(remove?.url).toBe('http://server.test/api/push/subscriptions/sub-1');
    expect(vi.mocked(secureStore.deleteItemAsync)).toHaveBeenCalledWith(PUSH_REGISTRATION_KEY);
  });
});
