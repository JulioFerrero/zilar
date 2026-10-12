import { Context, Effect } from 'effect';
import type { ChatSummary } from '@zilar/chat-core';
import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreActionError, CoreState } from './ctx';
import { handleMessage } from './incoming';
import { createMessageLedger } from './ledger';
import { makeLifetime } from './lifetime';
import { testCorePorts } from './ports';
import {
  SEND_TIMEOUT_MS,
  ackText,
  deleteFailedMessage,
  forwardMessages,
  retrySticker,
  retryText,
  sendAttachment,
  sendSticker,
  sendText,
  sendVoice,
  unackText,
  type SendCtx,
  type SendRun,
} from './send';
import { createTextOutbox, flushOutbox, outboxRebound, OUTBOX_MAX_WAIT_MS } from './send/outbox';
import { flushOnline } from './online';
import type { HistoryCtx } from './history';
import { reconnect, type LifecycleCtx } from './lifecycle';

const NOW = new Date('2026-09-28T12:00:00Z');
const ME = 'me@zilar.test';
const ANA = 'ana@zilar.test';
const TEAM = 'team@rooms.zilar.test';
const PACK = '123e4567-e89b-12d3-a456-426614174000';
const STICKER = '223e4567-e89b-12d3-a456-426614174001';

const dm: ChatSummary = { id: ANA, kind: 'dm', title: 'Ana', unread: 0 } as ChatSummary;
const team: ChatSummary = {
  id: TEAM,
  kind: 'group',
  title: 'Team',
  unread: 0,
  memberCount: 3,
} as ChatSummary;

type TestState = CoreState & { actionError?: CoreActionError | undefined };

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};

interface HarnessOptions {
  core?: Partial<XmppCore>;
  bytes?: { upload?: SendCtx['ports']['bytes']['upload'] };
  voice?: {
    convert?: SendCtx['ports']['voice']['convert'];
    upload?: SendCtx['ports']['voice']['upload'];
  };
}

function harness(options: HarnessOptions = {}) {
  let state: TestState = {
    messagesByChat: {},
    chats: [dm, team],
    edits: {},
    reactions: {},
    contacts: [],
    me: { jid: ME },
    currentUserId: 'u-me',
    activeChatId: undefined,
    typing: {},
    drafts: {},
    finishedDraftMessages: {},
  };
  const set = (update: unknown): void => {
    const patch =
      typeof update === 'function'
        ? (update as (value: TestState) => Partial<TestState>)(state)
        : (update as Partial<TestState>);
    state = { ...state, ...patch };
  };
  const core = {
    sendMessage: vi.fn(async () => ({ id: 'srv-1' })),
    ...options.core,
  } as unknown as XmppCore;
  const rt = makeLifetime(Context.empty());
  const ledger = createMessageLedger({
    get: () => state,
    set,
    memberName: () => undefined,
    occupantNick: () => undefined,
    mediaToken: () => undefined,
  });
  const bytes: SendCtx['ports']['bytes'] = {
    describe: () => ({
      kind: 'file' as const,
      name: 'report.pdf',
      size: 3,
      mime: 'application/pdf',
      localUrl: 'blob:local',
    }),
    measure: () => Effect.succeed(undefined),
    upload:
      options.bytes?.upload ??
      vi.fn(() => Effect.tryPromise(() => Promise.resolve('https://upload.zilar.test/get/1'))),
  };
  const voice: SendCtx['ports']['voice'] = {
    convert:
      options.voice?.convert ??
      vi.fn(() => Effect.tryPromise(() => Promise.resolve({ durationMs: 4321, audio: 'AUDIO' }))),
    upload:
      options.voice?.upload ??
      vi.fn(() =>
        Effect.tryPromise(() => Promise.resolve('https://upload.zilar.test/get/1/voice.m4a')),
      ),
  };
  const ctx: SendCtx = {
    get: () => state,
    set,
    ports: { ...testCorePorts({ now: () => NOW }), bytes, voice },
    rt,
    k: ledger,
    fx: {
      syncBadge: () => {},
      dismissChatNotifications: () => {},
      loadGroupMembers: () => {},
      finishDraftTurn: () => {},
      forgetRetryBytes: () => {},
    },
    core,
    lastRead: {},
    lastReadUserId: 'u-me',
    pendingOutgoing: new Map(),
    sequence: 0,
    sendRuns: new Map<string, SendRun>(),
    pendingAttachments: new Map(),
    pendingVoices: new Map(),
    // Like mobile, the harness sends `undefined` options for a plain text
    // (web pins `{}`); the resend tests pin the option shape.
    omitEmptyTextOptions: true,
    outbox: createTextOutbox(),
  };
  return { ctx, core, bytes, voice, state: () => state, ledger };
}

