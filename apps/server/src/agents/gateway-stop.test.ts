// T-1422: stopping a running AI turn from its session. A turn that is mid
// model call is aborted, posts no reply, and the task card ends `stopped`;
// an idle chat answers `stopped: false`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../ai/http';
import { createTestContext, type TestContext } from '../test-support';
import {
  FakeCore,
  completionResponse,
  createGatewayHelpers,
  incoming,
  seedAi,
  tick,
  toolCallResponse,
  waitFor,
  type Call,
} from './gateway.test-harness';

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
        return Promise.resolve(toolCallResponse('call-1', 'recall', '{"query":"cats"}'));
      }
      if (calls.length === 2) {
        return Promise.resolve(toolCallResponse('call-2', 'recall', '{"query":"dogs"}'));
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
