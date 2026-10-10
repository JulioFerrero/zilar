import type { ChatMessage } from '@zilar/xmpp-core';
import { describe, expect, it, vi } from 'vitest';
import { deleteForEveryone, editMessage, react, sendTyping } from './actions';
import { handleMessage } from './incoming';
import { ANA, ME, NOW, TEAM, testCtx } from './test-ctx';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
};

// My own message, as its server echo stores it: `srv-1`, origin id `origin-1`.
function withMyMessage(options: Parameters<typeof testCtx>[0] = {}) {
  const harness = testCtx(options);
  const echo: ChatMessage = {
    id: 'srv-1',
    originId: 'origin-1',
    chatJid: ANA,
    kind: 'chat',
    fromJid: ME,
    fromResolved: true,
    body: 'hello',
    timestamp: NOW,
    outgoing: true,
  };
  handleMessage(harness.ctx, echo);
  return harness;
}

describe('react (core)', () => {
  it('toggles my reaction and sends my whole set', () => {
    const { ctx, core, state } = withMyMessage();
    react(ctx, ANA, 'srv-1', '👍');

    // A DM names the target by the id its sender gave it.
    expect(core.sendReactions).toHaveBeenLastCalledWith(ANA, 'chat', 'origin-1', ['👍']);
    const target = ctx.k.aliasRoot('srv-1');
    expect(state().reactions[ANA]?.targets[target]?.[ME]?.emojis).toEqual(['👍']);
    react(ctx, ANA, 'srv-1', '👍');
    expect(core.sendReactions).toHaveBeenLastCalledWith(ANA, 'chat', 'origin-1', []);
  });

  it('reverts the toggle when the send fails', async () => {
    const { ctx, state } = withMyMessage({
      core: { sendReactions: vi.fn(async () => Promise.reject(new Error('offline'))) },
    });
    react(ctx, ANA, 'srv-1', '👍');
    const target = ctx.k.aliasRoot('srv-1');
    expect(state().reactions[ANA]?.targets[target]?.[ME]?.emojis).toEqual(['👍']);
    await flush();

    expect(state().reactions[ANA]?.targets[target]?.[ME]?.emojis ?? []).toEqual([]);
  });
});

describe('editMessage (core)', () => {
  it('sends the correction by the origin id and shows the new text', () => {
    const { ctx, core, state } = withMyMessage();
    editMessage(ctx, ANA, 'srv-1', ' hello there ');

    expect(core.sendCorrection).toHaveBeenCalledWith(
      ANA,
      'chat',
      'origin-1',
      'hello there',
      undefined,
    );
    expect(state().messagesByChat[ANA]?.[0]).toMatchObject({ text: 'hello there', edited: true });
  });

  it('sends nothing for an unchanged or empty text', () => {
    const { ctx, core } = withMyMessage();
    editMessage(ctx, ANA, 'srv-1', 'hello');
    editMessage(ctx, ANA, 'srv-1', '  ');

    expect(core.sendCorrection).not.toHaveBeenCalled();
  });

  it('restores the text and shows the error when the send fails', async () => {
    const { ctx, state } = withMyMessage({
      core: { sendCorrection: vi.fn(async () => Promise.reject(new Error('offline'))) },
    });
    editMessage(ctx, ANA, 'srv-1', 'hello there');
    await flush();

    expect(state().messagesByChat[ANA]?.[0]?.text).toBe('hello');
    expect(state().actionError).toEqual({
      chatId: ANA,
      message: 'Could not save the edit. Try again.',
    });
  });
});

describe('deleteForEveryone (core)', () => {
  it('sends the retraction by the origin id in a DM', () => {
    const { ctx, core, state } = withMyMessage();
    deleteForEveryone(ctx, ANA, 'srv-1');

    expect(core.sendRetraction).toHaveBeenCalledWith(ANA, 'chat', 'origin-1');
    expect(state().messagesByChat[ANA]?.[0]?.deleted).toBe(true);
  });

  it('restores the message and shows the error when the send fails', async () => {
    const { ctx, state } = withMyMessage({
      core: { sendRetraction: vi.fn(async () => Promise.reject(new Error('offline'))) },
    });
    deleteForEveryone(ctx, ANA, 'srv-1');
    await flush();

    expect(state().messagesByChat[ANA]?.[0]).toMatchObject({ text: 'hello' });
    expect(state().messagesByChat[ANA]?.[0]?.deleted).not.toBe(true);
    expect(state().actionError).toEqual({
      chatId: ANA,
      message: 'Could not delete the message. Try again.',
    });
  });
});

describe('sendTyping (core)', () => {
  it('sends composing with the chat kind, and nothing for an unknown chat', () => {
    const { ctx, core } = testCtx();
    sendTyping(ctx, TEAM);
    sendTyping(ctx, 'nobody@zilar.test');

    expect(core.sendTyping).toHaveBeenCalledTimes(1);
    expect(core.sendTyping).toHaveBeenCalledWith(TEAM, 'groupchat', 'composing');
  });
});
