// T-1422: stopping a running AI turn from its session. A turn that is mid
// model call is aborted, posts no reply, and the task card ends `stopped`;
// an idle chat answers `stopped: false`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import type { FetchLike } from '../ai/http';
import { createKeyCipher } from '../connections/crypto';
import { createDraftHub } from '../drafts/hub';
import { createTestContext, TEST_XMPP_DOMAIN, type TestContext } from '../test-support';
import {
  FakeCore,
  MASTER_KEY,
  completionResponse,
  createGatewayHelpers,
  incoming,
  seedAi,
  tick,
  toolCallResponse,
  waitFor,
  type Call,
} from '../test-support/gateway-harness';
import { createBudgetGate } from './gateway/budget';
import { createDmTurn } from './gateway/dm-turn';
import { createLiveSession } from './gateway/live';
import { createMemoryRunner } from './gateway/memory';
import {
  toRedactedError,
  type AgentGatewayDeps,
  type AiSession,
  type GatewayLogger,
  type PendingMessage,
  type ScheduledTurnOutcome,
} from './gateway/contracts';

interface ProgressPayload {
  type: string;
  data: { state?: string; summary?: string; steps?: Array<{ state: string }> };
}

function payloadOf(message: { opts?: unknown }): ProgressPayload | undefined {
  const opts = message.opts as { payload?: ProgressPayload } | undefined;
  return opts?.payload;
}

describe('stop a running AI turn (T-1422)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('aborts mid-turn: the reply never goes out and the card ends stopped', async () => {
    // The first two model calls ask for a tool (so the card is posted and its
    // step list has an in-progress step); the third call hangs until the turn
    // is stopped.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: Call[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return Promise.resolve(toolCallResponse('call-1', 'bash', '{"command":"echo cats"}'));
      }
      if (calls.length === 2) {
        return Promise.resolve(toolCallResponse('call-2', 'read', '{"path":"notes.txt"}'));
      }
      return gate.then(() => completionResponse('late answer'));
    };

    const helpers = createGatewayHelpers({
      getContext: () => context,
      setGateway: () => undefined,
    });
    const cores: FakeCore[] = [];
    const { gateway } = helpers.harness(cores, fetchImpl, { toolMaxRounds: 3 });
    const { aiId, ownerJid, aiJid } = await seedAi(context);

    await gateway.start();
    await waitFor(() => gateway.aiIds().length === 1);
    const core = await helpers.coreFor(cores, aiJid);

    core.receive(incoming(aiJid, ownerJid, 'msg-1', 'please work'));
    // Two tool rounds ran; the card was posted and carries an in-progress step.
    // The third call is hanging.
    await waitFor(() => calls.length >= 3);
    await waitFor(() => core.sent.some((message) => payloadOf(message) !== undefined));

    expect(gateway.stopTurn(aiId, aiJid)).toBe(true);
    release();

    await waitFor(() =>
      core.corrections.some((correction) => payloadOf(correction)?.data.state === 'stopped'),
    );

    const stopped = core.corrections.filter(
      (correction) => payloadOf(correction)?.data.state === 'stopped',
    );
    expect(stopped).toHaveLength(1);
    expect(stopped[0]?.originalId).toBe('sent-1');
    expect(stopped[0] ? payloadOf(stopped[0])?.data.summary : undefined).toMatch(/^Stopped after /);
    // The stopped turn's last card leaves no step spinning: the step that was
    // in progress when the abort landed is resolved.
    const stoppedSteps = stopped[0] ? payloadOf(stopped[0])?.data.steps : undefined;
    expect(stoppedSteps?.[stoppedSteps.length - 1]?.state).toBe('failed');

    // No reply went out: every send so far is a card post (it carries a payload).
    expect(
      core.sent.some((message) => message.to === ownerJid && payloadOf(message) === undefined),
    ).toBe(false);

    // Once the turn is over the controller is cleared; an idle chat, an
    // unknown chat and an unknown AI all answer `false`.
    await tick(20);
    expect(gateway.stopTurn(aiId, aiJid)).toBe(false);
    expect(gateway.stopTurn(aiId, 'nowhere@example.com')).toBe(false);
    expect(gateway.stopTurn('ai-unknown', aiJid)).toBe(false);
  });
});

