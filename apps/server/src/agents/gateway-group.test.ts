import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../ai/http';
import { createKeyCipher } from '../connections/crypto';
import { TEST_XMPP_DOMAIN, createTestContext, type TestContext } from '../test-support';
import { seedGroup, seedUser } from '../test-support/seed';
import { localpartFor } from '../xmpp/provisioning';
import { normBareJid } from './context';
import {
  GROUP_TURNS_PER_WINDOW,
  ROUND_MAX_AI_TURNS,
  toRedactedError,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
  type RoomPendingMessage,
  type RoomRound,
  type ScheduledTurnOutcome,
} from './gateway/contracts';
import { createBudgetGate } from './gateway/budget';
import { checkRoomLimits, createGroupTurn } from './gateway/group-turn';
import { createLiveSession } from './gateway/live';
import { createMemoryRunner } from './gateway/memory';
import { GROUP_FAILURE_REPLY, PROVIDER_KEY_REJECTED_REPLY } from './replies';
import {
  FakeCore,
  MASTER_KEY,
  completionResponse,
  createGatewayHelpers,
  jsonResponse,
  seedAi as seedGatewayAi,
  tick,
  waitFor,
  type Call,
} from '../test-support/gateway-harness';

const ROOM = 'project@rooms.zilar.localhost';
const ROOM_DAY = new Date('2026-09-28T12:00:00Z');

function round(aiTurns: number): RoomRound {
  return { humanMessageId: 'm-1', aiTurns, hops: 0, handoffIds: new Set() };
}

describe('checkRoomLimits', () => {
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
      message.to === roomJid && message.kind === 'groupchat' && message.text.includes('answer');
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
    expect(texts).toHaveLength(3);
    expect(texts.every((text) => !text.startsWith('@'))).toBe(true);
    const quoted = core.sent
      .filter(isReply)
      .map((message) => (message.opts as { replyTo?: { id?: string } } | undefined)?.replyTo?.id);
    expect(new Set(quoted)).toEqual(new Set(['m-1', 'm-2', 'm-3']));
  });
});

