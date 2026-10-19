import type { UiMessage } from '@zilar/chat-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { clearHistory, deleteForMe, DELETE_ERROR } from './delete-own';
import type { CoreApi } from './ports';
import { ANA, NOW, testCorePorts, testCtx } from './test-support';

function msg(id: string): UiMessage {
  return {
    id,
    chatId: ANA,
    senderId: 'u-ana',
    senderName: 'Ana',
    text: id,
    createdAt: NOW,
    status: 'read',
  };
}

function preview(ctx: { chats: readonly { id: string; lastMessage?: UiMessage }[] }) {
  return ctx.chats.find((chat) => chat.id === ANA)?.lastMessage;
}

/** A core api whose delete-for-me calls are recorded. */
function apiWithDelete(
  calls: Array<{ jid: string; archiveId: string }>,
  result: () => Promise<void>,
): CoreApi {
  return {
    ...testCorePorts().api,
    deleteMessageForMe: (jid, archiveId) => {
      calls.push({ jid, archiveId });
      return result();
    },
  };
}

/** A core api whose clear-history calls are recorded. */
function apiWithClear(calls: Array<{ jid: string }>, result: () => Promise<void>): CoreApi {
  return {
    ...testCorePorts().api,
    clearChatHistory: (jid) => {
      calls.push({ jid });
      return result();
    },
  };
}

describe('deleteForMe (core)', () => {
  it('calls the port with the archive id and removes the row, keeping it on failure', async () => {
    const calls: Array<{ jid: string; archiveId: string }> = [];
    const { ctx, state } = testCtx({
      ports: { api: apiWithDelete(calls, () => Promise.resolve()) },
    });
    ctx.k.setChatMessage(ANA, msg('1700000000000000'), true);

    const outcome = await Effect.runPromise(deleteForMe(ctx, ANA, '1700000000000000'));

    expect(outcome).toBe('deleted');
    expect(calls).toEqual([{ jid: ANA, archiveId: '1700000000000000' }]);
    expect(state().messagesByChat[ANA]).toEqual([]);
    expect(preview(state())).toBeUndefined();

    const failedCalls: Array<{ jid: string; archiveId: string }> = [];
    const second = testCtx({
      ports: { api: apiWithDelete(failedCalls, () => Promise.reject(new Error('nope'))) },
    });
    second.ctx.k.setChatMessage(ANA, msg('1700000000000001'), true);

    const failed = await Effect.runPromise(deleteForMe(second.ctx, ANA, '1700000000000001'));

    expect(failed).toBe('failed');
    expect(second.state().messagesByChat[ANA]).toHaveLength(1);
    expect(second.state().actionError).toEqual({ chatId: ANA, message: DELETE_ERROR });
  });

  it('deleting the last of three messages leaves the first two', async () => {
    const calls: Array<{ jid: string; archiveId: string }> = [];
    const { ctx, state } = testCtx({
      ports: { api: apiWithDelete(calls, () => Promise.resolve()) },
    });
    ctx.k.setChatMessage(ANA, msg('mar-1'), false);
    ctx.k.setChatMessage(ANA, msg('mar-2'), false);
    ctx.k.setChatMessage(ANA, msg('mar-3'), false);

    const outcome = await Effect.runPromise(deleteForMe(ctx, ANA, 'mar-3'));

    expect(outcome).toBe('deleted');
    expect(calls).toEqual([{ jid: ANA, archiveId: 'mar-3' }]);
    expect(state().messagesByChat[ANA]?.map((message) => message.id)).toEqual(['mar-1', 'mar-2']);
  });

  it('makes no call for a message with no archive id', async () => {
    const calls: Array<{ jid: string; archiveId: string }> = [];
    const { ctx, state } = testCtx({
      ports: { api: apiWithDelete(calls, () => Promise.resolve()) },
    });
    ctx.k.setChatMessage(ANA, msg('local-9'), true);

    const outcome = await Effect.runPromise(deleteForMe(ctx, ANA, 'local-9'));

    expect(outcome).toBe('unavailable');
    expect(calls).toEqual([]);
    expect(state().messagesByChat[ANA]).toHaveLength(1);
  });
});

describe('clearHistory (core)', () => {
  it('empties the chat and clears the preview, keeping the row', async () => {
    const calls: Array<{ jid: string }> = [];
    const { ctx, state } = testCtx({
      ports: { api: apiWithClear(calls, () => Promise.resolve()) },
    });
    ctx.k.setChatMessage(ANA, msg('m-1'), false);
    ctx.set((previous) => ({
      chats: previous.chats.map((chat) => (chat.id === ANA ? { ...chat, unread: 3 } : chat)),
    }));

    const outcome = await Effect.runPromise(clearHistory(ctx, ANA));

    expect(outcome).toBe('deleted');
    expect(calls).toEqual([{ jid: ANA }]);
    expect(state().messagesByChat[ANA]).toEqual([]);
    const chat = state().chats.find((entry) => entry.id === ANA);
    expect(chat?.lastMessage).toBeUndefined();
    expect(chat?.unread).toBe(0);
    expect(chat).toBeDefined();
  });

  it('keeps the chat and reports failed when the port rejects', async () => {
    const calls: Array<{ jid: string }> = [];
    const { ctx, state } = testCtx({
      ports: { api: apiWithClear(calls, () => Promise.reject(new Error('nope'))) },
    });
    ctx.k.setChatMessage(ANA, msg('m-1'), false);

    const outcome = await Effect.runPromise(clearHistory(ctx, ANA));

    expect(outcome).toBe('failed');
    expect(calls).toEqual([{ jid: ANA }]);
    expect(state().messagesByChat[ANA]).toHaveLength(1);
    expect(state().actionError).toEqual({ chatId: ANA, message: DELETE_ERROR });
  });
});
