import type { ChatMessage } from '@zilar/xmpp-core';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editMessage, react } from './actions';
import {
  handleDisplayed,
  handleMessage,
  handleOccupants,
  handlePresence,
  handleTyping,
  TYPING_CLEAR_MS,
} from './incoming';
import { startChatsPolling, type PollingCtx } from './polling';
import { LAST_READ_PREFIX } from './reads';
import { ANA, dm, ME, NOW, TEAM, team, testCtx } from './test-ctx';

afterEach(() => {
  vi.useRealTimers();
});

function message(fields: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    chatJid: ANA,
    kind: 'chat',
    fromJid: ANA,
    fromResolved: true,
    body: fields.id,
    timestamp: NOW,
    outgoing: false,
    ...fields,
  };
}

describe('handleMessage (core)', () => {
  it('adds a message to a closed chat as unread and re-syncs the badge', () => {
    const { ctx, fx, core, state } = testCtx();
    handleMessage(ctx, message({ id: 'ana-1' }));

    expect(state().messagesByChat[ANA]?.map((item) => item.id)).toEqual(['ana-1']);
    expect(state().chats[0]).toMatchObject({ id: ANA, unread: 1 });
    expect(state().chats[0]?.lastMessage?.id).toBe('ana-1');
    expect(fx.syncBadge).toHaveBeenCalledTimes(1);
    expect(core.markDisplayed).not.toHaveBeenCalled();
  });

  it('reads a message in the open, visible chat and saves the last read', () => {
    const setItem = vi.fn();
    const storage = { getItem: () => null, setItem, removeItem: vi.fn() };
    const { ctx, fx, core, state } = testCtx({
      ports: { storage },
      state: { activeChatId: ANA },
    });
    handleMessage(ctx, message({ id: 'ana-1' }));

    expect(state().chats.find((chat) => chat.id === ANA)?.unread).toBe(0);
    expect(core.markDisplayed).toHaveBeenCalledWith(ANA, 'chat', 'ana-1');
    expect(setItem).toHaveBeenCalledWith(
      `${LAST_READ_PREFIX}u-me`,
      JSON.stringify({ [ANA]: 'ana-1' }),
    );
    expect(fx.dismissChatNotifications).toHaveBeenCalledWith(ANA);
    expect(fx.syncBadge).toHaveBeenCalledTimes(1);
  });

  it('counts a message in the open chat as unread while the app is hidden', () => {
    const { ctx, core, state } = testCtx({
      ports: { isVisible: () => false },
      state: { activeChatId: ANA },
    });
    handleMessage(ctx, message({ id: 'ana-1' }));

    expect(state().chats.find((chat) => chat.id === ANA)?.unread).toBe(1);
    expect(core.markDisplayed).not.toHaveBeenCalled();
  });

  it('replaces the optimistic bubble with its echo and forgets the retry bytes', () => {
    const { ctx, fx, state } = testCtx();
    ctx.k.setChatMessage(
      ANA,
      {
        id: 'local-1',
        chatId: ANA,
        senderId: 'u-me',
        senderName: 'You',
        text: 'hello',
        createdAt: NOW,
        status: 'sending',
      },
      true,
    );
    const signature = ctx.k.signatureFor(ANA, 'hello', undefined);
    ctx.pendingOutgoing.set(signature, ['local-1']);

    handleMessage(ctx, message({ id: 'srv-1', body: 'hello', fromJid: ME, outgoing: true }));

    expect(state().messagesByChat[ANA]?.map((item) => [item.id, item.status])).toEqual([
      ['srv-1', 'sent'],
    ]);
    expect(ctx.pendingOutgoing.has(signature)).toBe(false);
    expect(ctx.k.sameMessage('local-1', 'srv-1')).toBe(true);
    expect(fx.forgetRetryBytes).toHaveBeenCalledWith('local-1');
    expect(fx.syncBadge).not.toHaveBeenCalled();
  });

  it("finishes the AI's draft with its final message, in one update", () => {
    const { ctx, fx, state } = testCtx({
      state: { drafts: { [ANA]: { turnId: 'turn-1', text: 'Hel' } } },
    });
    handleMessage(ctx, message({ id: 'ana-final' }));

    expect(fx.finishDraftTurn).toHaveBeenCalledWith(ANA, 'turn-1');
    expect(state().drafts[ANA]).toBeUndefined();
    expect(state().finishedDraftMessages).toEqual({ 'ana-final': 'turn-1' });
  });

  it('ingests a reaction-only message without a bubble', () => {
    const { ctx, state } = testCtx();
    handleMessage(ctx, message({ id: 'ana-1' }));
    const { body: _body, ...reaction } = message({
      id: 'r-1',
      reactions: { targetId: 'ana-1', emojis: ['👍'] },
    });
    handleMessage(ctx, reaction);

    expect(state().messagesByChat[ANA]?.map((item) => item.id)).toEqual(['ana-1']);
    expect(state().reactions[ANA]?.targets['ana-1']?.[ANA]?.emojis).toEqual(['👍']);
  });
});