describe('group turn membership', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('does not answer a mention from someone who is not a group member', async () => {
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
    const { aiId, ownerId, aiJid } = await seedGatewayAi(context);
    const outsiderId = await seedUser(context, { name: 'Outsider' });
    await seedGroup(context, ownerId, [{ userId: ownerId, role: 'owner' }], [aiId]);

    await gateway.start();
    await waitFor(() => gateway.aiIds().length === 1);
    const core = await helpers.coreFor(cores, aiJid);
    await waitFor(() => core.joined.length === 1);
    const roomJid = core.joined[0]?.roomJid ?? '';
    expect(roomJid).not.toBe('');

    core.receive({
      id: 'm-outsider',
      chatJid: roomJid,
      kind: 'groupchat',
      fromJid: `${localpartFor(outsiderId)}@${TEST_XMPP_DOMAIN}`,
      fromResolved: true,
      fromNick: 'Outsider',
      body: 'hello AI',
      timestamp: ROOM_DAY,
      mentions: [{ jid: aiJid, begin: 0, end: 2 }],
      outgoing: false,
    });

    await tick(200);
    expect(core.sent.filter((message) => message.to === roomJid)).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});

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

function scheduledRoomSession(
  aiId: string,
  aiJid: string,
  roomJid: string,
  groupId: string,
  topicId: string,
): AiSession {
  return {
    aiId,
    aiJid,
    core: new FakeCore({
      service: '',
      domain: TEST_XMPP_DOMAIN,
      getToken: async () => ({ jid: aiJid, token: 'test-token' }),
    }),
    busy: false,
    pending: [],
    stopped: false,
    retryAttempt: 0,
    retryTimer: undefined,
    unsubs: [],
    turnAborts: new Map(),
    rooms: new Map([[roomJid, { groupId, topicId, joinedAtMs: 0, nick: 'Gateway AI' }]]),
    roomPending: new Map(),
    roomBusy: new Set(),
    roomTurns: new Map(),
    roomRateNotices: new Map(),
    roomSentIds: new Map(),
  };
}

function scheduledRoomItem(ownerJid: string, outcomes: ScheduledTurnOutcome[]): RoomPendingMessage {
  return {
    id: 'scheduled-1',
    body: 'run the routine',
    fromJid: ownerJid,
    fromResolved: true,
    fromNick: 'Owner',
    timestamp: ROOM_DAY,
    scheduled: { routineId: 'routine-1', onOutcome: (outcome) => outcomes.push(outcome) },
  };
}

function groupTurnFor(
  context: TestContext,
  session: AiSession,
  options: { toolsEnabled?: boolean; actions?: AgentGatewayDeps['actions'] } = {},
): {
  runGroupSessionTurn: (
    session: AiSession,
    roomJid: string,
    batch: RoomPendingMessage[],
  ) => Promise<void>;
  requests: Call[];
} {
  const logger: GatewayLogger = { info: () => {}, warn: () => {} };
  const requests: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    requests.push({ url, init });
    return Promise.resolve(completionResponse('the routine ran'));
  };
  const deps = {
    db: context.db,
    xmpp: context.xmppConfig,
    adminClient: context.adminClient,
    cipher: createKeyCipher(MASTER_KEY),
    logger,
    fetchImpl,
    now: () => ROOM_DAY,
    ...(options.toolsEnabled === undefined ? {} : { toolsEnabled: options.toolsEnabled }),
    ...(options.actions === undefined ? {} : { actions: options.actions }),
  } as unknown as AgentGatewayDeps;
  const secretsFor = (): string[] => [];
  const sessions = new Map<string, AiSession>([[session.aiId, session]]);
  const live = createLiveSession({
    sessions,
    deps,
    logger,
    secretsFor,
    roomJidFor: (localpart) => `${localpart}@${context.xmppConfig.mucDomain}`,
  });
  const budgetGate = createBudgetGate({
    deps,
    logger,
    sessionIsLive: live.sessionIsLive,
    secretsFor,
  });
  const { loadMemoryContext, startCompaction } = createMemoryRunner({
    deps,
    logger,
    secretsFor,
    nowMs: () => ROOM_DAY.getTime(),
    toRedactedError,
    checkDmRoundGate: budgetGate.checkDmRoundGate,
  });
  const { runGroupSessionTurn } = createGroupTurn({
    deps,
    logger,
    turnLogger: logger,
    sessions,
    roomRounds: new Map(),
    sessionForAiJid: (bare) => (bare === normBareJid(session.aiJid) ? session : undefined),
    liveSendMessage: live.liveSendMessage,
    liveSendTyping: live.liveSendTyping,
    liveProgressReporter: live.liveProgressReporter,
    budgetGate,
    loadMemoryContext,
    startCompaction,
    disconnectAi: async () => undefined,
    secretsFor,
    executeToolCall: () => async () => ({ content: 'ok' }),
    withToolGuide: (messages) => messages,
    nowMs: () => ROOM_DAY.getTime(),
  });
  return { runGroupSessionTurn, requests };
}

describe('a scheduled item rides the room queue (T-1646)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('offers request_action (unattended) and still no ask_people for a scheduled trigger', async () => {
    const { aiId, ownerId, ownerJid, aiJid } = await seedGatewayAi(context);
    const { groupId, generalTopicId } = await seedGroup(
      context,
      ownerId,
      [{ userId: ownerId, role: 'owner' }],
      [aiId],
    );
    const roomJid = 'scheduled@rooms.zilar.localhost';
    const session = scheduledRoomSession(aiId, aiJid, roomJid, groupId, generalTopicId);
    const { runGroupSessionTurn, requests } = groupTurnFor(context, session, {
      toolsEnabled: true,
      actions: {
        listActions: () => [{ name: 'do_thing', description: 'Does a thing' }],
      } as unknown as AgentGatewayDeps['actions'],
    });
    const outcomes: ScheduledTurnOutcome[] = [];

    await runGroupSessionTurn(session, roomJid, [scheduledRoomItem(ownerJid, outcomes)]);

    expect(outcomes).toEqual(['replied']);
    const body = JSON.parse(String(requests[0]?.init.body)) as {
      tools?: Array<{ function: { name: string } }>;
    };
    const names = (body.tools ?? []).map((tool) => tool.function.name);
    // A scheduled trigger gets `request_action` (the executor marks the request
    // unattended) but never `ask_people`.
    expect(names).toContain('request_action');
    expect(names).not.toContain('ask_people');
  });
});
