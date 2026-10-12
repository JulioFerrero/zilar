import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';
import { CHAT_LIST_CACHE_KEY } from '@/store/chatListCache';
import { checkSession } from './sessionGone';

vi.mock('./chats', () => ({ getMe: vi.fn() }));

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
});
