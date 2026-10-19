import { describe, expect, it } from 'vitest';
import type { DeskChunk, DeskSpec, Hands } from '@zilar/desk';
import { createDeskRunner, type DeskToolCallValid } from '../agents/gateway/desk-exec';

const SPEC: DeskSpec = {
  key: { aiId: 'ai1', projectId: 'p1' },
  ownerUserId: 'owner-1',
  imageDigest: 'zilar-desk@sha256:abc',
  limits: {
    memoryBytes: 1,
    pids: 1,
    cpuShares: 1,
    diskBytes: 1,
    commandTimeoutMs: 1,
    taskWallClockMs: 1,
  },
};

const CALL: DeskToolCallValid = { id: 'call-1', tool: 'bash', args: { command: 'true' } };

function fakeHands(executed: string[]): Hands {
  return {
    provision: () => Promise.resolve({ id: 'desk-ai1-p1', key: SPEC.key }),
    async *execute(): AsyncIterable<DeskChunk> {
      executed.push('executed');
      yield { type: 'exit', code: 0, truncated: false };
    },
    stop: () => Promise.resolve(),
    snapshot: () => Promise.reject(new Error('not used')),
  };
}

describe('createDeskRunner machine re-check', () => {
  it('stops the next runner call when the machine is no longer usable', async () => {
    const executed: string[] = [];
    let usable = true;
    const run = createDeskRunner({
      hands: fakeHands(executed),
      imageDigest: SPEC.imageDigest,
      aiId: 'ai1',
      ownerUserId: 'owner-1',
      logger: { info: () => {}, warn: () => {} },
      isUsable: () => Promise.resolve(usable),
    });

    await expect(run(CALL)).resolves.toMatchObject({ content: 'done' });
    usable = false;
    await expect(run(CALL)).resolves.toEqual({ content: 'This computer was disconnected.' });
    expect(executed).toEqual(['executed']);
  });
});
