import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@zilar/xmpp-core';
import { fakeApi, fakeXmpp } from '@/test/storeHarness';
import { flushTasks as flush } from '@/test/wait';
import { createRealChatStore } from './realStore';

// The send-echo paths of the message ledger, through the real web store: an
// echo that arrives before `sendMessage` resolves, two identical texts in a
// row, and the echo of a reply (T-0904).

const ANA = 'ana@zilar.test';
const TEAM = 'team@rooms.zilar.test';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function echo(overrides: Partial<ChatMessage> & { id: string; chatJid: string }): ChatMessage {
  return {
    kind: overrides.chatJid.includes('@rooms.') ? 'groupchat' : 'chat',
    fromJid: 'me@zilar.test',
    fromResolved: true,
    timestamp: new Date('2026-09-28T12:02:00Z'),
    outgoing: true,
    ...overrides,
  };
}

async function setup(sends: Promise<{ id: string }>[]) {
  const pending = [...sends];
  const xmpp = fakeXmpp({
    sendMessage: vi.fn(() => pending.shift() ?? Promise.resolve({ id: 'srv-extra' })),
  });
  xmpp.history[ANA] = [
    {
      id: 'ana-1',
      kind: 'chat',
      chatJid: ANA,
      fromJid: ANA,
      fromResolved: true,
      body: 'question?',
      timestamp: new Date('2026-09-28T09:00:00Z'),
      outgoing: false,
    },
  ];
  const store = createRealChatStore({
    api: fakeApi(),
    storage: null,
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp: (options) => {
      xmpp.options.current = options;
      return xmpp.core;
    },
  });
  store.getState().start();
  await flush();
  return { store, xmpp };
}

