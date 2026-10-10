import type { ChatSummary, ReplyRef } from '@zilar/chat-core';
import { describe, expect, it } from 'vitest';
import {
  createMessageLedger,
  type LedgerSet,
  type LedgerStanza,
  type LedgerState,
  type StoreMessage,
} from './ledger';
import { advanceStatus, moveChatToTop, sortMessages } from './rows';

const ME = 'me@zilar.test';
const BOB = 'bob@zilar.test';
const ROOM = 'room@groups.zilar.test';

const room: ChatSummary = { id: ROOM, kind: 'group', title: 'Room', unread: 0 } as ChatSummary;

// A store around the ledger that drives it the way the web send pipeline
// (`apps/web/src/store/effects/send.ts`) and the incoming handler
// (`apps/web/src/store/effects/incoming.ts`) do: the same ledger calls in the
// same order, with the echo queue keyed by `signatureFor`.
function harness() {
  let state: LedgerState = {
    messagesByChat: {},
    chats: [room],
    edits: {},
    reactions: {},
    contacts: [{ jid: BOB, name: 'Bob' }],
    me: { jid: ME },
  };
  const set: LedgerSet = (update) => {
    const patch = typeof update === 'function' ? update(state) : update;
    state = { ...state, ...patch };
  };
  const ledger = createMessageLedger({
    get: () => state,
    set,
    memberName: () => undefined,
    occupantNick: () => undefined,
    mediaToken: () => undefined,
  });
  const pendingOutgoing = new Map<string, string[]>();
  let sequence = 0;

  // `sendText`: the optimistic bubble, queued under its echo signature.
  function send(text: string, replyTo?: ReplyRef): string {
    sequence += 1;
    const localId = `local-${sequence}`;
    const message: StoreMessage = {
      id: localId,
      chatId: ROOM,
      senderId: 'me',
      senderName: 'You',
      text,
      createdAt: new Date(1_000 + sequence),
      status: 'sending',
      ...(replyTo === undefined ? {} : { replyTo }),
    };
    const signature = ledger.signatureFor(ROOM, text, replyTo);
    pendingOutgoing.set(signature, [...(pendingOutgoing.get(signature) ?? []), localId]);
    ledger.setChatMessage(ROOM, message, true);
    ledger.rememberAuthor(localId, { jid: ME, resolved: true });
    ledger.rememberBaseText(localId, text);
    return localId;
  }

  // `sendMessage` resolved: `linkSent`, then the status.
  function resolve(localId: string, sentId: string): void {
    ledger.linkMessageIds(localId, sentId);
    ledger.linkAckToServer(room, localId, sentId);
    ledger.rememberOriginId(localId, sentId);
    ledger.updateMessageStatus(ROOM, localId, 'sent');
  }

  // `handleOutgoingEcho`.
  function echo(stanza: LedgerStanza): void {
    const ui = ledger.toUiMessage(stanza, 'me');
    const replyRef =
      stanza.replyTo === undefined ? undefined : { id: stanza.replyTo.id, senderName: '' };
    const signature = ledger.signatureFor(ROOM, stanza.body ?? '', replyRef);
    const queue = pendingOutgoing.get(signature);
    const localId = queue?.shift();
    if (queue !== undefined && queue.length === 0) {
      pendingOutgoing.delete(signature);
    }
    if (localId !== undefined) {
      ledger.linkMessageIds(localId, ui.id);
      ledger.linkLocalToServer(localId, ui.id);
      ledger.clearSendFailure(ROOM, ui.id);
      ledger.updateMessageStatus(ROOM, ui.id, 'sent');
    }
    set((current) => {
      const existing = ledger.listFor(current, ROOM);
      const previous = existing.find((item) => ledger.sameMessage(item.id, ui.id));
      const reconciled =
        previous === undefined ? ui : { ...ui, status: advanceStatus(previous.status, ui.status) };
      const withoutLocal =
        localId === undefined ? existing : existing.filter((item) => item.id !== localId);
      return {
        messagesByChat: {
          ...current.messagesByChat,
          [ROOM]: sortMessages([
            ...withoutLocal.filter((item) => item.id !== reconciled.id),
            reconciled,
          ]),
        },
        chats: moveChatToTop(
          current.chats.map((chat) =>
            chat.id === ROOM ? { ...chat, lastMessage: reconciled } : chat,
          ),
          ROOM,
        ),
      };
    });
  }

  // `handleMessage` for a message from someone else, or any edit stanza.
  function receive(stanza: LedgerStanza): void {
    if (ledger.isEditStanza(stanza)) {
      ledger.ingestEdit(stanza);
      return;
    }
    if (stanza.reactions !== undefined) {
      ledger.ingestReaction(stanza);
      if (ledger.isReactionOnly(stanza)) {
        return;
      }
    }
    const ui = ledger.toUiMessage(stanza, 'me');
    set((current) => ({
      messagesByChat: {
        ...current.messagesByChat,
        [ROOM]: sortMessages([
          ...ledger.listFor(current, ROOM).filter((item) => item.id !== ui.id),
          ui,
        ]),
      },
    }));
    ledger.resolvePendingEdits(ROOM);
    ledger.refreshEdits(ROOM);
  }

  return { ledger, send, resolve, echo, receive, messages: () => ledger.listFor(state, ROOM) };
}

