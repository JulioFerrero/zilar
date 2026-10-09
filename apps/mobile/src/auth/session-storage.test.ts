import { describe, expect, it } from 'vitest';

import { createMemorySessionStorage } from './session-storage';

describe('createMemorySessionStorage', () => {
  it('starts empty without an initial token', async () => {
    const storage = createMemorySessionStorage();

    await expect(storage.getToken()).resolves.toBeUndefined();
  });

  it('starts with the initial token', async () => {
    const storage = createMemorySessionStorage('token-1');

    await expect(storage.getToken()).resolves.toBe('token-1');
  });

  it('keeps the token that was set', async () => {
    const storage = createMemorySessionStorage();

    await expect(storage.setToken('token-2')).resolves.toBeUndefined();

    await expect(storage.getToken()).resolves.toBe('token-2');
  });

  it('forgets the token once cleared', async () => {
    const storage = createMemorySessionStorage('token-1');

    await expect(storage.clearToken()).resolves.toBeUndefined();

    await expect(storage.getToken()).resolves.toBeUndefined();
  });

  it('keeps separate storages apart', async () => {
    const first = createMemorySessionStorage();
    const second = createMemorySessionStorage();

    await first.setToken('token-1');

    await expect(second.getToken()).resolves.toBeUndefined();
  });
});