describe('handleTyping (core)', () => {
  const typing = (state: string, fromJid = ANA) => ({
    chatJid: TEAM,
    fromJid,
    state,
    outgoing: false,
  });

  it('shows the typing line, then clears it after the wait', () => {
    vi.useFakeTimers();
    const { ctx, fx, state } = testCtx();
    handleTyping(ctx, typing('composing'));

    expect(state().typing[TEAM]?.names).toEqual(['Ana']);
    expect(fx.loadGroupMembers).toHaveBeenCalledWith(TEAM);
    vi.advanceTimersByTime(TYPING_CLEAR_MS - 1);
    expect(state().typing[TEAM]).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(state().typing[TEAM]).toBeUndefined();
  });

  it('clears at once on paused and cancels the wait', () => {
    vi.useFakeTimers();
    const { ctx, rt, state } = testCtx();
    handleTyping(ctx, typing('composing'));
    handleTyping(ctx, typing('paused'));

    expect(state().typing[TEAM]).toBeUndefined();
    expect(rt.has(`typing:${TEAM}`)).toBe(false);
  });

  it('ignores my own reflection', () => {
    const { ctx, fx, state } = testCtx();
    handleTyping(ctx, typing('composing', ME));
    handleTyping(ctx, { ...typing('composing', `${TEAM}/me`), outgoing: true });

    expect(state().typing).toEqual({});
    expect(fx.loadGroupMembers).not.toHaveBeenCalled();
  });
});

describe('markers, occupants and presence (core)', () => {
  it("marks my message read on a peer's marker, never on my own", () => {
    const { ctx, state } = testCtx();
    handleMessage(ctx, message({ id: 'srv-1', fromJid: ME, outgoing: true }));
    const event = { chatJid: ANA, messageId: 'srv-1', outgoing: false };

    handleDisplayed(ctx, { ...event, fromJid: ME });
    expect(state().messagesByChat[ANA]?.[0]?.status).not.toBe('read');
    handleDisplayed(ctx, { ...event, fromJid: ANA });
    expect(state().messagesByChat[ANA]?.[0]?.status).toBe('read');
  });

  it('counts the available occupants and keeps the larger member count', () => {
    const { ctx, state } = testCtx();
    const occupant = (nick: string, available: boolean) => ({
      jid: `${TEAM}/${nick}`,
      nick,
      available,
    });
    handleOccupants(ctx, { roomJid: TEAM, occupants: [occupant('a', true), occupant('b', false)] });

    expect(state().chats.find((chat) => chat.id === TEAM)).toMatchObject({
      onlineCount: 1,
      memberCount: 3,
    });
  });

  it('stamps last seen when a contact goes offline', () => {
    const { ctx, state } = testCtx();
    handlePresence(ctx, { jid: ANA, available: true });
    expect(state().chats.find((chat) => chat.id === ANA)).toMatchObject({ online: true });
    expect(state().chats.find((chat) => chat.id === ANA)?.lastSeenAt).toBeUndefined();
    handlePresence(ctx, { jid: ANA, available: false });
    expect(state().chats.find((chat) => chat.id === ANA)).toMatchObject({
      online: false,
      lastSeenAt: NOW,
    });
  });
});

