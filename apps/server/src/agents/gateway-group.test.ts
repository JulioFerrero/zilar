import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../ai/http';
import { TEST_XMPP_DOMAIN, createTestContext, type TestContext } from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { localpartFor } from '../xmpp/provisioning';
import {
  GROUP_RATE_WINDOW_MS,
  GROUP_TURNS_PER_WINDOW,
  ROUND_MAX_AI_TURNS,
  type RoomRound,
} from './gateway/contracts';
import { replyTargetsAi } from './gateway/group-ingest';
import { checkRoomLimits, shouldSendRateNotice } from './gateway/room-limits';
import { GROUP_FAILURE_REPLY, PROVIDER_KEY_REJECTED_REPLY } from './replies';
import { TOOL_TURN_WALL_CLOCK_MS } from './tool-loop';
import { TOOL_TURN_MIN_CALL_MS, remainingTurnBudgetMs } from './turn-budget';
import {
  FakeCore,
  completionResponse,
  createGatewayHelpers,
  jsonResponse,
  seedAi as seedGatewayAi,
  tick,
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
    const { gateway } = helpers.harness(cores, fetchImpl);
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

// T-1290 (AI-14): each model call inside a tool turn is bounded by what is
// left of the turn's wall clock, floored so a nearly-spent budget still lets
// the call finish.
describe('remainingTurnBudgetMs', () => {
  it('returns what is left of the turn budget, floored at the call minimum', () => {
    const start = 1_000;
    expect(remainingTurnBudgetMs(start, () => start + 10_000)).toBe(
      TOOL_TURN_WALL_CLOCK_MS - 10_000,
    );
    expect(remainingTurnBudgetMs(start, () => start + TOOL_TURN_WALL_CLOCK_MS - 1_000)).toBe(
      TOOL_TURN_MIN_CALL_MS,
    );
    expect(remainingTurnBudgetMs(start, () => start + TOOL_TURN_WALL_CLOCK_MS + 60_000)).toBe(
      TOOL_TURN_MIN_CALL_MS,
    );
  });
});

// T-1290 (AI-9): mentions from different senders queued during one turn run as
// separate turns, each tagged to the person it answers, in order.
describe('group mentions from different senders (T-1290)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('runs one turn per sender instead of merging them', async () => {
    const calls: Call[] = [];
    let releaseFirst: (() => void) | undefined;
    let signalFirstStarted = (): void => undefined;
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        const held = new Promise<Response>((resolve) => {
          releaseFirst = () => resolve(completionResponse('first answer'));
        });
        signalFirstStarted();
        return held;
      }
      return Promise.resolve(completionResponse(`answer ${calls.length}`));
    };
    const helpers = createGatewayHelpers({
      getContext: () => context,
      setGateway: () => undefined,
    });
    const cores: FakeCore[] = [];
    const { gateway } = helpers.harness(cores, fetchImpl);
    const { aiId, ownerId, ownerJid, aiJid } = await seedGatewayAi(context);
    const secondId = await seedUser(context, { name: 'Second' });
    const thirdId = await seedUser(context, { name: 'Third' });
    await seedGroup(
      context,
      ownerId,
      [
        { userId: ownerId, role: 'owner' },
        { userId: secondId, role: 'member' },
        { userId: thirdId, role: 'member' },
      ],
      [aiId],
    );

    await gateway.start();
    await waitFor(() => gateway.aiIds().length === 1);
    const core = await helpers.coreFor(cores, aiJid);
    await waitFor(() => core.joined.length === 1);
    const roomJid = core.joined[0]?.roomJid ?? '';
    expect(roomJid).not.toBe('');

    const jidFor = (userId: string): string => `${localpartFor(userId)}@${TEST_XMPP_DOMAIN}`;
    const isReply = (message: FakeCore['sent'][number]): boolean =>
      message.to === roomJid && message.kind === 'groupchat' && message.text.startsWith('@');
    const mention = (id: string, fromJid: string, nick: string) => ({
      id,
      chatJid: roomJid,
      kind: 'groupchat' as const,
      fromJid,
      fromResolved: true,
      fromNick: nick,
      body: 'hello AI',
      timestamp: ROOM_DAY,
      mentions: [{ jid: aiJid, begin: 0, end: 2 }],
      outgoing: false,
    });

    // The first turn is held at its model call, so the next two mentions land
    // in the queue while that turn is in flight — the merge window.
    core.receive(mention('m-1', ownerJid, 'Owner'));
    await firstStarted;
    core.receive(mention('m-2', jidFor(secondId), 'Second'));
    core.receive(mention('m-3', jidFor(thirdId), 'Third'));
    releaseFirst?.();

    await waitFor(() => core.sent.filter(isReply).length === 3);
    const texts = core.sent.filter(isReply).map((message) => message.text);
    expect(texts.some((text) => text.startsWith('@Owner '))).toBe(true);
    expect(texts.some((text) => text.startsWith('@Second '))).toBe(true);
    expect(texts.some((text) => text.startsWith('@Third '))).toBe(true);
  });
});