describe('send echoes through the web store', () => {
  it('links an echo that arrives before sendMessage resolves', async () => {
    const send = deferred<{ id: string }>();
    const { store, xmpp } = await setup([send.promise]);

    store.getState().sendText(ANA, 'hello');
    const local = store.getState().messages(ANA).at(-1)?.id ?? '';
    expect(local).toMatch(/^local-/);

    xmpp.emit('message', echo({ id: 'srv-1', chatJid: ANA, body: 'hello' }));
    expect(
      store
        .getState()
        .messages(ANA)
        .filter((m) => m.text === 'hello')
        .map((m) => [m.id, m.status]),
    ).toEqual([['srv-1', 'sent']]);

    send.resolve({ id: 'srv-1' });
    await flush();

    expect(
      store
        .getState()
        .messages(ANA)
        .filter((m) => m.text === 'hello')
        .map((m) => [m.id, m.status]),
    ).toEqual([['srv-1', 'sent']]);
    expect(store.getState().chats.find((c) => c.id === ANA)?.lastMessage?.id).toBe('srv-1');
    store.getState().react(ANA, local, '👍');
    expect(xmpp.core.sendReactions).toHaveBeenLastCalledWith(ANA, 'chat', 'srv-1', ['👍']);
  });

  it('links an early group echo to its stanza id', async () => {
    const send = deferred<{ id: string }>();
    const { store, xmpp } = await setup([send.promise]);

    store.getState().sendText(TEAM, 'hi team');
    const local = store.getState().messages(TEAM).at(-1)?.id ?? '';

    xmpp.emit(
      'message',
      echo({ id: 'stanza-1', originId: 'origin-1', chatJid: TEAM, body: 'hi team' }),
    );
    send.resolve({ id: 'origin-1' });
    await flush();

    expect(
      store
        .getState()
        .messages(TEAM)
        .filter((m) => m.text === 'hi team')
        .map((m) => [m.id, m.status]),
    ).toEqual([['stanza-1', 'sent']]);
    store.getState().react(TEAM, local, '👍');
    expect(xmpp.core.sendReactions).toHaveBeenLastCalledWith(TEAM, 'groupchat', 'stanza-1', ['👍']);
  });

  it('links a late group echo to its stanza id too', async () => {
    const { store, xmpp } = await setup([Promise.resolve({ id: 'origin-1' })]);

    store.getState().sendText(TEAM, 'hi team');
    const local = store.getState().messages(TEAM).at(-1)?.id ?? '';
    await flush();
    xmpp.emit(
      'message',
      echo({ id: 'stanza-1', originId: 'origin-1', chatJid: TEAM, body: 'hi team' }),
    );

    expect(
      store
        .getState()
        .messages(TEAM)
        .filter((m) => m.text === 'hi team')
        .map((m) => [m.id, m.status]),
    ).toEqual([['stanza-1', 'sent']]);
    store.getState().react(TEAM, local, '👍');
    expect(xmpp.core.sendReactions).toHaveBeenLastCalledWith(TEAM, 'groupchat', 'stanza-1', ['👍']);
  });

  it('links two identical texts sent in a row in order', async () => {
    const first = deferred<{ id: string }>();
    const second = deferred<{ id: string }>();
    const { store, xmpp } = await setup([first.promise, second.promise]);

    store.getState().sendText(ANA, 'ok');
    store.getState().sendText(ANA, 'ok');
    const locals = store
      .getState()
      .messages(ANA)
      .filter((m) => m.text === 'ok')
      .map((m) => m.id);
    expect(locals).toHaveLength(2);
    const [firstLocal = '', secondLocal = ''] = locals;

    xmpp.emit('message', echo({ id: 'srv-1', chatJid: ANA, body: 'ok' }));
    xmpp.emit(
      'message',
      echo({ id: 'srv-2', chatJid: ANA, body: 'ok', timestamp: new Date('2026-09-28T12:03:00Z') }),
    );
    // The acks come back out of order.
    second.resolve({ id: 'srv-2' });
    first.resolve({ id: 'srv-1' });
    await flush();

    expect(
      store
        .getState()
        .messages(ANA)
        .filter((m) => m.text === 'ok')
        .map((m) => [m.id, m.status]),
    ).toEqual([
      ['srv-1', 'sent'],
      ['srv-2', 'sent'],
    ]);
    store.getState().react(ANA, firstLocal, '👍');
    expect(xmpp.core.sendReactions).toHaveBeenLastCalledWith(ANA, 'chat', 'srv-1', ['👍']);
    store.getState().react(ANA, secondLocal, '🎉');
    expect(xmpp.core.sendReactions).toHaveBeenLastCalledWith(ANA, 'chat', 'srv-2', ['🎉']);
  });

  it('matches the echo of a reply to the reply, not to the same text without one', async () => {
    const plainSend = deferred<{ id: string }>();
    const replySend = deferred<{ id: string }>();
    const { store, xmpp } = await setup([plainSend.promise, replySend.promise]);
    store.getState().openChat(ANA);
    await flush();
    expect(
      store
        .getState()
        .messages(ANA)
        .map((m) => m.id),
    ).toContain('ana-1');

    store.getState().sendText(ANA, 'answer');
    store.getState().sendText(ANA, 'answer', {
      replyTo: { id: 'ana-1', senderName: 'Ana', text: 'question?' },
    });
    const [plainLocal = '', replyLocal = ''] = store
      .getState()
      .messages(ANA)
      .filter((m) => m.text === 'answer')
      .map((m) => m.id);

    xmpp.emit(
      'message',
      echo({ id: 'srv-r', chatJid: ANA, body: 'answer', replyTo: { id: 'ana-1' } }),
    );
    replySend.resolve({ id: 'srv-r' });
    await flush();

    const answers = store
      .getState()
      .messages(ANA)
      .filter((m) => m.text === 'answer');
    expect(answers.map((m) => [m.id, m.status])).toEqual([
      [plainLocal, 'sending'],
      ['srv-r', 'sent'],
    ]);
    expect(answers[1]?.replyTo).toEqual({ id: 'ana-1', senderName: 'Ana', text: 'question?' });
    store.getState().react(ANA, replyLocal, '👍');
    expect(xmpp.core.sendReactions).toHaveBeenLastCalledWith(ANA, 'chat', 'srv-r', ['👍']);

    // The plain one still links to its own echo afterwards.
    xmpp.emit(
      'message',
      echo({
        id: 'srv-p',
        chatJid: ANA,
        body: 'answer',
        timestamp: new Date('2026-09-28T12:03:00Z'),
      }),
    );
    plainSend.resolve({ id: 'srv-p' });
    await flush();
    expect(
      store
        .getState()
        .messages(ANA)
        .filter((m) => m.text === 'answer')
        .map((m) => [m.id, m.status]),
    ).toEqual([
      ['srv-r', 'sent'],
      ['srv-p', 'sent'],
    ]);
  });
});
