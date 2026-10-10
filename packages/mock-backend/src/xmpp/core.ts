// effect-plain: in-memory fake XMPP core; its awaited sends and room-reply
// timer are fake-backend timing, not app I/O, so no Effect is used here.

// The fake XMPP core (mock plan section 2.4, task F2). It is built on
// `createFakeXmppCore` (so its `on` hub, `calls` and `failures` survive) and
// overrides every stubbed method to behave as the real `XmppCore` does against
// the seed in `MockData`: connect and rooms, history with RSM, sends that echo
// and get a room reply, reactions, corrections, retractions, typing and read
// markers, and an upload slot that needs no server.
import type {
  ChatKind,
  ChatMessage,
  ConnectionStatus,
  HistoryPage,
  SendCorrectionOptions,
  SendMessageOptions,
  UploadRequest,
  UploadSlot,
  XmppCoreOptions,
} from '@zilar/xmpp-core';
import {
  createFakeXmppCore,
  type FakeCoreMethod,
  type FakeXmppCore,
} from '@zilar/xmpp-core/testing';
import type { MockData } from '../state';
import { historyPage } from './history';
import { nextReplyMember, occupantList } from './rooms';

/** How long a seeded room member waits before answering a send, in ms. */
export const DEFAULT_REPLY_DELAY_MS = 1500;

const ROOM_REPLY_TEXT = ['Sounds good.', 'On it.', 'Thanks for the update.', 'Got it.'] as const;

export interface MockXmppCoreOptions extends XmppCoreOptions {
  /**
   * Milliseconds before a seeded member answers a room send. Defaults to
   * `DEFAULT_REPLY_DELAY_MS` (1500); 0 disables the reply.
   */
  replyDelayMs?: number;
}

