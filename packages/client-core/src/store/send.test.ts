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
  deleteFailedMessage,
  forwardMessages,
  retrySticker,
  sendAttachment,
  sendSticker,
  sendText,
  sendVoice,
  type SendCtx,
  type SendRun,
} from './send';

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
    expect(core.sendMessage).toHaveBeenCalledWith(ANA, 'chat', 'hello there', {});
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
