import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeskChunk, DeskRef, DeskSpec, DeskToolCall, Hands } from '@zilar/desk';
import type { FetchLike } from '../ai/http';
import { createTestContext, type TestContext } from '../test-support';
import {
  FakeCore,
  completionResponse,
  createGatewayHelpers,
  incoming,
  seedAi,
  toolCallResponse,
  waitFor,
} from './gateway.test-harness';

// T-1409: a DM turn where the model calls `bash`. The desk is provisioned once
// and `execute` gets the tool and args; the final model reply still comes back.
function createFakeHands(): {
  hands: Hands;
  provisions: DeskSpec[];
  executes: Array<{ ref: DeskRef; call: DeskToolCall }>;
} {
  const provisions: DeskSpec[] = [];
  const executes: Array<{ ref: DeskRef; call: DeskToolCall }> = [];
  const hands: Hands = {
    async provision(spec) {
      provisions.push(spec);
      return { id: `desk-${spec.key.aiId}`, key: spec.key };
    },
    execute(ref, call): AsyncIterable<DeskChunk> {
      executes.push({ ref, call });
      return (async function* (): AsyncGenerator<DeskChunk> {
        yield { type: 'stdout', data: 'hello\n' };
        yield { type: 'exit', code: 0, truncated: false };
      })();
    },
    async stop() {
      return undefined;
    },
    async snapshot(_ref, label) {
      return { deskId: 'desk-1', label, bytes: 0 };
    },
  };
  return { hands, provisions, executes };
}

describe('desk tools in a DM turn', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it('provisions once, runs bash with the args and replies', async () => {
    const { hands, provisions, executes } = createFakeHands();
    const fetchImpl: FetchLike = (_url, init) => {
      const body = JSON.parse(String(init.body)) as { messages?: Array<{ role?: string }> };
      const answered = (body.messages ?? []).some((message) => message.role === 'tool');
      return Promise.resolve(
        answered
          ? completionResponse('The command printed hello.')
          : toolCallResponse('call-1', 'bash', '{"command":"echo hello"}'),
      );
    };

    const helpers = createGatewayHelpers({
      getContext: () => context,
      setGateway: () => undefined,
    });
    const cores: FakeCore[] = [];
    const { gateway } = helpers.harness(cores, fetchImpl, {
      desk: async () => ({ hands, imageDigest: 'zilar-desk@sha256:abc' }),
    });
    const { aiId, ownerJid, aiJid } = await seedAi(context, { computerMode: 'cloud' });

    await gateway.start();
    await waitFor(() => gateway.aiIds().length === 1);
    const core = await helpers.coreFor(cores, aiJid);

    core.receive(incoming(aiJid, ownerJid, 'msg-1', 'run echo hello'));
    await waitFor(() => executes.length === 1);
    await waitFor(() =>
      core.sent.some(
        (message) => message.to === ownerJid && message.text === 'The command printed hello.',
      ),
    );

    expect(provisions).toHaveLength(1);
    expect(provisions[0]?.key).toEqual({ aiId, projectId: 'default' });
    expect(provisions[0]?.imageDigest).toBe('zilar-desk@sha256:abc');
    expect(executes[0]?.call).toEqual({ tool: 'bash', args: { command: 'echo hello' } });

    await gateway.stop();
  });
});
