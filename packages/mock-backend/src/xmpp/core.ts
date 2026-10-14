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

/** T-1406: the two fixed statuses the AI's chat state carries before its reply. */
const MOCK_AI_STATUSES = ['Searching the web', 'Running a command'] as const;

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
  // timers are tracked so a disconnect cancels a reply that has not fired yet.
  const emitLater = (ms: number, run: () => void): void => {
    const timer = setTimeout(() => {
      pendingReplies.delete(timer);
      run();
    }, ms);
    pendingReplies.add(timer);
  };

  // T-1406: the AI's chat state carries two short statuses before its reply, so
  // `?mock=1` shows "<status>…" next to the dots and then the answer. Only an
  // AI replier emits them; a human's reply stays a plain reply.
  const isAiMember = (jid: string): boolean =>
    data.people.find((person) => person.jid === jid)?.kind === 'ai';

  const scheduleReply = (roomJid: string, kind: ChatKind): void => {
    const delayMs = options.replyDelayMs ?? DEFAULT_REPLY_DELAY_MS;
    if (delayMs <= 0) {
      return;
    }
    const turn = replyTurn;
    const member = nextReplyMember(data, roomJid, turn);
    if (member === undefined) {
      return;
    }
    replyTurn += 1;
    if (isAiMember(member.jid)) {
      MOCK_AI_STATUSES.forEach((status, index) => {
        emitLater(Math.round((delayMs * (index + 1)) / (MOCK_AI_STATUSES.length + 1)), () => {
          fake.emit('typing', {
            chatJid: roomJid,
            fromJid: member.jid,
            state: 'composing',
            status,
            outgoing: false,
          });
        });
      });
    }
    emitLater(delayMs, () => {
      const text = ROOM_REPLY_TEXT[turn % ROOM_REPLY_TEXT.length] ?? ROOM_REPLY_TEXT[0];
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
    });
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
          ...(opts?.album === undefined ? {} : { album: opts.album }),
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
        // The PUT needs no server: a `data:` URL accepts the bytes. The
        // download URL is what the message carries and what the client's
        // media-trust check reads, so it must sit on the host the session
        // trusts (`upload.<domain>`); a `data:` getUrl would make the echoed
        // attachment render as a file card instead of an image tile (T-1268).
        const putUrl = `data:${request.contentType};base64,`;
        const getUrl = `https://upload.${options.domain}/${encodeURIComponent(request.filename)}`;
        return { putUrl, getUrl, headers: {} };
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
