import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../ai/http';
import { createTestContext, type TestContext } from '../test-support';
import { AI_RESTART_REPLY } from './gateway/contracts';
import {
  FakeCore,
  completionResponse,
  createGatewayHelpers,
  incoming,
  seedAi,
  tick,
  waitFor,
  type Call,
} from '../test-support/gateway-harness';

// T-1168 (AI-1): `stop()` drains the turns in flight before it disconnects the
// sessions, so a DM reply the model already produced still reaches the owner.
describe('gateway drain on stop', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('delivers a DM reply that finishes inside the drain window', async () => {
    // The model call hangs until `release()`, so `stop()` runs while the turn
    // is in flight; the drain then waits for it.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: Call[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push({ url, init });
      return gate.then(() => completionResponse('AI answer'));
    };

    const helpers = createGatewayHelpers({
      getContext: () => context,
      setGateway: () => undefined,
    });
    const cores: FakeCore[] = [];
    const { gateway } = helpers.harness(cores, fetchImpl);
    const { ownerJid, aiJid } = await seedAi(context);

    await gateway.start();
    await waitFor(() => gateway.aiIds().length === 1);
    const core = await helpers.coreFor(cores, aiJid);

    core.receive(incoming(aiJid, ownerJid, 'msg-1', 'hello'));
    await waitFor(() => calls.length === 1);

    const stopping = gateway.stop();
    // Let the drain begin, then let the turn finish well inside its window.
    await tick(50);
    release();
    await stopping;

    expect(
      core.sent.some((message) => message.to === ownerJid && message.text === 'AI answer'),
    ).toBe(true);
    // T-1182: the turn finished inside the drain window, so no restart notice.
    expect(core.sent.some((message) => message.text === AI_RESTART_REPLY)).toBe(false);
    expect(core.disconnects).toBe(1);
  });
});