export function createMockXmppCore(data: MockData, options: MockXmppCoreOptions): FakeXmppCore {
  const fake = createFakeXmppCore();
  const calls = fake.calls;
  const failures = fake.failures;

  let status: ConnectionStatus = 'offline';
  let myJid: string | undefined;
  let sequence = 0;
  let replyTurn = 0;
  const nickByRoom = new Map<string, string>();
  const pendingReplies = new Set<ReturnType<typeof setTimeout>>();

  const nextId = (prefix: string): string => {
    sequence += 1;
    return `${prefix}-${sequence}`;
  };

  // Record the call and honour an injected failure, exactly like the fake base.
  const start = (method: FakeCoreMethod, args: unknown[]): void => {
    calls.push({ method, args });
    const failure = failures[method];
    if (failure !== undefined) {
      throw failure;
    }
  };

  const startAsync = async <R>(
    method: FakeCoreMethod,
    args: unknown[],
    run: () => R,
  ): Promise<R> => {
    start(method, args);
    return run();
  };

  const clearPendingReplies = (): void => {
    for (const timer of pendingReplies) {
      clearTimeout(timer);
    }
    pendingReplies.clear();
  };

  // A room send gets a short reply from a seeded member, unless disabled. The
  // timer is tracked so a disconnect cancels a reply that has not fired yet.
  const scheduleReply = (roomJid: string, kind: ChatKind): void => {
    const delayMs = options.replyDelayMs ?? DEFAULT_REPLY_DELAY_MS;
    if (delayMs <= 0) {
      return;
    }
    const timer = setTimeout(() => {
      pendingReplies.delete(timer);
      const member = nextReplyMember(data, roomJid, replyTurn);
      if (member === undefined) {
        return;
      }
      const text = ROOM_REPLY_TEXT[replyTurn % ROOM_REPLY_TEXT.length] ?? ROOM_REPLY_TEXT[0];
      replyTurn += 1;
      const reply: ChatMessage = {
        id: nextId('mock-reply'),
        chatJid: roomJid,
        kind,
        fromJid: member.jid,
        fromResolved: true,
        fromNick: member.nick,
        body: text,
        timestamp: new Date(),
        outgoing: false,
      };
      data.appendMessage(roomJid, reply);
      fake.emit('message', reply);
    }, delayMs);
    pendingReplies.add(timer);
  };

  const core: FakeXmppCore = {
    ...fake,
    status: () => status,
    me: () => myJid,
    connect: () =>
      startAsync('connect', [], () => {
        status = 'online';
        myJid = data.me.jid;
        fake.emit('status', 'online');
      }),
    disconnect: () =>
      startAsync('disconnect', [], () => {
        status = 'offline';
        myJid = undefined;
        clearPendingReplies();
        fake.emit('status', 'offline');
      }),
    joinRoom: (roomJid, nick) =>
      startAsync('joinRoom', [roomJid, nick], () => {
        nickByRoom.set(roomJid, nick);
        fake.emit('occupants', { roomJid, occupants: occupantList(data, roomJid, nick) });
      }),
    leaveRoom: (roomJid) =>
      startAsync('leaveRoom', [roomJid], () => {
        nickByRoom.delete(roomJid);
        fake.emit('occupants', { roomJid, occupants: [] });
      }),
    occupants: (roomJid) => {
      const nick = nickByRoom.get(roomJid);
      return nick === undefined ? [] : occupantList(data, roomJid, nick);
    },
    sendMessage: (to, kind, text, opts?: SendMessageOptions) =>
      startAsync('sendMessage', [to, kind, text, opts], () => {
        const id = nextId('mock-msg');
        const message: ChatMessage = {
          id,
          originId: id,
          chatJid: to,
          kind,
          fromJid: data.me.jid,
          fromResolved: true,
          timestamp: new Date(),
          outgoing: true,
          ...(text.length === 0 ? {} : { body: text }),
          ...(opts?.payload === undefined ? {} : { payload: opts.payload }),
          ...(opts?.forward === undefined ? {} : { forward: opts.forward }),
          ...(opts?.replyTo === undefined ? {} : { replyTo: opts.replyTo }),
          ...(opts?.mentions === undefined ? {} : { mentions: opts.mentions }),
        };
        data.appendMessage(to, message);
        fake.emit('message', message);
        if (kind === 'groupchat') {
          scheduleReply(to, kind);
        }
        return { id };
      }),
    sendReactions: (chatJid, kind, targetId, emojis) =>
      startAsync('sendReactions', [chatJid, kind, targetId, emojis], () => {
        const message: ChatMessage = {
          id: nextId('mock-reaction'),
          chatJid,
          kind,
          fromJid: data.me.jid,
          fromResolved: true,
          reactions: { targetId, emojis },
          timestamp: new Date(),
          outgoing: true,
        };
        data.appendMessage(chatJid, message);
        fake.emit('message', message);
      }),
    sendCorrection: (chatJid, kind, originalId, text, opts?: SendCorrectionOptions) =>
      startAsync('sendCorrection', [chatJid, kind, originalId, text, opts], () => {
        const id = nextId('mock-edit');
        const message: ChatMessage = {
          id,
          originId: id,
          chatJid,
          kind,
          fromJid: data.me.jid,
          fromResolved: true,
          body: text,
          correction: { targetId: originalId },
          timestamp: new Date(),
          outgoing: true,
          ...(opts?.mentions === undefined ? {} : { mentions: opts.mentions }),
        };
        data.appendMessage(chatJid, message);
        fake.emit('message', message);
        return { id };
      }),
    sendRetraction: (chatJid, kind, targetId) =>
      startAsync('sendRetraction', [chatJid, kind, targetId], () => {
        const message: ChatMessage = {
          id: nextId('mock-retract'),
          chatJid,
          kind,
          fromJid: data.me.jid,
          fromResolved: true,
          retraction: { targetId },
          timestamp: new Date(),
          outgoing: true,
        };
        data.appendMessage(chatJid, message);
        fake.emit('message', message);
      }),
    loadHistory: (chatJid, _kind, opts) =>
      startAsync('loadHistory', [chatJid, opts], (): HistoryPage =>
        historyPage(data.messages[chatJid] ?? [], opts),
      ),
    requestUploadSlot: (request: UploadRequest) =>
      startAsync('requestUploadSlot', [request], (): UploadSlot => {
        const url = `data:${request.contentType};base64,`;
        return { putUrl: url, getUrl: url, headers: {} };
      }),
    sendTyping: (to, _kind, state) => {
      start('sendTyping', [to, state]);
      fake.emit('typing', { chatJid: to, fromJid: data.me.jid, state, outgoing: true });
    },
    markDisplayed: (chatJid, _kind, messageId) => {
      start('markDisplayed', [chatJid, messageId]);
      fake.emit('displayed', {
        chatJid,
        fromJid: data.me.jid,
        messageId,
        outgoing: true,
      });
    },
  };
  return core;
}
