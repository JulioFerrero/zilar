// T-1709: after a person approves an AI's request, the decision queues a
// follow-up turn on the AI's own queue so it continues the task it stopped at;
// a deny queues nothing.
import type { XmppCore } from '@zilar/xmpp-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { AiSession } from './contracts';
import { createApprovalFollowUp, type ApprovalFollowUpDeps } from '../gateway';
import { type ApprovalRow } from '../../db/rows-agents';

const DOMAIN = 'zilar.localhost';
const ROOM_JID = 't1@rooms.zilar.localhost';

function sessionFor(overrides: Partial<AiSession> = {}): AiSession {
  return {
    aiId: 'ai-1',
    aiJid: `ai-1@${DOMAIN}`,
    core: {} as XmppCore,
    busy: false,
    pending: [],
    stopped: false,
    retryAttempt: 0,
    retryTimer: undefined,
    unsubs: [],
    turnAborts: new Map(),
    rooms: new Map([[ROOM_JID, { groupId: 'g-1', topicId: 't-1', joinedAtMs: 0, nick: 'Helper' }]]),
    roomPending: new Map(),
    roomBusy: new Set(),
    roomTurns: new Map(),
    roomRateNotices: new Map(),
    roomSentIds: new Map(),
    ...overrides,
  };
}

function approvalRow(overrides: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: 'a-1',
    aiId: 'ai-1',
    groupId: 'g-1',
    topicId: null,
    action: 'market_prices',
    summary: 'Run the market-prices tool for example.com',
    details: null,
    argsHash: 'hash',
    worstCaseCurrency: null,
    worstCaseAmount: null,
    requestedBy: 'owner-1',
    status: 'consumed',
    decidedBy: 'user-1',
    decidedAt: new Date(),
    note: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ...overrides,
  };
}

function depsFor(
  session: AiSession,
  row: ApprovalRow | null,
  opts: { live?: boolean } = {},
): { deps: ApprovalFollowUpDeps; kicked: { dm: number; rooms: string[] } } {
  const kicked = { dm: 0, rooms: [] as string[] };
  return {
    deps: {
      sessions: new Map([[session.aiId, session]]),
      sessionIsLive: () => opts.live ?? true,
      loadRoomJid: () => Effect.succeed(ROOM_JID),
      loadTopicRoomJid: () => Effect.succeed(ROOM_JID),
      loadOwnerName: async () => 'Julio',
      domain: DOMAIN,
      kickDm: () => {
        kicked.dm += 1;
      },
      kickRoom: (_session, roomJid) => {
        kicked.rooms.push(roomJid);
      },
      loadApproval: async () => row,
    },
    kicked,
  };
}

describe('approval follow-up', () => {
  it('queues one turn on an approved room queue, from the decider', async () => {
    const session = sessionFor();
    const row = approvalRow({ groupId: 'g-1', topicId: null });
    const { deps, kicked } = depsFor(session, row);

    await createApprovalFollowUp(deps).continueAfterApproval(row.id);

    const queued = session.roomPending.get(ROOM_JID) ?? [];
    expect(queued).toHaveLength(1);
    const message = queued[0];
    expect(message?.fromJid).toBe(`user-1@${DOMAIN}`);
    expect(message?.fromNick).toBe('Julio');
    expect(message?.body).toBe(
      `Approved: "${row.summary}". Continue the task from where you stopped. Do not repeat what you already said.`,
    );
    expect(message).not.toHaveProperty('scheduled');
    expect(kicked.rooms).toEqual([ROOM_JID]);
    expect(kicked.dm).toBe(0);
    expect(session.pending).toHaveLength(0);
  });

  it('queues nothing after a deny', async () => {
    const session = sessionFor();
    const row = approvalRow({ status: 'denied' });
    const { deps, kicked } = depsFor(session, row);

    await createApprovalFollowUp(deps).continueAfterApproval(row.id);

    expect(session.roomPending.size).toBe(0);
    expect(session.pending).toHaveLength(0);
    expect(kicked.rooms).toEqual([]);
    expect(kicked.dm).toBe(0);
  });

  it('queues nothing when the AI session is not live', async () => {
    const session = sessionFor();
    const row = approvalRow();
    const { deps, kicked } = depsFor(session, row, { live: false });

    await createApprovalFollowUp(deps).continueAfterApproval(row.id);

    expect(session.roomPending.size).toBe(0);
    expect(kicked.rooms).toEqual([]);
    expect(kicked.dm).toBe(0);
  });

  it('pushes a DM approval onto the session queue and kicks it', async () => {
    const session = sessionFor();
    const row = approvalRow({ groupId: null, topicId: null });
    const { deps, kicked } = depsFor(session, row);

    await createApprovalFollowUp(deps).continueAfterApproval(row.id);

    expect(session.pending).toHaveLength(1);
    expect(session.pending[0]?.fromJid).toBe(`user-1@${DOMAIN}`);
    expect(session.pending[0]?.body).toContain(row.summary);
    expect(session.pending[0]).not.toHaveProperty('scheduled');
    expect(kicked.dm).toBe(1);
    expect(kicked.rooms).toEqual([]);
    expect(session.roomPending.size).toBe(0);
  });
});
