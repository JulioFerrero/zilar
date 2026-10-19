// A routine posts one message and every later run edits it while it is under
// 24 h old; a stopped session sends nothing. A title is capped at 80
// characters in the payload.
import type { XmppCore } from '@zilar/xmpp-core';
import { describe, expect, it, vi } from 'vitest';
import type { ServerDatabase } from '../../db/client';
import type { AiSession, GatewayLogger } from './contracts';
import { createRoutineSend, type RoutineSend } from './routine-send';
import { type RoutineRow } from '../../db/rows-agents';

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
    alertCardId: null,
    alertBlockId: null,
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

describe('a routine sends one message and edits it', () => {
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

  it('sends nothing when the session is not live', async () => {
    const h = harness({ live: false, stored: { messageId: 'stored-1', at: NOW } });

    const sent = await h.send('room@example.test', 'groupchat', 'hello');

    expect(sent).toEqual({ id: '' });
    expect(h.core.sendMessage).not.toHaveBeenCalled();
    expect(h.core.sendCorrection).not.toHaveBeenCalled();
    expect(h.loadMessage).not.toHaveBeenCalled();
    expect(h.recordMessage).not.toHaveBeenCalled();
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
});
