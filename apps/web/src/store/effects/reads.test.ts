import { describe, expect, it, vi } from 'vitest';
import { LAST_READ_PREFIX } from './constants';
import type { StoreCtx } from './ctx';
import { persistLastRead } from './reads';

function ctxWith(storage: unknown, userId: string | undefined): StoreCtx {
  return {
    ports: { storage },
    lastReadUserId: userId,
    lastRead: { 'ana@zilar.test': 'm1' },
  } as unknown as StoreCtx;
}

describe('persistLastRead', () => {
  it('saves the map under the user key', () => {
    const setItem = vi.fn();
    persistLastRead(ctxWith({ setItem }, 'u1'));
    expect(setItem).toHaveBeenCalledWith(
      `${LAST_READ_PREFIX}u1`,
      JSON.stringify({ 'ana@zilar.test': 'm1' }),
    );
  });

  it('does nothing without storage or a user, and survives a full storage', () => {
    expect(() => persistLastRead(ctxWith(null, 'u1'))).not.toThrow();
    const setItem = vi.fn();
    persistLastRead(ctxWith({ setItem }, undefined));
    expect(setItem).not.toHaveBeenCalled();
    const full = {
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => persistLastRead(ctxWith(full, 'u1'))).not.toThrow();
  });
});
