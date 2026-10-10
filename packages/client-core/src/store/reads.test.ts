import { describe, expect, it, vi } from 'vitest';
import { LAST_READ_PREFIX, persistLastRead, recordRead } from './reads';
import { ANA, TEAM, dm, team, testCtx } from './test-ctx';

describe('persistLastRead (core)', () => {
  it('saves the map under the user key, and nothing without storage or a user', () => {
    const setItem = vi.fn();
    const storage = { getItem: () => null, setItem, removeItem: vi.fn() };
    const { ctx } = testCtx({ ports: { storage } });
    ctx.lastRead[ANA] = 'm1';
    persistLastRead(ctx);
    expect(setItem).toHaveBeenCalledWith(
      `${LAST_READ_PREFIX}u-me`,
      JSON.stringify({ [ANA]: 'm1' }),
    );

    ctx.lastReadUserId = undefined;
    persistLastRead(ctx);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(() => persistLastRead(testCtx().ctx)).not.toThrow();
  });

  it('survives a full storage', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: vi.fn(),
    };
    expect(() => persistLastRead(testCtx({ ports: { storage } }).ctx)).not.toThrow();
  });
});

describe('recordRead (core)', () => {
  it('clears the unread count, remembers the message and drops the notifications', () => {
    const { ctx, fx, state } = testCtx({
      state: {
        chats: [
          { ...dm, unread: 3 },
          { ...team, unread: 2 },
        ],
      },
    });
    recordRead(ctx, ANA, 'm1');

    expect(state().chats.map((chat) => [chat.id, chat.unread])).toEqual([
      [ANA, 0],
      [TEAM, 2],
    ]);
    expect(ctx.lastRead).toEqual({ [ANA]: 'm1' });
    expect(fx.dismissChatNotifications).toHaveBeenCalledWith(ANA);
    expect(fx.syncBadge).toHaveBeenCalledTimes(1);
  });

  it('keeps the last read when no message id is given', () => {
    const { ctx } = testCtx();
    ctx.lastRead[ANA] = 'm1';
    recordRead(ctx, ANA, undefined);
    expect(ctx.lastRead).toEqual({ [ANA]: 'm1' });
  });
});