// T-1290 (AI-10): a failed room turn tells the room a fixed line and DMs the
// owner the real reason, at most once per room per UTC day.
describe('group turn failure notice (T-1290)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('sends the fixed room line plus one owner DM, then no second DM that day', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(jsonResponse({ error: { message: 'invalid api key' } }, 401));
    const helpers = createGatewayHelpers({
      getContext: () => context,
      setGateway: () => undefined,
    });
    const cores: FakeCore[] = [];
    const { gateway } = helpers.harness(cores, fetchImpl);
    const { aiId, ownerId, ownerJid, aiJid } = await seedGatewayAi(context);
    await seedGroup(context, ownerId, [{ userId: ownerId, role: 'owner' }], [aiId]);

    await gateway.start();
    await waitFor(() => gateway.aiIds().length === 1);
    const core = await helpers.coreFor(cores, aiJid);
    await waitFor(() => core.joined.length === 1);
    const roomJid = core.joined[0]?.roomJid ?? '';
    expect(roomJid).not.toBe('');

    const mention = (id: string) => ({
      id,
      chatJid: roomJid,
      kind: 'groupchat' as const,
      fromJid: ownerJid,
      fromResolved: true,
      fromNick: 'Owner',
      body: 'hello AI',
      timestamp: ROOM_DAY,
      mentions: [{ jid: aiJid, begin: 0, end: 2 }],
      outgoing: false,
    });
    const roomReplies = (): FakeCore['sent'] =>
      core.sent.filter((message) => message.to === roomJid && message.kind === 'groupchat');
    const ownerDms = (): FakeCore['sent'] =>
      core.sent.filter((message) => message.to === ownerJid && message.kind === 'chat');

    core.receive(mention('f-1'));
    await waitFor(() => roomReplies().length === 1);
    core.receive(mention('f-2'));
    await waitFor(() => roomReplies().length === 2);

    expect(roomReplies()[0]?.text).toContain(GROUP_FAILURE_REPLY);
    expect(roomReplies()[1]?.text).toContain(GROUP_FAILURE_REPLY);
    expect(roomReplies()[0]?.text).not.toContain(PROVIDER_KEY_REJECTED_REPLY);
    expect(ownerDms()).toHaveLength(1);
    expect(ownerDms()[0]?.text).toBe(PROVIDER_KEY_REJECTED_REPLY);
  });
});

