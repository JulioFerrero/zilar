import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../ai/litellm-client';
import { createTestContext, type TestContext } from '../test-support';
import { seedGroup } from '../test-support/seed';
import {
  GROUP_RATE_WINDOW_MS,
  GROUP_TURNS_PER_WINDOW,
  ROUND_MAX_AI_TURNS,
  type RoomRound,
} from './gateway/contracts';
import { replyTargetsAi } from './gateway/group-ingest';
import { checkRoomLimits, shouldSendRateNotice } from './gateway/room-limits';
import {
  FakeCore,
  FakeLitellm,
  completionResponse,
  createGatewayHelpers,
  seedAi as seedGatewayAi,
  waitFor,
  type Call,
} from './gateway.test-harness';

const ROOM = 'project@rooms.zilar.localhost';
const ROOM_DAY = new Date('2026-09-28T12:00:00Z');

function round(aiTurns: number): RoomRound {
  return { humanMessageId: 'm-1', aiTurns, hops: 0, handoffIds: new Set() };
}

// T-1176 (AI-7): the two room limits, moved out of `group-turn.ts`.
describe('checkRoomLimits', () => {
  it('accepts a turn under both limits and stamps the rate window', () => {
    const roomTurns = new Map<string, number[]>();
    const roomRounds = new Map([[ROOM, round(0)]]);
    expect(checkRoomLimits({ roomTurns, roomRounds, roomJid: ROOM, atMs: 1000 })).toBe('ok');
    expect(roomTurns.get(ROOM)).toEqual([1000]);
    expect(roomRounds.get(ROOM)?.aiTurns).toBe(1);
  });

  it('drops past the rate window without spending the round budget', () => {
    const stamps = Array.from({ length: GROUP_TURNS_PER_WINDOW }, (_, index) => 1000 + index);
    const roomTurns = new Map([[ROOM, stamps]]);
    const roomRounds = new Map([[ROOM, round(0)]]);
    expect(checkRoomLimits({ roomTurns, roomRounds, roomJid: ROOM, atMs: 2000 })).toBe('rate');
    expect(roomTurns.get(ROOM)).toHaveLength(GROUP_TURNS_PER_WINDOW);
    expect(roomRounds.get(ROOM)?.aiTurns).toBe(0);
  });

  it('drops past the round budget and refunds the rate stamp', () => {
    const roomTurns = new Map<string, number[]>();
    const roomRounds = new Map([[ROOM, round(ROUND_MAX_AI_TURNS)]]);
    expect(checkRoomLimits({ roomTurns, roomRounds, roomJid: ROOM, atMs: 1000 })).toBe('round');
    expect(roomTurns.get(ROOM)).toEqual([]);
    expect(roomRounds.get(ROOM)?.aiTurns).toBe(ROUND_MAX_AI_TURNS);
  });
});

describe('shouldSendRateNotice', () => {
  it('allows one notice per window per room', () => {
    const notices = new Map<string, number>();
    expect(shouldSendRateNotice(notices, ROOM, 1000)).toBe(true);
    notices.set(ROOM, 1000);
    expect(shouldSendRateNotice(notices, ROOM, 1000 + GROUP_RATE_WINDOW_MS - 1)).toBe(false);
    expect(shouldSendRateNotice(notices, ROOM, 1000 + GROUP_RATE_WINDOW_MS)).toBe(true);
  });
});