const stanza = (fields: Partial<LedgerStanza> & { id: string }): LedgerStanza => ({
  chatJid: ROOM,
  fromJid: ME,
  fromResolved: true,
  timestamp: new Date(5_000),
  outgoing: true,
  ...fields,
});

describe('the message ledger: send echoes', () => {
  it('links an echo that arrives before sendMessage resolves', () => {
    const h = harness();
    const localId = h.send('hello');
    h.echo(stanza({ id: 'stanza-1', originId: 'origin-1', body: 'hello' }));

    expect(h.messages().map((m) => [m.id, m.status, m.text])).toEqual([
      ['stanza-1', 'sent', 'hello'],
    ]);
    expect(h.ledger.sameMessage(localId, 'stanza-1')).toBe(true);

    h.resolve(localId, 'origin-1');

    expect(h.messages().map((m) => [m.id, m.status])).toEqual([['stanza-1', 'sent']]);
    expect(h.ledger.sameMessage(localId, 'origin-1')).toBe(true);
    expect(h.ledger.correctionTargetFor(localId)).toBe('origin-1');
    expect(h.ledger.correctionTargetFor('stanza-1')).toBe('origin-1');
    // The room's stanza id stays the wire target: the later ack keeps it.
    expect(h.ledger.wireTargetFor(localId)).toBe('stanza-1');

    // A read marker and a reaction naming the stanza id land on the bubble.
    h.ledger.updateMessageStatus(ROOM, 'stanza-1', 'read');
    h.receive(
      stanza({
        id: 'reaction-1',
        fromJid: BOB,
        outgoing: false,
        reactions: { targetId: 'stanza-1', emojis: ['👍'] },
      }),
    );
    const [bubble] = h.messages();
    expect(bubble?.status).toBe('read');
    expect(bubble?.reactions?.map((chip) => [chip.emoji, chip.reactors])).toEqual([
      ['👍', ['Someone']],
    ]);

    // My own correction, naming the origin id, applies to the echoed bubble.
    h.receive(stanza({ id: 'fix-1', body: 'hello there', correction: { targetId: 'origin-1' } }));
    expect(h.messages()[0]?.text).toBe('hello there');
    expect(h.messages()[0]?.edited).toBe(true);
  });

  it('links two identical texts sent in a row in order, each to its own echo', () => {
    const h = harness();
    const first = h.send('ok');
    const second = h.send('ok');
    expect(h.ledger.signatureFor(ROOM, 'ok', undefined)).toBe('room@groups.zilar.test|ok|');

    h.echo(stanza({ id: 'stanza-1', originId: 'origin-1', body: 'ok' }));
    h.echo(
      stanza({ id: 'stanza-2', originId: 'origin-2', body: 'ok', timestamp: new Date(6_000) }),
    );
    // The acks come back out of order.
    h.resolve(second, 'origin-2');
    h.resolve(first, 'origin-1');

    expect(h.messages().map((m) => [m.id, m.status])).toEqual([
      ['stanza-1', 'sent'],
      ['stanza-2', 'sent'],
    ]);
    expect(h.ledger.sameMessage(first, 'stanza-1')).toBe(true);
    expect(h.ledger.sameMessage(second, 'stanza-2')).toBe(true);
    expect(h.ledger.sameMessage(first, second)).toBe(false);
    expect(h.ledger.correctionTargetFor(first)).toBe('origin-1');
    expect(h.ledger.correctionTargetFor(second)).toBe('origin-2');

    // A reaction to the second shows on the second bubble only.
    h.receive(
      stanza({
        id: 'reaction-1',
        fromJid: BOB,
        outgoing: false,
        reactions: { targetId: 'stanza-2', emojis: ['🎉'] },
      }),
    );
    expect(h.messages().map((m) => m.reactions?.map((chip) => chip.emoji))).toEqual([
      undefined,
      ['🎉'],
    ]);

    // Deleting the first leaves the second alone.
    h.receive(stanza({ id: 'retract-1', retraction: { targetId: 'origin-1' } }));
    expect(h.messages().map((m) => [m.id, m.deleted === true, m.text])).toEqual([
      ['stanza-1', true, undefined],
      ['stanza-2', false, 'ok'],
    ]);
  });

  it('matches the echo of a reply and keeps its quote following the target', () => {
    const h = harness();
    h.receive(
      stanza({
        id: 'peer-1',
        originId: 'peer-origin-1',
        fromJid: BOB,
        outgoing: false,
        body: 'question?',
        timestamp: new Date(500),
      }),
    );
    const replyTo: ReplyRef = { id: 'peer-1', senderName: 'Bob', text: 'question?' };
    // The echo carries only the target id; the signature ignores the rest of
    // the quote, so a reply and the same text without a reply never match.
    expect(h.ledger.signatureFor(ROOM, 'answer', replyTo)).toBe(
      h.ledger.signatureFor(ROOM, 'answer', { id: 'peer-1', senderName: '' }),
    );
    expect(h.ledger.signatureFor(ROOM, 'answer', replyTo)).not.toBe(
      h.ledger.signatureFor(ROOM, 'answer', undefined),
    );

    const plain = h.send('answer');
    const reply = h.send('answer', replyTo);
    h.echo(
      stanza({ id: 'stanza-r', originId: 'origin-r', body: 'answer', replyTo: { id: 'peer-1' } }),
    );

    expect(h.ledger.sameMessage(reply, 'stanza-r')).toBe(true);
    expect(h.ledger.sameMessage(plain, 'stanza-r')).toBe(false);
    const echoed = h.messages().find((m) => m.id === 'stanza-r');
    expect(echoed?.status).toBe('sent');
    expect(echoed?.replyTo).toEqual({ id: 'peer-1', senderName: 'Bob', text: 'question?' });
    expect(h.messages().find((m) => m.id === plain)?.status).toBe('sending');

    // Bob corrects the quoted message: the quote follows.
    h.receive(
      stanza({
        id: 'fix-1',
        fromJid: BOB,
        outgoing: false,
        body: 'better question?',
        correction: { targetId: 'peer-origin-1' },
      }),
    );
    expect(h.messages().find((m) => m.id === 'stanza-r')?.replyTo?.text).toBe('better question?');

    // Bob deletes it: the quote says so.
    h.receive(
      stanza({
        id: 'retract-1',
        fromJid: BOB,
        outgoing: false,
        retraction: { targetId: 'peer-origin-1' },
      }),
    );
    expect(h.messages().find((m) => m.id === 'stanza-r')?.replyTo?.text).toBe('Deleted message');
  });
});