function scheduledSession(aiId: string, aiJid: string): AiSession {
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
    rooms: new Map(),
    roomPending: new Map(),
    roomBusy: new Set(),
    roomTurns: new Map(),
    roomRateNotices: new Map(),
    roomSentIds: new Map(),
  };
}

function dmPumpFor(
  context: TestContext,
  session: AiSession,
  options: { limited?: boolean; fetchImpl?: FetchLike } = {},
): ReturnType<typeof createDmTurn>['pumpSessionEffect'] {
  const logger: GatewayLogger = { info: () => {}, warn: () => {} };
  const defaultFetch = (() => Promise.resolve(completionResponse('the routine ran'))) as FetchLike;
  const deps = {
    db: context.db,
    xmpp: context.xmppConfig,
    adminClient: context.adminClient,
    cipher: createKeyCipher(MASTER_KEY),
    logger,
    fetchImpl: options.fetchImpl ?? defaultFetch,
  } as unknown as AgentGatewayDeps;
  const secretsFor = (): string[] => [];
  const live = createLiveSession({
    sessions: new Map([[session.aiId, session]]),
    deps,
    logger,
    secretsFor,
    roomJidFor: (localpart) => `${localpart}@${context.xmppConfig.mucDomain}`,
  });
  const budgetGate =
    options.limited === true
      ? ({
          checkDailyLimit: async () => ({ limited: true, usage: null }),
          sendBudgetWarnings: async () => undefined,
          checkDmRoundGate: async () => null,
        } as unknown as ReturnType<typeof createBudgetGate>)
      : createBudgetGate({ deps, logger, sessionIsLive: live.sessionIsLive, secretsFor });
  const { loadMemoryContext, startCompaction } = createMemoryRunner({
    deps,
    logger,
    secretsFor,
    nowMs: () => Date.now(),
    toRedactedError,
    checkDmRoundGate: budgetGate.checkDmRoundGate,
  });
  const { pumpSessionEffect } = createDmTurn({
    deps,
    logger,
    turnLogger: logger,
    sessionIsLive: live.sessionIsLive,
    liveSendMessage: live.liveSendMessage,
    liveSendTyping: live.liveSendTyping,
    liveMarkDisplayed: live.liveMarkDisplayed,
    liveProgressReporter: live.liveProgressReporter,
    budgetGate,
    loadMemoryContext,
    startCompaction,
    disconnectAi: async () => undefined,
    secretsFor,
    executeToolCall: () => async () => ({ content: 'ok' }),
    withToolGuide: (messages) => messages,
    draftHub: createDraftHub(),
  });
  return pumpSessionEffect;
}

function scheduledItem(ownerJid: string, outcomes: ScheduledTurnOutcome[]): PendingMessage {
  return {
    id: 'scheduled-1',
    body: 'run the routine',
    fromJid: ownerJid,
    scheduled: { routineId: 'routine-1', onOutcome: (outcome) => outcomes.push(outcome) },
  };
}

describe('a scheduled item rides the DM queue (T-1642)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it("settles 'limited' when the daily limit is reached", async () => {
    const { aiId, ownerJid, aiJid } = await seedAi(context);
    const session = scheduledSession(aiId, aiJid);
    const pump = dmPumpFor(context, session, { limited: true });
    const outcomes: ScheduledTurnOutcome[] = [];
    session.pending.push(scheduledItem(ownerJid, outcomes));

    await Effect.runPromise(pump(session));

    expect(outcomes).toEqual(['limited']);
    expect((session.core as FakeCore).displayed).toEqual([]);
  });
});

describe('scheduled-run fixes (T-1657)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it("settles 'stopped' when the session stops before the final send", async () => {
    const { aiId, ownerJid, aiJid } = await seedAi(context);
    const session = scheduledSession(aiId, aiJid);
    const pump = dmPumpFor(context, session, {
      fetchImpl: () => {
        // The AI is stopped after the model call, before the reply is sent, so
        // `liveSendMessage` drops the reply while the turn still reports
        // `replied`.
        session.stopped = true;
        return Promise.resolve(completionResponse('the routine ran'));
      },
    });
    const outcomes: ScheduledTurnOutcome[] = [];
    session.pending.push(scheduledItem(ownerJid, outcomes));

    await Effect.runPromise(pump(session));

    expect(outcomes).toEqual(['stopped']);
    const core = session.core as FakeCore;
    expect(
      core.sent.some((message) => message.to === ownerJid && message.text === 'the routine ran'),
    ).toBe(false);
  });
});
