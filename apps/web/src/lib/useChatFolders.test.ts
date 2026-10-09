import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listChatFolders, type ApiChatFolder } from '@/lib/api';
import { useChatFolders } from './useChatFolders';

const { setFolders, storeApi } = vi.hoisted(() => {
  const setFolders = vi.fn();
  return { setFolders, storeApi: { getState: () => ({ setFolders }) } };
});

vi.mock('@/store/ChatStoreProvider', () => ({
  useChatStoreApi: () => storeApi,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, listChatFolders: vi.fn() };
});

const listMock = vi.mocked(listChatFolders);

const folders = [{ id: 'folder-1', name: 'Work' }] as unknown as ApiChatFolder[];

beforeEach(() => {
  vi.useFakeTimers();
  listMock.mockReset();
  setFolders.mockReset();
  listMock.mockResolvedValue(folders);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useChatFolders', () => {
  it('syncs the server folders into the store on mount', async () => {
    renderHook(() => useChatFolders());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(setFolders).toHaveBeenCalledWith(folders);
  });

  it('syncs again when the window gains focus', async () => {
    renderHook(() => useChatFolders());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(setFolders).toHaveBeenCalledTimes(2);
  });

  it('keeps the current list when the sync fails', async () => {
    listMock.mockRejectedValue(new Error('network down'));
    renderHook(() => useChatFolders());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(setFolders).not.toHaveBeenCalled();
  });
});