describe('the message ledger: linkLocalToServer (R5)', () => {
  it('also files the server id under the alias root, so a canonical id resolves it', () => {
    const h = harness();
    // `local-1` is known under another root before its send resolves.
    h.ledger.linkMessageIds('local-root', 'local-1');
    expect(h.ledger.aliasRoot('local-1')).toBe('local-root');
    expect(h.ledger.wireTargetFor('local-root')).toBeUndefined();

    h.ledger.linkLocalToServer('local-1', 'server-1');

    expect(h.ledger.wireTargetFor('local-1')).toBe('server-1');
    expect(h.ledger.wireTargetFor(h.ledger.aliasRoot('local-1'))).toBe('server-1');
  });

  it('never files an id as its own server id', () => {
    const h = harness();
    h.ledger.linkLocalToServer('local-1', 'local-1');
    expect(h.ledger.wireTargetFor('local-1')).toBeUndefined();
  });
});

describe('the message ledger: linkAckToServer', () => {
  const dm: ChatSummary = { id: BOB, kind: 'dm', title: 'Bob', unread: 0 } as ChatSummary;

  it('keeps the stanza id of a group echo that came before the ack', () => {
    const h = harness();
    h.ledger.linkLocalToServer('local-1', 'stanza-1');
    h.ledger.linkAckToServer(room, 'local-1', 'origin-1');
    expect(h.ledger.wireTargetFor('local-1')).toBe('stanza-1');
  });

  it('lets a group echo that comes after the ack replace its id', () => {
    const h = harness();
    h.ledger.linkAckToServer(room, 'local-1', 'origin-1');
    expect(h.ledger.wireTargetFor('local-1')).toBe('origin-1');
    h.ledger.linkLocalToServer('local-1', 'stanza-1');
    expect(h.ledger.wireTargetFor('local-1')).toBe('stanza-1');
  });

  it('links the ack id in a DM whichever came first, as before', () => {
    const h = harness();
    h.ledger.linkLocalToServer('local-1', 'echo-1');
    h.ledger.linkAckToServer(dm, 'local-1', 'origin-1');
    expect(h.ledger.wireTargetFor('local-1')).toBe('origin-1');
  });
});