// T-1633 (plan smart-wake §5.3): `decideWake` is wired into the mention check,
// so a person's unaddressed message wakes an AI when it clearly addresses it,
// when it is a question in a one-AI room, or when it is a follow-up question
// right after that AI's own reply.
describe('smart wake rules (T-1633)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  type SeededAi = Awaited<ReturnType<typeof seedGatewayAi>>;

  const roomReplies = (core: FakeCore, roomJid: string): FakeCore['sent'] =>
    core.sent.filter((message) => message.to === roomJid && message.kind === 'groupchat');

  // One AI per name, all joined to the group's room. `calls` collects the
  // model calls every AI makes, so a test can assert a wake never fired.
  async function openRoom(
    names: string[],
    calls: Call[],
  ): Promise<{ cores: FakeCore[]; roomJid: string; senderJid: string; aiJids: string[] }> {
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(completionResponse('AI answer'));
    };
    const helpers = createGatewayHelpers({
      getContext: () => context,
      setGateway: () => undefined,
    });
    const cores: FakeCore[] = [];
    const { gateway } = helpers.harness(cores, fetchImpl);
    const seeded: SeededAi[] = [];
    for (const name of names) {
      seeded.push(await seedGatewayAi(context, { name }));
    }
    const first = seeded[0];
    if (first === undefined) {
      throw new Error('openRoom needs at least one AI');
    }
    await seedGroup(
      context,
      first.ownerId,
      [{ userId: first.ownerId, role: 'owner' }],
      seeded.map((ai) => ai.aiId),
    );
    await gateway.start();
    await waitFor(() => gateway.aiIds().length === seeded.length);
    const aiCores: FakeCore[] = [];
    for (const ai of seeded) {
      const core = await helpers.coreFor(cores, ai.aiJid);
      await waitFor(() => core.joined.length === 1);
      aiCores.push(core);
    }
    const roomJid = aiCores[0]?.joined[0]?.roomJid ?? '';
    expect(roomJid).not.toBe('');
    return {
      cores: aiCores,
      roomJid,
      senderJid: first.ownerJid,
      aiJids: seeded.map((ai) => ai.aiJid),
    };
  }

  it('answers an unaddressed question in a one-AI room (rule S)', async () => {
    const calls: Call[] = [];
    const { cores, roomJid, senderJid } = await openRoom(['Gateway AI'], calls);
    const core = cores[0];
    if (core === undefined) {
      throw new Error('no core');
    }
    core.receive({
      id: 'q-1',
      chatJid: roomJid,
      kind: 'groupchat',
      fromJid: senderJid,
      fromResolved: true,
      fromNick: 'Owner',
      body: 'what is BTC at?',
      timestamp: ROOM_DAY,
      outgoing: false,
    });
    await waitFor(() => roomReplies(core, roomJid).length === 1);
    expect(calls.length).toBe(1);
  });

  it('does not answer an unaddressed question in a two-AI room', async () => {
    const calls: Call[] = [];
    const { cores, roomJid, senderJid } = await openRoom(['Gateway AI', 'Second AI'], calls);
    const [core, secondCore] = cores;
    if (core === undefined || secondCore === undefined) {
      throw new Error('missing cores');
    }
    const message = {
      id: 'q-1',
      chatJid: roomJid,
      kind: 'groupchat' as const,
      fromJid: senderJid,
      fromResolved: true,
      fromNick: 'Owner',
      body: 'what is BTC at?',
      timestamp: ROOM_DAY,
      outgoing: false,
    };
    core.receive(message);
    secondCore.receive(message);
    await tick(200);
    expect(roomReplies(core, roomJid)).toHaveLength(0);
    expect(roomReplies(secondCore, roomJid)).toHaveLength(0);
    expect(calls.length).toBe(0);
  });

  it('does not answer a plain remark', async () => {
    const calls: Call[] = [];
    const { cores, roomJid, senderJid } = await openRoom(['Gateway AI'], calls);
    const core = cores[0];
    if (core === undefined) {
      throw new Error('no core');
    }
    core.receive({
      id: 'r-1',
      chatJid: roomJid,
      kind: 'groupchat',
      fromJid: senderJid,
      fromResolved: true,
      fromNick: 'Owner',
      body: 'thanks!',
      timestamp: ROOM_DAY,
      outgoing: false,
    });
    await tick(200);
    expect(roomReplies(core, roomJid)).toHaveLength(0);
    expect(calls.length).toBe(0);
  });

  it('answers a follow-up question right after its own reply (rule R)', async () => {
    const calls: Call[] = [];
    const { cores, roomJid, senderJid, aiJids } = await openRoom(
      ['Gateway AI', 'Second AI'],
      calls,
    );
    const [core, secondCore] = cores;
    const aiJid = aiJids[0];
    if (core === undefined || secondCore === undefined || aiJid === undefined) {
      throw new Error('missing cores');
    }
    // An explicit mention makes the first AI reply; the second AI stays idle.
    core.receive({
      id: 'm-1',
      chatJid: roomJid,
      kind: 'groupchat',
      fromJid: senderJid,
      fromResolved: true,
      fromNick: 'Owner',
      body: 'hello AI',
      timestamp: ROOM_DAY,
      mentions: [{ jid: aiJid, begin: 0, end: 2 }],
      outgoing: false,
    });
    await waitFor(() => roomReplies(core, roomJid).length === 1);
    // Its own room message reflects back `outgoing`, which opens the
    // follow-up window (rule R), not rule S (the room holds two AIs).
    core.receive({
      id: 'stanza-1',
      chatJid: roomJid,
      kind: 'groupchat',
      fromJid: `${roomJid}/Gateway AI`,
      fromResolved: false,
      fromNick: 'Gateway AI',
      body: 'AI answer',
      timestamp: ROOM_DAY,
      outgoing: true,
    });
    const followUp = {
      id: 'q-2',
      chatJid: roomJid,
      kind: 'groupchat' as const,
      fromJid: senderJid,
      fromResolved: true,
      fromNick: 'Owner',
      body: 'and gold?',
      timestamp: ROOM_DAY,
      outgoing: false,
    };
    core.receive(followUp);
    secondCore.receive(followUp);
    await waitFor(() => roomReplies(core, roomJid).length === 2);
    expect(roomReplies(secondCore, roomJid)).toHaveLength(0);
  });
});
