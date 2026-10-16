// T-1714: a routine posts one message and every later run edits it. The
// wrapper remembers the routine's message id across the sends of one run and
// edits it while it is under 24 h old; a stopped session sends nothing.
import type { XmppCore } from '@zilar/xmpp-core';
import { describe, expect, it, vi } from 'vitest';
import type { ServerDatabase } from '../../db/client';
import type { RoutineRow } from '../../db/rows';
import type { AiSession, GatewayLogger } from './contracts';
import { createRoutineSend, ROUTINE_MESSAGE_MAX_AGE_MS, type RoutineSend } from './routine-send';

const silentLogger: GatewayLogger = { info: () => {}, warn: () => {} };

const NOW = new Date('2026-10-16T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

const routinePayloadValue = {
  v: 0,
  type: 'routine',
  data: { id: 'routine-1', title: 'Morning standup', schedule: 'every 5 minutes' },
} as const;

function routineRow(overrides: Partial<RoutineRow> = {}): RoutineRow {
  return {
    id: 'routine-1',
    aiId: 'ai-1',
    groupId: null,
    topicId: null,
    kind: 'prompt',
    toolId: null,
    prompt: 'Do the thing',
    title: 'Morning standup',
    schedule: { kind: 'interval', everyMinutes: 5 },
    input: null,
    approvedHosts: [],
    status: 'active',
    pausedReason: null,
    nextRunAt: NOW,
    lastRunAt: null,
    lastStatus: null,
    lastMessageId: null,
    lastMessageAt: null,
    consecutiveFailures: 0,
    createdBy: 'owner-1',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function sessionFor(core: XmppCore): AiSession {
  return {
    aiId: 'ai-1',
    aiJid: 'ai1@example.test',
    core,
    busy: false,
    pending: [],
    stopped: false,
    retryAttempt: 0,
    retryTimer: undefined,
    unsubs: [],
    turnAborts: new Map(),
    rooms: new Map(),
    roomPending: new Map(),
    roomBusy: new Set(),
    roomTurns: new Map(),
    roomRateNotices: new Map(),
    roomSentIds: new Map(),
  };
}

function makeCore() {
  const sendMessage = vi.fn(async () => ({ id: 'sent-1' }));
  const sendCorrection = vi.fn(async () => ({ id: 'sent-1' }));
  return {
    core: { sendMessage, sendCorrection } as unknown as XmppCore,
    sendMessage,
    sendCorrection,
  };
}

function harness(
  options: {
    live?: boolean;
    stored?: { messageId: string; at: Date } | null;
    routine?: RoutineRow | null;
  } = {},
) {
  const core = makeCore();
  const session = sessionFor(core.core);
  const loadMessage = vi.fn(async () => options.stored ?? null);
  const recordMessage = vi.fn(async () => undefined);
  const loadRoutine = vi.fn(async () => ('routine' in options ? options.routine : routineRow()));
  const send: RoutineSend['send'] = createRoutineSend({
    db: {} as ServerDatabase,
    session,
    routineId: 'routine-1',
    isLive: () => options.live ?? true,
    now: () => NOW,
    logger: silentLogger,
    loadMessage,
    recordMessage,
    loadRoutine,
  }).send;
  return { send, core, loadMessage, recordMessage, loadRoutine };
}

describe('a routine sends one message and edits it (T-1714)', () => {
  it('posts a new message and records its id when the routine has none', async () => {
    const h = harness({ stored: null });

    const sent = await h.send('room@example.test', 'groupchat', 'hello');

    expect(sent).toEqual({ id: 'sent-1' });
    expect(h.core.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.core.sendCorrection).not.toHaveBeenCalled();
    expect(h.recordMessage).toHaveBeenCalledWith(expect.anything(), 'routine-1', 'sent-1', NOW);
  });

  it('corrects a stored id younger than 24 h and posts nothing new', async () => {
    const h = harness({ stored: { messageId: 'stored-1', at: new Date(NOW.getTime() - HOUR_MS) } });

    const sent = await h.send('room@example.test', 'groupchat', 'edited');

    expect(sent).toEqual({ id: 'stored-1' });
    expect(h.core.sendMessage).not.toHaveBeenCalled();
    expect(h.core.sendCorrection).toHaveBeenCalledWith(
      'room@example.test',
      'groupchat',
      'stored-1',
      'edited',
      { payload: routinePayloadValue },
    );
    expect(h.recordMessage).toHaveBeenCalledWith(expect.anything(), 'routine-1', 'stored-1', NOW);
  });

  it('posts a new message when the stored id is older than 24 h', async () => {
    const h = harness({
      stored: {
        messageId: 'stale-1',
        at: new Date(NOW.getTime() - ROUTINE_MESSAGE_MAX_AGE_MS - HOUR_MS),
      },
    });

    const sent = await h.send('room@example.test', 'groupchat', 'fresh');

    expect(sent).toEqual({ id: 'sent-1' });
    expect(h.core.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.core.sendCorrection).not.toHaveBeenCalled();
  });

  it('corrects the first message of the run on the second send', async () => {
    const h = harness({ stored: null });

    await h.send('room@example.test', 'groupchat', 'first');
    const second = await h.send('room@example.test', 'groupchat', 'second');

    expect(second).toEqual({ id: 'sent-1' });
    expect(h.core.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.core.sendCorrection).toHaveBeenCalledTimes(1);
    expect(h.core.sendCorrection).toHaveBeenCalledWith(
      'room@example.test',
      'groupchat',
      'sent-1',
      'second',
      { payload: routinePayloadValue },
    );
  });

  it('sends nothing when the session is not live', async () => {
    const h = harness({ live: false, stored: { messageId: 'stored-1', at: NOW } });

    const sent = await h.send('room@example.test', 'groupchat', 'hello');

    expect(sent).toEqual({ id: '' });
    expect(h.core.sendMessage).not.toHaveBeenCalled();
    expect(h.core.sendCorrection).not.toHaveBeenCalled();
    expect(h.loadMessage).not.toHaveBeenCalled();
    expect(h.recordMessage).not.toHaveBeenCalled();
  });

  it('still sends when the stored id cannot be read', async () => {
    const core = makeCore();
    const send = createRoutineSend({
      db: {} as ServerDatabase,
      session: sessionFor(core.core),
      routineId: 'routine-1',
      isLive: () => true,
      now: () => NOW,
      logger: silentLogger,
      loadMessage: vi.fn(async () => {
        throw new Error('db down');
      }),
      recordMessage: vi.fn(async () => undefined),
      loadRoutine: vi.fn(async () => routineRow()),
    }).send;

    const sent = await send('room@example.test', 'groupchat', 'hello');

    expect(sent).toEqual({ id: 'sent-1' });
    expect(core.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('carries the routine payload on both the send and the edit (T-1721)', async () => {
    const h = harness({ stored: null });

    const first = await h.send('room@example.test', 'groupchat', 'first');
    const second = await h.send('room@example.test', 'groupchat', 'second');

    expect(h.core.sendMessage).toHaveBeenCalledWith('room@example.test', 'groupchat', 'first', {
      payload: routinePayloadValue,
    });
    expect(h.core.sendCorrection).toHaveBeenCalledWith(
      'room@example.test',
      'groupchat',
      first.id,
      'second',
      { payload: routinePayloadValue },
    );
    expect(second).toEqual({ id: first.id });
  });

  it('truncates a title longer than 80 characters', async () => {
    const h = harness({ routine: routineRow({ title: 'x'.repeat(120) }) });

    await h.send('room@example.test', 'groupchat', 'hello');

    expect(h.core.sendMessage).toHaveBeenCalledWith('room@example.test', 'groupchat', 'hello', {
      payload: {
        v: 0,
        type: 'routine',
        data: { id: 'routine-1', title: 'x'.repeat(80), schedule: 'every 5 minutes' },
      },
    });
  });

  it('sends without a payload when the routine cannot be loaded or parsed', async () => {
    const missing = harness({ stored: null, routine: null });
    await missing.send('room@example.test', 'groupchat', 'hello');
    expect(missing.core.sendMessage).toHaveBeenCalledWith(
      'room@example.test',
      'groupchat',
      'hello',
      undefined,
    );

    const badSchedule = harness({ routine: routineRow({ schedule: { kind: 'nope' } }) });
    await badSchedule.send('room@example.test', 'groupchat', 'hello');
    expect(badSchedule.core.sendMessage).toHaveBeenCalledWith(
      'room@example.test',
      'groupchat',
      'hello',
      undefined,
    );
  });
});
