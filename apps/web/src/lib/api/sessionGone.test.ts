import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';
import { CHAT_LIST_CACHE_KEY } from '@/store/chatListCache';
import { MESSAGE_CACHE_KEY } from '@/store/messageCache';
import { checkSession, sessionGone, type SessionGoneStorage } from './sessionGone';

vi.mock('./chats', () => ({ getMe: vi.fn() }));
vi.mock('../auth', () => ({ authClient: { signOut: vi.fn(() => Promise.resolve()) } }));

import { getMe } from './chats';

const mockedGetMe = vi.mocked(getMe);

describe('checkSession (T-1223)', () => {
  it('a 200 reads as the session valid', async () => {
    mockedGetMe.mockResolvedValueOnce({ id: 'u-me' } as never);

    await expect(checkSession()).resolves.toBe('valid');
    expect(mockedGetMe).toHaveBeenCalledTimes(1);
  });

  it('a 401 reads as the session gone', async () => {
    mockedGetMe.mockRejectedValueOnce(new ApiError(401, 'unauthorized', 'No session'));

    await expect(checkSession()).resolves.toBe('gone');
  });

  it('any other failure reads as unknown, never a sign-out', async () => {
    mockedGetMe.mockRejectedValueOnce(new ApiError(0, 'network_error', 'No network'));
    await expect(checkSession()).resolves.toBe('unknown');

    mockedGetMe.mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Down'));
    await expect(checkSession()).resolves.toBe('unknown');
  });

  it('the cache key the adapter clears is the chat-list cache', () => {
    expect(CHAT_LIST_CACHE_KEY).toBe('zilar:chatList');
  });

  it('a dead session clears the chat list and message caches (T-1909)', async () => {
    const removed: string[] = [];
    const storage: SessionGoneStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: (key) => removed.push(key),
    };
    const goToLogin = vi.fn();

    sessionGone(goToLogin, storage);

    expect(removed).toContain(CHAT_LIST_CACHE_KEY);
    expect(removed).toContain(MESSAGE_CACHE_KEY);
    expect(MESSAGE_CACHE_KEY).toBe('zilar:messages');
    await vi.waitFor(() => expect(goToLogin).toHaveBeenCalled());
  });
});