function echo(body: string, chatJid = ANA, id = 'srv-1'): ChatMessage {
  return {
    id,
    chatJid,
    kind: chatJid.includes('@rooms.') ? 'groupchat' : 'chat',
    fromJid: ME,
    fromResolved: true,
    body,
    timestamp: NOW,
    outgoing: true,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('sendText (core)', () => {
  it('inserts an optimistic bubble and confirms it without duplicating the echo', async () => {
    const { ctx, core, state } = harness();
    sendText(ctx, ANA, 'hello there');

    const optimistic = state().messagesByChat[ANA]?.at(-1);
    expect(optimistic?.text).toBe('hello there');
    expect(optimistic?.status).toBe('sending');

    await flush();
    expect(core.sendMessage).toHaveBeenCalledWith(ANA, 'chat', 'hello there', undefined);
    // The socket write alone does not confirm: the bubble waits for the ack.
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sending');

    ackText(ctx, 'srv-1');
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sent');

    handleMessage(ctx, echo('hello there'));
    const matches = state().messagesByChat[ANA]?.filter((item) => item.text === 'hello there');
    expect(matches).toHaveLength(1);
    expect(matches?.[0]?.id).toBe('srv-1');
  });

  it('leaves a failed text as sending (D-1)', async () => {
    const { ctx, state } = harness({
      core: { sendMessage: vi.fn(async () => Promise.reject(new Error('offline'))) },
    });
    sendText(ctx, ANA, 'stuck');
    await flush();

    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sending');
  });

  it('resends a text that failed offline once on online, with the same id', async () => {
    const sendMessage = vi
      .fn<
        (to: string, kind: string, text: string, opts?: { id?: string }) => Promise<{ id: string }>
      >()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(
        async (_to: string, _kind: string, _text: string, opts?: { id?: string }) => ({
          id: opts?.id ?? 'srv-9',
        }),
      );
    const { ctx, state } = harness({ core: { sendMessage } });
    sendText(ctx, ANA, 'queued');
    await flush();

    const bubble = state().messagesByChat[ANA]?.at(-1);
    expect(bubble?.status).toBe('sending');
    const localId = bubble?.id ?? '';
    expect(sendMessage).toHaveBeenCalledTimes(1);

    // The next transition into `online` flushes the outbox.
    ctx.core = { sendMessage } as unknown as XmppCore;
    flushOutbox(ctx, NOW.getTime());
    await flush();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(ANA, 'chat', 'queued', undefined);
    const resent = state().messagesByChat[ANA]?.filter((item) => item.text === 'queued');
    expect(resent).toHaveLength(1);
    expect(resent?.[0]?.id).toBe(localId);

    ackText(ctx, 'srv-9');
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sent');
  });

  it('a resend after going offline reuses the first send stanza id', async () => {
    // The second send honors the `id` option: the wire id the receiver
    // dedupes on stays the first send's, so no duplicate arrives.
    const sendMessage = vi
      .fn<
        (to: string, kind: string, text: string, opts?: { id?: string }) => Promise<{ id: string }>
      >()
      .mockResolvedValueOnce({ id: 'srv-first' })
      .mockImplementation(async (_to, _kind, _text, opts) => ({ id: opts?.id ?? 'srv-other' }));
    const { ctx, state } = harness({ core: { sendMessage } });
    sendText(ctx, ANA, 'again');
    await flush();
    expect(sendMessage).toHaveBeenCalledTimes(1);

    unackText(ctx, 'srv-first');
    flushOutbox(ctx, NOW.getTime());
    await flush();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(ANA, 'chat', 'again', { id: 'srv-first' });
    expect(state().messagesByChat[ANA]).toHaveLength(1);

    ackText(ctx, 'srv-first');
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sent');
  });

  it('a failed resend keeps the stable stanza id for the next attempt', async () => {
    // The first send's id must survive a failed resend: the next `unacked`
    // retries under the same wire id, so a stanza that did reach the server
    // is deduped by the receiver instead of arriving twice under two ids.
    // (One resend clears `awaitingResend`: without a fresh `unacked` the
    // next flush does not resend — a resume never resends at all, T-1216.)
    const sendMessage = vi
      .fn<
        (to: string, kind: string, text: string, opts?: { id?: string }) => Promise<{ id: string }>
      >()
      .mockResolvedValueOnce({ id: 'srv-first' })
      .mockRejectedValueOnce(new Error('offline again'))
      .mockImplementation(async (_to, _kind, _text, opts) => ({ id: opts?.id ?? 'srv-other' }));
    const { ctx, state } = harness({ core: { sendMessage } });
    sendText(ctx, ANA, 'stable');
    await flush();
    expect(sendMessage).toHaveBeenNthCalledWith(1, ANA, 'chat', 'stable', undefined);

    unackText(ctx, 'srv-first');
    flushOutbox(ctx, NOW.getTime());
    await flush();
    expect(sendMessage).toHaveBeenNthCalledWith(2, ANA, 'chat', 'stable', { id: 'srv-first' });

    // The failed attempt kept the id; a fresh `unacked` still retries it.
    unackText(ctx, 'srv-first');
    flushOutbox(ctx, NOW.getTime());
    await flush();
    expect(sendMessage).toHaveBeenNthCalledWith(3, ANA, 'chat', 'stable', { id: 'srv-first' });
    expect(state().messagesByChat[ANA]).toHaveLength(1);

    ackText(ctx, 'srv-first');
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sent');
  });

  it('a text sent while reconnecting goes out once after the client comes back online', async () => {
    // T-1197: the socket write resolves (xmpp.js queues the stanza) while the
    // core is `reconnecting`; the stream then rebinds fresh (a rebound), so no
    // ack or unack ever comes for the first stanza id. The resume path
    // (`reconnect()`, the AppState-focus path that sets `online` itself
    // without a fresh `status` event) flushes the outbox, resending once
    // under the same id. Driving `reconnect()` — not the flush helper —
    // keeps this test honest: dropping the call from the resume path fails it.
    const sendMessage = vi
      .fn<
        (to: string, kind: string, text: string, opts?: { id?: string }) => Promise<{ id: string }>
      >()
      .mockResolvedValueOnce({ id: 'srv-airplane' })
      .mockImplementation(async (_to, _kind, _text, opts) => ({ id: opts?.id ?? 'srv-other' }));
    const { ctx, state } = harness({ core: { sendMessage } });
    sendText(ctx, ANA, 'offline test');
    await flush();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sending');

    // The network comes back through the resume path: it ends `online`
    // without a fresh `status` event and must still flush the outbox. The
    // reconnecting socket rebinds fresh (`rebound`); the core reports the
    // wake without a new `online` emission.
    const core = ctx.core as unknown as { wake?: () => Promise<unknown> };
    core.wake = async () => 'rebound';
    const resume = {
      ...ctx,
      started: true,
      ports: {
        ...ctx.ports,
        flags: { ...ctx.ports.flags, reconnectOnResume: true },
      },
      fx: {
        ...ctx.fx,
        setStatus: () => {},
        joinGroups: async () => undefined,
      },
    } as unknown as LifecycleCtx;
    await Effect.runPromise(reconnect(resume));
    await flush();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(ANA, 'chat', 'offline test', {
      id: 'srv-airplane',
    });
    const matches = state().messagesByChat[ANA]?.filter((item) => item.text === 'offline test');
    expect(matches).toHaveLength(1);

    ackText(ctx, 'srv-airplane');
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sent');
  });

  it('a resume flush never resends a stanza that went out', async () => {
    // A resume's `h` covers the queued stanza, so the flush must not resend
    // it: the resend would archive a second server row under the same id.
    const sendMessage = vi
      .fn<
        (to: string, kind: string, text: string, opts?: { id?: string }) => Promise<{ id: string }>
      >()
      .mockResolvedValueOnce({ id: 'srv-resume' })
      .mockImplementation(async (_to, _kind, _text, opts) => ({ id: opts?.id ?? 'srv-other' }));
    const { ctx, state } = harness({ core: { sendMessage } });
    sendText(ctx, ANA, 'Offline two');
    await flush();
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sending');

    flushOutbox(ctx, NOW.getTime());
    await flush();
    expect(sendMessage).toHaveBeenCalledTimes(1);

    ackText(ctx, 'srv-resume');
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sent');
  });

  it('a resent text after a rebound gets the tick when the fresh session acks it', async () => {
    // T-1220: the device case. "Offline three" was queued while offline (no
    // stanza id), the stream was replaced, and the flush only ran once the
    // fresh session was online. The fresh client's ack then settles the live
    // bubble — a store change that flushes on `rebound` instead of `online`
    // (or drops the flush) must fail this test.
    const sendMessage = vi
      .fn<
        (to: string, kind: string, text: string, opts?: { id?: string }) => Promise<{ id: string }>
      >()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (_to, _kind, _text, opts) => ({ id: opts?.id ?? 'srv-fresh' }));
    const { ctx, state } = harness({ core: { sendMessage } });
    sendText(ctx, ANA, 'Offline three');
    await flush();
    const bubble = state().messagesByChat[ANA]?.at(-1);
    expect(bubble?.status).toBe('sending');
    const localId = bubble?.id ?? '';

    // A fresh session replaced the stream (no stanza id ever went out, so no
    // `unacked` marks anything): the deferred online runs the flush. Driving
    // `flushOnline` — the path every transition into `online` runs — keeps
    // this honest: dropping the outbox flush from it fails this test.
    outboxRebound(ctx);
    flushOnline(ctx as unknown as HistoryCtx);
    await flush();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(ANA, 'chat', 'Offline three', undefined);
    const matches = state().messagesByChat[ANA]?.filter((item) => item.text === 'Offline three');
    expect(matches).toHaveLength(1);
    expect(matches?.[0]?.id).toBe(localId);

    // The fresh session stream-manages the resend, so its ack lands and the
    // live bubble ticks without a cold restart.
    ackText(ctx, 'srv-fresh');
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sent');
  });

  it('queues a text sent before a core exists and resends it on the next online', async () => {
    // A boot in flight (or a failed token) leaves `ctx.core` undefined; the
    // bubble must still enter the outbox, or it would wait at `sending` for good.
    const { ctx, core, state } = harness();
    ctx.core = undefined;
    sendText(ctx, ANA, 'no core yet');
    await flush();

    expect(core.sendMessage).not.toHaveBeenCalled();
    const bubble = state().messagesByChat[ANA]?.at(-1);
    expect(bubble?.status).toBe('sending');
    const localId = bubble?.id ?? '';

    ctx.core = core;
    flushOutbox(ctx, NOW.getTime());
    await flush();

    expect(core.sendMessage).toHaveBeenCalledTimes(1);
    const matches = state().messagesByChat[ANA]?.filter((item) => item.text === 'no core yet');
    expect(matches).toHaveLength(1);
    expect(matches?.[0]?.id).toBe(localId);
  });

  it('a resent reply keeps its quote text', async () => {
    // T-1197 (T-1194 follow-up 1): the entry stores the reply's quote text,
    // so a resend rebuilds the XEP-0461 fallback like the first send does.
    const sendMessage = vi
      .fn<
        (
          to: string,
          kind: string,
          text: string,
          opts?: { replyTo?: { id: string; text?: string }; id?: string },
        ) => Promise<{ id: string }>
      >()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (_to, _kind, _text, opts) => ({ id: opts?.id ?? 'srv-r' }));
    const { ctx, state } = harness({ core: { sendMessage } });
    sendText(ctx, ANA, 'quoted reply', {
      replyTo: { id: 'm-0', senderName: 'Ana', text: 'the original' },
    });
    await flush();

    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sending');
    flushOutbox(ctx, NOW.getTime());
    await flush();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(ANA, 'chat', 'quoted reply', {
      replyTo: { id: 'm-0', text: 'the original' },
    });
  });

  it('an entry nobody flushes becomes failed after the wait cap, using the test clock', async () => {
    // T-1197: the wait cap runs on the store's runtime fork, so even with no
    // flush the bubble shows "Not sent" once OUTBOX_MAX_WAIT_MS has passed.
    vi.useFakeTimers();
    try {
      const { ctx, state } = harness({
        core: { sendMessage: vi.fn(async () => Promise.reject(new Error('offline'))) },
      });
      sendText(ctx, ANA, 'stuck');
      await flush();
      expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sending');

      await vi.advanceTimersByTimeAsync(OUTBOX_MAX_WAIT_MS + 10);
      const bubble = state().messagesByChat[ANA]?.at(-1);
      expect(bubble?.status).toBe('failed');
      expect(bubble?.failed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a context built like the production stores marks sent only after acked', async () => {
    // The mobile and web stores both create the send context with an outbox
    // now: the honest tick below is the production path, not a harness-only
    // branch.
    const sendMessage = vi.fn(async () => ({ id: 'srv-prod' }));
    const { ctx, state } = harness({ core: { sendMessage } });
    sendText(ctx, ANA, 'prod tick');
    await flush();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sending');

    ackText(ctx, 'srv-prod');
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sent');
  });

  it('marks the bubble failed after the outbox attempts run out', async () => {
    const { ctx, state } = harness({
      core: { sendMessage: vi.fn(async () => Promise.reject(new Error('offline'))) },
    });
    sendText(ctx, ANA, 'doomed');
    await flush();
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sending');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      flushOutbox(ctx, NOW.getTime());
      await flush();
    }
    const bubble = state().messagesByChat[ANA]?.at(-1);
    expect(bubble?.status).toBe('failed');
    expect(bubble?.failed).toBe(true);
  });

  it('retryText resends a failed text with the same id', async () => {
    const { ctx, state } = harness({
      core: { sendMessage: vi.fn(async () => Promise.reject(new Error('offline'))) },
    });
    sendText(ctx, ANA, 'doomed');
    await flush();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      flushOutbox(ctx, NOW.getTime());
      await flush();
    }
    const failed = state().messagesByChat[ANA]?.at(-1);
    expect(failed?.status).toBe('failed');
    const localId = failed?.id ?? '';

    // The network is back: the retry flips the bubble to `sending` and sends
    // the stored body again under the same message id.
    const sendMessage = vi.fn(async () => ({ id: 'srv-retry' }));
    ctx.core = { sendMessage } as unknown as XmppCore;
    retryText(ctx, ANA, localId);
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sending');
    expect(state().messagesByChat[ANA]?.at(-1)?.id).toBe(localId);
    await flush();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(ANA, 'chat', 'doomed', { id: localId });
  });

  it('retryText tracks the retried text in the outbox until its ack', async () => {
    const { ctx, state } = harness({
      core: { sendMessage: vi.fn(async () => Promise.reject(new Error('offline'))) },
    });
    sendText(ctx, ANA, 'doomed');
    await flush();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      flushOutbox(ctx, NOW.getTime());
      await flush();
    }
    const localId = state().messagesByChat[ANA]?.at(-1)?.id ?? '';
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('failed');

    // The network is back: the retry queues the text in the outbox under
    // its stanza id, like a first send does — otherwise the bubble would
    // sit at `sending` with no resend and no honest tick.
    const sendMessage = vi.fn(async () => ({ id: 'srv-retry' }));
    ctx.core = { sendMessage } as unknown as XmppCore;
    retryText(ctx, ANA, localId);
    await flush();

    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sending');
    expect(ctx.outbox?.get(localId)?.stanzaId).toBe('srv-retry');

    ackText(ctx, 'srv-retry');
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sent');
  });

  it('requeues a bubble stream management lost, for the next online', async () => {
    const { ctx, core, state } = harness();
    sendText(ctx, ANA, 'lost');
    await flush();
    expect(core.sendMessage).toHaveBeenCalledTimes(1);

    unackText(ctx, 'srv-1');
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sending');

    flushOutbox(ctx, NOW.getTime());
    await flush();
    expect(core.sendMessage).toHaveBeenCalledTimes(2);

    ackText(ctx, 'srv-1');
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sent');
  });

  it('an echo of the queued stanza settles the bubble within one flush', async () => {
    // The echo path settles the bubble too (incoming.ts:48-54 marks `sent`
    // on echo): when the ack itself was lost but the stanza reached the
    // server, the echo still confirms delivery.
    const sendMessage = vi
      .fn<
        (to: string, kind: string, text: string, opts?: { id?: string }) => Promise<{ id: string }>
      >()
      .mockResolvedValueOnce({ id: 'srv-offline-two' })
      .mockImplementation(async (_to, _kind, _text, opts) => ({ id: opts?.id ?? 'srv-other' }));
    const { ctx, state } = harness({ core: { sendMessage } });
    sendText(ctx, ANA, 'Offline two');
    await flush();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sending');

    handleMessage(ctx, echo('Offline two', ANA, 'srv-offline-two'));
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sent');

    flushOutbox(ctx, NOW.getTime());
    await flush();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('a stale ack for an echo-settled bubble stays a no-op', async () => {
    // The echo already marked the bubble `sent`; a late duplicate ack must
    // not revive or move anything.
    const sendMessage = vi
      .fn<
        (to: string, kind: string, text: string, opts?: { id?: string }) => Promise<{ id: string }>
      >()
      .mockResolvedValueOnce({ id: 'srv-echo-first' })
      .mockImplementation(async (_to, _kind, _text, opts) => ({ id: opts?.id ?? 'srv-other' }));
    const { ctx, state } = harness({ core: { sendMessage } });
    sendText(ctx, ANA, 'echo first');
    await flush();

    handleMessage(ctx, echo('echo first', ANA, 'srv-echo-first'));
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sent');

    ackText(ctx, 'srv-echo-first');
    const matches = state().messagesByChat[ANA]?.filter((item) => item.text === 'echo first');
    expect(matches).toHaveLength(1);
    expect(matches?.[0]?.status).toBe('sent');
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('a lost stanza for an echo-settled bubble neither reverts nor resends', async () => {
    // T-1216: the echo marked the bubble `sent` but its outbox entry is still
    // there. A later `unacked` (a replaced client's stream-management queue)
    // must not flip the settled bubble back to `sending` — that would resend
    // a stanza the server already has and archive a second row.
    const sendMessage = vi
      .fn<
        (to: string, kind: string, text: string, opts?: { id?: string }) => Promise<{ id: string }>
      >()
      .mockResolvedValueOnce({ id: 'srv-echo-unacked' })
      .mockImplementation(async (_to, _kind, _text, opts) => ({ id: opts?.id ?? 'srv-other' }));
    const { ctx, state } = harness({ core: { sendMessage } });
    sendText(ctx, ANA, 'delivered once');
    await flush();
    expect(sendMessage).toHaveBeenCalledTimes(1);

    handleMessage(ctx, echo('delivered once', ANA, 'srv-echo-unacked'));
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sent');

    unackText(ctx, 'srv-echo-unacked');
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sent');

    flushOutbox(ctx, NOW.getTime());
    await flush();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const matches = state().messagesByChat[ANA]?.filter((item) => item.text === 'delivered once');
    expect(matches).toHaveLength(1);
    expect(matches?.[0]?.status).toBe('sent');
  });
});

describe('sendSticker (core)', () => {
  const sticker = {
    stickerId: STICKER,
    packId: PACK,
    url: 'https://cdn.zilar.test/cat.webp',
    emoji: '🐱',
    width: 128,
    height: 128,
    mime: 'image/webp' as const,
  };

  it('sends the sticker payload and marks a failed send failed', async () => {
    const ok = harness();
    sendSticker(ok.ctx, ANA, sticker);
    await flush();
    expect(ok.core.sendMessage).toHaveBeenCalledWith(ANA, 'chat', '🐱', {
      payload: {
        v: 0,
        type: 'sticker',
        data: {
          pack_id: PACK,
          sticker_id: STICKER,
          url: 'https://cdn.zilar.test/cat.webp',
          emoji: '🐱',
          width: 128,
          height: 128,
          mime: 'image/webp',
        },
      },
    });
    expect(ok.state().messagesByChat[ANA]?.at(-1)?.status).toBe('sent');

    const bad = harness({
      core: { sendMessage: vi.fn(async () => Promise.reject(new Error('offline'))) },
    });
    sendSticker(bad.ctx, ANA, sticker);
    await flush();
    expect(bad.state().messagesByChat[ANA]?.at(-1)?.failed).toBe(true);
  });

  it('does not re-enqueue the signature on a retry, so a later echo links once (R18)', async () => {
    const { ctx, state } = harness({
      core: { sendMessage: vi.fn(async () => Promise.reject(new Error('offline'))) },
    });
    sendSticker(ctx, ANA, sticker);
    await flush();
    const failed = state().messagesByChat[ANA]?.at(-1);
    expect(failed?.failed).toBe(true);

    const signature = ctx.k.stickerSignatureFor(ANA, '🐱', STICKER, undefined);
    expect(ctx.pendingOutgoing.get(signature)).toHaveLength(1);

    retrySticker(ctx, ANA, failed?.id ?? '');
    await flush();
    // The failed first send was never echoed, so its queued id is still the
    // only one: no stale second entry.
    expect(ctx.pendingOutgoing.get(signature)).toHaveLength(1);
  });
});

describe('sendAttachment (core)', () => {
  it('uploads the bytes and swaps the optimistic attachment for the served url', async () => {
    const { ctx, bytes, state, core } = harness();
    const file = { name: 'report.pdf', size: 3, type: 'application/pdf' };
    sendAttachment(ctx, ANA, file, { caption: 'the report' });

    const optimistic = state().messagesByChat[ANA]?.at(-1);
    expect(optimistic?.attachment?.url).toBe('blob:local');
    expect(optimistic?.text).toBe('the report');

    await flush();
    expect(bytes.upload).toHaveBeenCalledTimes(1);
    expect(state().messagesByChat[ANA]?.at(-1)?.attachment?.url).toBe(
      'https://upload.zilar.test/get/1',
    );
    expect(core.sendMessage).toHaveBeenCalledWith(ANA, 'chat', 'the report', {
      payload: {
        v: 0,
        type: 'attachment',
        data: {
          kind: 'file',
          url: 'https://upload.zilar.test/get/1',
          name: 'report.pdf',
          size: 3,
          mime: 'application/pdf',
        },
      },
    });
    expect(state().messagesByChat[ANA]?.at(-1)?.status).toBe('sent');
  });

  it('carries an album option into sendMessage and the optimistic bubble', async () => {
    const { ctx, core, state } = harness();
    const album = { id: 'album-1', index: 1, count: 3 };
    sendAttachment(
      ctx,
      ANA,
      { name: 'trip.jpg', size: 3, type: 'image/jpeg' },
      { caption: 'trip', album },
    );

    const optimistic = state().messagesByChat[ANA]?.at(-1);
    expect(optimistic?.album).toEqual(album);
    expect(optimistic?.text).toBe('trip');

    await flush();
    expect(core.sendMessage).toHaveBeenCalledWith(
      ANA,
      'chat',
      'trip',
      expect.objectContaining({ album }),
    );
  });

  it('marks a failed upload failed with its reason', async () => {
    const { ctx, state } = harness({
      bytes: {
        upload: vi.fn(() => Effect.fail({ code: 'upload_refused' })),
      },
    });
    sendAttachment(ctx, ANA, { name: 'x', size: 1, type: '' });
    await flush();

    const bubble = state().messagesByChat[ANA]?.at(-1);
    expect(bubble?.status).toBe('failed');
    expect(bubble?.failed).toBe(true);
    expect(bubble?.failureReason).toBe('upload_refused');
  });

  it('marks a hung upload timed_out after the deadline (R6)', async () => {
    vi.useFakeTimers();
    const { ctx, state } = harness({
      bytes: { upload: vi.fn(() => Effect.never) },
    });
    sendAttachment(ctx, ANA, { name: 'x', size: 1, type: '' });
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 10);

    const bubble = state().messagesByChat[ANA]?.at(-1);
    expect(bubble?.status).toBe('failed');
    expect(bubble?.failureReason).toBe('timed_out');
  });
});

describe('sendVoice (core)', () => {
  it('converts, uploads and sends the voice payload', async () => {
    const { ctx, voice, state } = harness();
    sendVoice(ctx, ANA, {
      bytes: 'BLOB',
      durationMs: 9999,
      waveform: [1, 2, 3],
      localUrl: 'blob:audio',
    });

    const optimistic = state().messagesByChat[ANA]?.at(-1);
    expect(optimistic?.voice?.duration_ms).toBe(9999);
    expect(optimistic?.voice?.url).toBe('blob:audio');

    await flush();
    expect(voice.convert).toHaveBeenCalledTimes(1);
    expect(voice.upload).toHaveBeenCalledTimes(1);
    const sent = state().messagesByChat[ANA]?.at(-1);
    expect(sent?.voice?.duration_ms).toBe(4321);
    expect(sent?.voice?.url).toBe('https://upload.zilar.test/get/1/voice.m4a');
    expect(sent?.status).toBe('sent');
  });
});

describe('forwardMessages (core)', () => {
  it('copies a sent message into the target with its origin', async () => {
    const { ctx, core, state, ledger } = harness();
    const source = {
      id: 'srv-9',
      chatId: ANA,
      senderId: 'u-ana',
      senderName: 'Ana',
      text: 'forward me',
      createdAt: NOW,
      status: 'sent' as const,
    };
    ledger.rememberAuthor('srv-9', { jid: 'ana@zilar.test', resolved: true });
    forwardMessages(ctx, [TEAM], [source]);
    await flush();

    const copy = state().messagesByChat[TEAM]?.at(-1);
    expect(copy?.text).toBe('forward me');
    expect(copy?.forward?.sender_name).toBe('Ana');
    expect(core.sendMessage).toHaveBeenCalledWith(TEAM, 'groupchat', 'forward me', {
      forward: expect.objectContaining({ sender_name: 'Ana' }),
    });
  });

  it('regroups a whole forwarded album under one fresh id (T-1273)', async () => {
    const { ctx, core, state, ledger } = harness();
    const sources = [0, 1, 2].map((index) => ({
      id: `srv-album-${index}`,
      chatId: ANA,
      senderId: 'u-ana',
      senderName: 'Ana',
      text: `photo ${index}`,
      createdAt: NOW,
      status: 'sent' as const,
      album: { id: 'src-album', index, count: 3 },
    }));
    for (const message of sources) {
      ledger.rememberAuthor(message.id, { jid: 'ana@zilar.test', resolved: true });
    }

    forwardMessages(ctx, [TEAM], sources);
    await flush();

    const copies = (state().messagesByChat[TEAM] ?? []).filter((item) => item.album !== undefined);
    expect(copies).toHaveLength(3);
    const freshId = copies[0]?.album?.id;
    expect(freshId).toBeTypeOf('string');
    expect(freshId).not.toBe('src-album');
    expect(copies.map((copy) => [copy.album?.id, copy.album?.index, copy.album?.count])).toEqual([
      [freshId, 0, 3],
      [freshId, 1, 3],
      [freshId, 2, 3],
    ]);
    expect(core.sendMessage).toHaveBeenCalledTimes(3);
    expect(core.sendMessage).toHaveBeenNthCalledWith(
      2,
      TEAM,
      'groupchat',
      'photo 1',
      expect.objectContaining({ album: { id: freshId, index: 1, count: 3 } }),
    );
  });
});

describe('deleteFailedMessage (core)', () => {
  it('removes a failed bubble', async () => {
    const { ctx, state } = harness({
      bytes: { upload: vi.fn(() => Effect.fail({ code: 'network_error' })) },
    });
    sendAttachment(ctx, ANA, { name: 'x', size: 1, type: '' });
    await flush();
    const failed = state().messagesByChat[ANA]?.at(-1);
    expect(failed?.status).toBe('failed');

    deleteFailedMessage(ctx, ANA, failed?.id ?? '');
    expect(state().messagesByChat[ANA]?.some((item) => item.id === failed?.id)).toBe(false);
  });
});

describe('R20 (core)', () => {
  it('clears a stale error banner on the next send', () => {
    const { ctx, state } = harness();
    ctx.set({ actionError: { chatId: ANA, message: 'That file is empty.' } });
    expect(state().actionError).toEqual({ chatId: ANA, message: 'That file is empty.' });

    sendSticker(ctx, ANA, {
      stickerId: STICKER,
      packId: PACK,
      url: 'https://cdn.zilar.test/cat.webp',
      width: 128,
      height: 128,
      mime: 'image/webp',
    });
    expect(state().actionError).toBeUndefined();
  });
});