// T-1176 (AI-8): a reply to the AI's own message wakes it without a mention.
describe('replyTargetsAi', () => {
  const aiBare = 'ai-1@zilar.localhost';
  const occupant = `${ROOM}/Helper AI`;

  it('wakes on the id of a message the AI sent', () => {
    expect(
      replyTargetsAi({
        replyTo: { id: 'sent-3' },
        aiBare,
        aiOccupantJid: occupant,
        sentIds: ['sent-2', 'sent-3'],
      }),
    ).toBe(true);
  });

  it('wakes on the AI bare JID in `to`', () => {
    expect(
      replyTargetsAi({ replyTo: { id: 'x', to: aiBare }, aiBare, aiOccupantJid: occupant }),
    ).toBe(true);
  });

  it('wakes on the AI MUC occupant JID in `to`', () => {
    expect(
      replyTargetsAi({ replyTo: { id: 'x', to: occupant }, aiBare, aiOccupantJid: occupant }),
    ).toBe(true);
  });

  it('ignores a reply to someone else', () => {
    expect(
      replyTargetsAi({
        replyTo: { id: 'sent-9', to: 'someone@zilar.localhost' },
        aiBare,
        aiOccupantJid: occupant,
        sentIds: ['sent-1'],
      }),
    ).toBe(false);
  });

  it('ignores a message with no reply', () => {
    expect(replyTargetsAi({ replyTo: undefined, aiBare, aiOccupantJid: occupant })).toBe(false);
  });
});

describe('group reply wakes the AI (T-1176)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('answers a reply that quotes the AI message id, with no mention', async () => {
    const litellm = new FakeLitellm();
    const calls: Call[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(completionResponse('AI answer'));
    };
    const helpers = createGatewayHelpers({
      getContext: () => context,
      setGateway: () => undefined,
    });
    const cores: FakeCore[] = [];
    const { gateway } = helpers.harness(cores, fetchImpl, litellm);
    const { aiId, ownerId, ownerJid, aiJid } = await seedGatewayAi(context);
    await seedGroup(context, ownerId, [{ userId: ownerId, role: 'owner' }], [aiId]);

    await gateway.start();
    await waitFor(() => gateway.aiIds().length === 1);
    const core = await helpers.coreFor(cores, aiJid);
    await waitFor(() => core.joined.length === 1);
    const roomJid = core.joined[0]?.roomJid ?? '';
    expect(roomJid).not.toBe('');

    const isReply = (message: FakeCore['sent'][number]): boolean =>
      message.to === roomJid && message.text.startsWith('@Owner ');
    core.receive({
      id: 'msg-1',
      chatJid: roomJid,
      kind: 'groupchat',
      fromJid: ownerJid,
      fromResolved: true,
      fromNick: 'Owner',
      body: 'hello AI',
      timestamp: ROOM_DAY,
      mentions: [{ jid: aiJid, begin: 0, end: 2 }],
      outgoing: false,
    });
    await waitFor(() => core.sent.filter(isReply).length === 1);
    const replyIndex = core.sent.findIndex(isReply);
    const replyId = `sent-${replyIndex + 1}`;

    // The AI's own reflection comes back `outgoing` and carries the archive
    // stanza-id (XEP-0359) as `id`, with the gateway's own id as `originId`.
    // Clients quote the stanza-id, so the ingest records it too.
    core.receive({
      id: 'stanza-1',
      originId: replyId,
      chatJid: roomJid,
      kind: 'groupchat',
      fromJid: `${roomJid}/Gateway AI`,
      fromResolved: false,
      fromNick: 'Gateway AI',
      body: 'AI answer',
      timestamp: ROOM_DAY,
      outgoing: true,
    });

    // No mention: only the quoted id connects this message to the AI.
    core.receive({
      id: 'msg-2',
      chatJid: roomJid,
      kind: 'groupchat',
      fromJid: ownerJid,
      fromResolved: true,
      fromNick: 'Owner',
      body: 'thanks',
      timestamp: ROOM_DAY,
      replyTo: { id: replyId },
      outgoing: false,
    });
    await waitFor(() => core.sent.filter(isReply).length === 2);

    // A reply quoting the archive stanza-id (what our clients store) wakes it.
    core.receive({
      id: 'msg-3',
      chatJid: roomJid,
      kind: 'groupchat',
      fromJid: ownerJid,
      fromResolved: true,
      fromNick: 'Owner',
      body: 'and one more',
      timestamp: ROOM_DAY,
      replyTo: { id: 'stanza-1' },
      outgoing: false,
    });
    await waitFor(() => core.sent.filter(isReply).length === 3);
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });
});