describe('the outgoing echo re-applies edits and reactions (core)', () => {
  // The state after a send's ack: the ledger aliases the optimistic id to the
  // server id, so an edit or a reaction filed between the ack and the echo
  // lands under the optimistic id the bubble currently carries.
  function ackedLocal(chatId: string, chat: typeof dm, id: string, text: string) {
    const { ctx, state } = testCtx();
    ctx.k.setChatMessage(
      chatId,
      {
        id,
        chatId,
        senderId: 'u-me',
        senderName: 'You',
        text,
        createdAt: NOW,
        status: 'sent',
      },
      true,
    );
    ctx.k.rememberAuthor(id, { jid: ME, resolved: true });
    ctx.k.linkMessageIds(id, 'srv-1');
    ctx.k.linkAckToServer(chat, id, 'srv-1');
    ctx.k.rememberOriginId(id, 'srv-1');
    return { ctx, state };
  }

  it('keeps an edit made after the ack when the echo arrives', () => {
    const { ctx, state } = ackedLocal(ANA, dm, 'local-1', 'hello');
    editMessage(ctx, ANA, 'local-1', 'hello there');
    expect(state().messagesByChat[ANA]?.at(-1)?.text).toBe('hello there');

    ctx.pendingOutgoing.set(ctx.k.signatureFor(ANA, 'hello', undefined), ['local-1']);
    handleMessage(ctx, message({ id: 'srv-1', body: 'hello', fromJid: ME, outgoing: true }));

    expect(state().messagesByChat[ANA]?.map((item) => [item.id, item.text, item.edited])).toEqual([
      ['srv-1', 'hello there', true],
    ]);
  });

  it('keeps a reaction made after the ack when the group echo arrives', () => {
    const { ctx, state } = ackedLocal(TEAM, team, 'local-1', 'hi team');
    react(ctx, TEAM, 'local-1', '👍');
    expect(state().messagesByChat[TEAM]?.at(-1)?.reactions).toEqual([
      expect.objectContaining({ emoji: '👍', count: 1, mine: true }),
    ]);

    ctx.pendingOutgoing.set(ctx.k.signatureFor(TEAM, 'hi team', undefined), ['local-1']);
    handleMessage(
      ctx,
      message({
        id: 'room-1',
        originId: 'srv-1',
        chatJid: TEAM,
        kind: 'groupchat',
        body: 'hi team',
        fromJid: ME,
        outgoing: true,
      }),
    );

    expect(state().messagesByChat[TEAM]?.map((item) => [item.id, item.reactions?.length])).toEqual([
      ['room-1', 1],
    ]);
  });
});

describe('clearing the open chat on refocus (core)', () => {
  it('drops the open chat unread and sends the read marker when focus returns', () => {
    vi.useFakeTimers();
    let visible = false;
    let focus: (() => void) | undefined;
    const visibility = {
      isVisible: () => visible,
      onFocus: (handler: () => void) => {
        focus = handler;
        return () => {};
      },
    };
    const { ctx, core, fx, rt } = testCtx({
      ports: { visibility, isVisible: () => visible },
      state: { activeChatId: ANA },
    });
    const hooks = ctx.fx as unknown as { refreshChats: () => void };
    hooks.refreshChats = vi.fn();
    Effect.runSync(startChatsPolling(ctx as unknown as PollingCtx, rt.beginSession()));

    // A message arrives while hidden: the open chat keeps it as unread.
    handleMessage(ctx, message({ id: 'ana-1' }));
    expect(ctx.get().chats.find((chat) => chat.id === ANA)?.unread).toBe(1);
    expect(core.markDisplayed).not.toHaveBeenCalled();

    // The app comes back with the same chat open: it is read at once.
    visible = true;
    focus?.();

    expect(ctx.get().chats.find((chat) => chat.id === ANA)?.unread).toBe(0);
    expect(core.markDisplayed).toHaveBeenCalledWith(ANA, 'chat', 'ana-1');
    expect(fx.dismissChatNotifications).toHaveBeenCalledWith(ANA);
  });
});
