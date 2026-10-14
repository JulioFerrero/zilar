import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module imports `expo-secure-store` dynamically so it loads under Vitest
// (Node), which cannot import the native module; the mock answers that import.
const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(async () => null as string | null),
  setItemAsync: vi.fn(async () => undefined),
}));

vi.mock('expo-secure-store', () => secureStore);

import { PUSH_LAST_RECEIVED_KEY, readLastPushReceived, recordPushReceived } from './last-received';

beforeEach(() => {
  vi.mocked(secureStore.getItemAsync).mockReset();
  vi.mocked(secureStore.getItemAsync).mockResolvedValue(null);
  vi.mocked(secureStore.setItemAsync).mockReset();
  vi.mocked(secureStore.setItemAsync).mockResolvedValue(undefined);
});

describe('readLastPushReceived (T-1356)', () => {
  it('reads the stored receipt time', async () => {
    vi.mocked(secureStore.getItemAsync).mockResolvedValue('2026-10-14T10:00:00.000Z');

    await expect(readLastPushReceived()).resolves.toBe('2026-10-14T10:00:00.000Z');
    expect(secureStore.getItemAsync).toHaveBeenCalledWith(PUSH_LAST_RECEIVED_KEY);
  });

  it('resolves null when the store cannot be read', async () => {
    vi.mocked(secureStore.getItemAsync).mockRejectedValue(new Error('keychain unavailable'));

    await expect(readLastPushReceived()).resolves.toBeNull();
  });
});

describe('recordPushReceived (T-1356)', () => {
  it('stores the receipt as an ISO string', async () => {
    await recordPushReceived(new Date('2026-10-14T10:00:00.000Z'));

    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      PUSH_LAST_RECEIVED_KEY,
      '2026-10-14T10:00:00.000Z',
    );
  });

  it('never rejects when the store cannot be written', async () => {
    vi.mocked(secureStore.setItemAsync).mockRejectedValue(new Error('keychain unavailable'));

    await expect(recordPushReceived()).resolves.toBeUndefined();
  });
});
