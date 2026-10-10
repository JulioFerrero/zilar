import type { Pin } from '@zilar/api-contract';
import type { UiMessage } from '@zilar/chat-core';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import {
  PIN_ERROR,
  PINS_LOAD_ERROR,
  UNPIN_ERROR,
  loadPins,
  pinKindFor,
  pinMessage,
  pinSnapshotFor,
  pinTextFor,
  unpinMessage,
  type PinsApi,
  type PinsError,
  type PinsStore,
} from './pins';
import { ANA, NOW, testCtx } from './test-ctx';

const message = (overrides: Partial<UiMessage> = {}): UiMessage => ({
  id: 'm1',
  chatId: ANA,
  senderId: 'u-ana',
  senderName: 'Ana',
  text: 'hello',
  createdAt: NOW,
  status: 'sent',
  ...overrides,
});

const pin = (overrides: Partial<Pin> = {}): Pin => ({
  id: 'pin-1',
  chat: ANA,
  messageId: 'm1',
  senderName: 'Ana',
  text: 'hello',
  kind: 'text',
  pinnedBy: 'u-me',
  pinnedAt: '2026-09-28T11:00:00.000Z',
  ...overrides,
});

function testPinsStore() {
  const byChat = new Map<string, Pin[]>();
  const ready = new Set<string>();
  let error: PinsError | undefined;
  const store: PinsStore = {
    pins: (chatId) => byChat.get(chatId) ?? [],
    publish: (chatId, pins) => {
      byChat.set(chatId, [...pins]);
    },
    markReady: (chatId) => {
      ready.add(chatId);
    },
    setError: (value) => {
      error = value;
    },
    currentUserId: () => 'u-me',
  };
  return { store, error: () => error, ready: (chatId: string) => ready.has(chatId) };
}

describe('pin snapshot (core)', () => {
  it('names the payload kind with text precedence, and caps the text', () => {
    expect(pinKindFor({})).toBe('text');
    expect(pinKindFor({ voice: {} })).toBe('voice');
    expect(pinKindFor({ image: {} })).toBe('image');
    expect(pinKindFor({ attachment: { kind: 'image' } })).toBe('image');
    expect(pinKindFor({ attachment: { kind: 'file' } })).toBe('file');
    expect(pinKindFor({ card: {} })).toBe('card');
    expect(pinTextFor({ text: 'x'.repeat(400) }, 'text')).toHaveLength(300);
    expect(pinTextFor({ text: 'hello' }, 'image')).toBe('');
    expect(pinTextFor({ deleted: true }, 'text')).toBe('Message deleted');
  });

  it('builds the display-only snapshot', () => {
    expect(pinSnapshotFor(ANA, message({ senderName: '' }))).toEqual({
      chat: ANA,
      messageId: 'm1',
      senderName: 'Someone',
      text: 'hello',
      kind: 'text',
    });
  });
});

describe('loadPins (core)', () => {
  it('publishes the list, marks it ready and stays silent on a quiet failure', async () => {
    const { ctx } = testCtx();
    const { store, error, ready } = testPinsStore();
    const api = {
      listPins: vi.fn(async () => [pin()]),
      pinMessage: vi.fn(),
      unpinMessage: vi.fn(),
    } as unknown as PinsApi;

    await Effect.runPromise(loadPins(ctx, api, store, ANA, false));
    expect(store.pins(ANA)).toEqual([pin()]);
    expect(ready(ANA)).toBe(true);

    vi.mocked(api.listPins).mockRejectedValueOnce(new Error('down'));
    await Effect.runPromise(loadPins(ctx, api, store, ANA, false));
    expect(error()).toBeUndefined();

    vi.mocked(api.listPins).mockRejectedValueOnce(new Error('down'));
    await Effect.runPromise(loadPins(ctx, api, store, ANA, true));
    expect(error()).toEqual({ chatId: ANA, message: PINS_LOAD_ERROR });
  });
});

describe('pinMessage (core)', () => {
  it('paints optimistically and does not send when the message is unknown', async () => {
    const { ctx } = testCtx();
    const { store } = testPinsStore();
    const api = {
      listPins: vi.fn(),
      pinMessage: vi.fn(async (input) => pin(...input, { id: 'pin-9' })),
      unpinMessage: vi.fn(),
    } as unknown as PinsApi;

    await expect(Effect.runPromise(pinMessage(ctx, api, store, ANA, 'missing'))).rejects.toThrow(
      'Message not found',
    );
    expect(api.pinMessage).not.toHaveBeenCalled();
  });

  it('replaces the optimistic pin with the saved one, and rolls back with PIN_ERROR', async () => {
    const { ctx } = testCtx({ state: { messagesByChat: { [ANA]: [message()] } } });
    const { store, error } = testPinsStore();
    const api = {
      listPins: vi.fn(),
      pinMessage: vi.fn(async (input: Parameters<PinsApi['pinMessage']>[0]) =>
        pin({ ...input, id: 'pin-9' }),
      ),
      unpinMessage: vi.fn(),
    } as unknown as PinsApi;

    await Effect.runPromise(pinMessage(ctx, api, store, ANA, 'm1'));
    expect(api.pinMessage).toHaveBeenCalledWith({
      chat: ANA,
      messageId: 'm1',
      senderName: 'Ana',
      text: 'hello',
      kind: 'text',
    });
    expect(store.pins(ANA).map((entry) => entry.id)).toEqual(['pin-9']);

    vi.mocked(api.pinMessage).mockRejectedValueOnce(new Error('offline'));
    await expect(Effect.runPromise(pinMessage(ctx, api, store, ANA, 'm1'))).rejects.toThrow(
      'offline',
    );
    expect(store.pins(ANA).map((entry) => entry.id)).toEqual(['pin-9']);
    expect(error()).toEqual({ chatId: ANA, message: PIN_ERROR });
  });
});

describe('unpinMessage (core)', () => {
  it('removes the pin first, and restores it with UNPIN_ERROR on failure', async () => {
    const { ctx } = testCtx();
    const { store, error } = testPinsStore();
    const api = {
      listPins: vi.fn(),
      pinMessage: vi.fn(),
      unpinMessage: vi.fn(async () => undefined),
    } as unknown as PinsApi;

    store.publish(ANA, [pin()]);

    await Effect.runPromise(unpinMessage(ctx, api, store, ANA, 'pin-1'));
    expect(api.unpinMessage).toHaveBeenCalledWith('pin-1');
    expect(store.pins(ANA)).toEqual([]);

    store.publish(ANA, [pin()]);
    vi.mocked(api.unpinMessage).mockRejectedValueOnce(new Error('down'));
    await expect(Effect.runPromise(unpinMessage(ctx, api, store, ANA, 'pin-1'))).rejects.toThrow(
      'down',
    );
    expect(store.pins(ANA).map((entry) => entry.id)).toEqual(['pin-1']);
    expect(error()).toEqual({ chatId: ANA, message: UNPIN_ERROR });
  });

  it('drops the echoed row when mobile answers a different id', async () => {
    const { ctx } = testCtx();
    const { store } = testPinsStore();
    const api = {
      listPins: vi.fn(),
      pinMessage: vi.fn(),
      unpinMessage: vi.fn(async () => ({ id: 'server-pin' })),
    } as unknown as PinsApi;
    store.publish(ANA, [pin({ id: 'server-pin' })]);

    await Effect.runPromise(unpinMessage(ctx, api, store, ANA, 'local-pin'));
    expect(store.pins(ANA)).toEqual([]);
  });
});
