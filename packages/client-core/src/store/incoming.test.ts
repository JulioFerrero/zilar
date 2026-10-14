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

  it('drops a live resend with the same origin id: one bubble, unread 1', () => {
    const { ctx, fx, state } = testCtx();
    handleMessage(ctx, message({ id: 'stanza-a', originId: 'o-1', body: 'hello' }));
    handleMessage(ctx, message({ id: 'stanza-b', originId: 'o-1', body: 'hello' }));

    expect(state().messagesByChat[ANA]?.map((item) => item.id)).toEqual(['stanza-a']);
    expect(state().chats.find((chat) => chat.id === ANA)).toMatchObject({
      unread: 1,
      lastMessage: expect.objectContaining({ id: 'stanza-a' }),
    });
    expect(fx.syncBadge).toHaveBeenCalledTimes(1);
  });

  it('counts an album once: later photos do not bump the unread badge', () => {
    const { ctx, state } = testCtx();
    const photo = (id: string, index: number) =>
      message({ id, album: { id: 'alb-1', index, count: 3 } });
    handleMessage(ctx, photo('p-0', 0));
    handleMessage(ctx, photo('p-1', 1));
    handleMessage(ctx, photo('p-2', 2));

    expect(state().messagesByChat[ANA]?.map((item) => item.id)).toEqual(['p-0', 'p-1', 'p-2']);
    expect(state().chats.find((chat) => chat.id === ANA)).toMatchObject({ unread: 1 });
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

  it('clears the chat unread on an echo with no local id (another device)', () => {
    const { ctx, fx, state } = testCtx({
      state: { chats: [{ ...dm, unread: 2 }, team] },
    });
    expect(state().chats.find((chat) => chat.id === ANA)?.unread).toBe(2);

    handleMessage(
      ctx,
      message({ id: 'srv-9', body: 'from my phone', fromJid: ME, outgoing: true }),
    );

    expect(state().chats.find((chat) => chat.id === ANA)?.unread).toBe(0);
    expect(fx.dismissChatNotifications).toHaveBeenCalledWith(ANA);
    expect(fx.syncBadge).toHaveBeenCalled();
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

describe('handleMessage reply quotes (core)', () => {
  it('resolves a reply that names the quoted message by its origin id', () => {
    const { ctx, state } = testCtx();
    // The quoted message is stored under this side's archive id, aliased to
    // its origin id, which is what the wire reply carries.
    handleMessage(ctx, message({ id: 'a-1', originId: 'o-1', body: 'the original' }));
    handleMessage(ctx, message({ id: 'a-2', body: 'my reply', replyTo: { id: 'o-1' } }));
    expect(state().messagesByChat[ANA]?.find((item) => item.id === 'a-2')?.replyTo).toEqual({
      id: 'o-1',
      senderName: 'Ana',
      text: 'the original',
    });
  });

  it('falls back to the quoted text when the target is not loaded', () => {
    const { ctx, state } = testCtx();
    // The body arrives with the fallback line already stripped by the decoder.
    handleMessage(
      ctx,
      message({ id: 'a-3', body: 'my reply', replyTo: { id: 'o-9', text: 'old' } }),
    );
    const reply = state().messagesByChat[ANA]?.find((item) => item.id === 'a-3');
    expect(reply?.replyTo).toEqual({ id: 'o-9', senderName: '', text: 'old' });
    expect(reply?.text).toBe('my reply');
  });

  it('keeps a hand-typed quote line, which the decoder leaves alone', () => {
    const { ctx, state } = testCtx();
    handleMessage(ctx, message({ id: 'a-4', body: '> x\nmy text', replyTo: { id: 'o-9' } }));
    expect(state().messagesByChat[ANA]?.[0]?.text).toBe('> x\nmy text');
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
    expect(rt.has(`typing:${TEAM}:${ANA}`)).toBe(false);
  });

  it('ignores my own reflection', () => {
    const { ctx, fx, state } = testCtx();
    handleTyping(ctx, typing('composing', ME));
    handleTyping(ctx, { ...typing('composing', `${TEAM}/me`), outgoing: true });

    expect(state().typing).toEqual({});
    expect(fx.loadGroupMembers).not.toHaveBeenCalled();
  });

  it("clears the line the moment that peer's message arrives", () => {
    vi.useFakeTimers();
    const { ctx, state } = testCtx();
    handleTyping(ctx, { chatJid: ANA, fromJid: ANA, state: 'composing', outgoing: false });
    expect(state().typing[ANA]?.names).toEqual(['Ana']);

    handleMessage(ctx, message({ id: 'ana-1' }));

    expect(state().typing[ANA]).toBeUndefined();
  });

  it('keeps the other typer when one sender pauses in a group', () => {
    vi.useFakeTimers();
    const { ctx, rt, state } = testCtx();
    handleTyping(ctx, { chatJid: TEAM, fromJid: ANA, state: 'composing', outgoing: false });
    handleTyping(ctx, {
      chatJid: TEAM,
      fromJid: 'ben@zilar.test',
      state: 'composing',
      outgoing: false,
    });
    expect(state().typing[TEAM]?.names).toHaveLength(2);

    handleTyping(ctx, { chatJid: TEAM, fromJid: ANA, state: 'paused', outgoing: false });

    expect(state().typing[TEAM]?.names).toHaveLength(1);
    expect(rt.has(`typing:${TEAM}:ana@zilar.test`)).toBe(false);
    expect(rt.has(`typing:${TEAM}:ben@zilar.test`)).toBe(true);
  });

  it("keeps an AI sender's status text", () => {
    vi.useFakeTimers();
    const { ctx, state } = testCtx();
    handleTyping(ctx, {
      chatJid: TEAM,
      fromJid: 'ai-dev@zilar.test',
      state: 'composing',
      status: 'Searching the web',
      outgoing: false,
    });

    expect(state().typing[TEAM]?.status).toBe('Searching the web');
  });

  it('ignores a status text from a sender that is not an AI', () => {
    vi.useFakeTimers();
    const { ctx, rt, state } = testCtx();
    handleTyping(ctx, {
      chatJid: TEAM,
      fromJid: ANA,
      state: 'composing',
      status: 'Account locked, open evil.test',
      outgoing: false,
    });

    // The spoofed text never becomes the chat's status; the sender still types.
    expect(state().typing[TEAM]?.status).toBeUndefined();
    expect(state().typing[TEAM]?.names).toEqual(['Ana']);
    expect(rt.has(`status:${TEAM}:${ANA}`)).toBe(false);
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

  it('reads last seen from the delay stamp of an unavailable presence', () => {
    const { ctx, state } = testCtx();
    const stamp = new Date('2026-09-20T08:00:00Z').getTime();
    handlePresence(ctx, { jid: ANA, available: false, delayedAt: stamp });

    expect(state().chats.find((chat) => chat.id === ANA)).toMatchObject({ online: false });
    expect(state().chats.find((chat) => chat.id === ANA)?.lastSeenAt).toEqual(
      new Date('2026-09-20T08:00:00Z'),
    );
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
