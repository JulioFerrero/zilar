import { describe, expect, it } from 'vitest';
import { DeskError, DeskQueued, type DeskChunk, type DeskSpec, type Hands } from '@zilar/desk';
import type { DeskReplyFrame, DeskRequestFrame } from '@zilar/runner-tunnel';
import { createDeskRunner, type DeskToolCallValid } from '../agents/gateway/desk-exec';
import { createRunnerHands, type RunnerDesk } from './runner-hands';

// T-1423: the runner's `Hands` maps each reply frame to the same shape the
// cloud adapter returns, so the gateway never sees a runner specially.

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

function deskReturning(reply: (frame: DeskRequestFrame) => DeskReplyFrame): {
  desk: RunnerDesk;
  frames: DeskRequestFrame[];
} {
  const frames: DeskRequestFrame[] = [];
  return {
    frames,
    desk: {
      sendDesk: (frame) => {
        frames.push(frame);
        return Promise.resolve(reply(frame));
      },
      openDeskExec: () => Promise.reject(new Error('not used')),
    },
  };
}

describe('createRunnerHands provision', () => {
  it('maps desk.ready to the desk ref and sends the provision frame', async () => {
    const { desk, frames } = deskReturning((frame) => ({
      type: 'desk.ready',
      desk_id: frame.desk_id,
    }));
    const ref = await createRunnerHands(desk).provision(SPEC);
    expect(ref).toEqual({ id: 'desk-ai1-p1', key: { aiId: 'ai1', projectId: 'p1' } });
    expect(frames[0]).toMatchObject({
      type: 'desk.provision',
      desk_id: 'desk-ai1-p1',
      ai_id: 'ai1',
      project_id: 'p1',
      image_digest: 'zilar-desk@sha256:abc',
    });
  });

  it('maps queued to HandsQueued with the position', async () => {
    const { desk } = deskReturning((frame) => ({
      type: 'queued',
      desk_id: frame.desk_id,
      position: 3,
    }));
    await expect(createRunnerHands(desk).provision(SPEC)).rejects.toBeInstanceOf(DeskQueued);
    await expect(createRunnerHands(desk).provision(SPEC)).rejects.toMatchObject({ position: 3 });
  });

  it('maps desk.error to HandsError with the code', async () => {
    const { desk } = deskReturning((frame) => ({
      type: 'desk.error',
      desk_id: frame.desk_id,
      code: 'queue_full',
      message: 'the runner is full',
    }));
    await expect(createRunnerHands(desk).provision(SPEC)).rejects.toBeInstanceOf(DeskError);
    await expect(createRunnerHands(desk).provision(SPEC)).rejects.toMatchObject({
      code: 'queue_full',
    });
  });

  it('refuses snapshot until the runner supports it', async () => {
    const { desk } = deskReturning((frame) => ({ type: 'desk.ready', desk_id: frame.desk_id }));
    await expect(
      createRunnerHands(desk).snapshot({ id: 'desk-ai1-p1', key: SPEC.key }, 'label'),
    ).rejects.toBeInstanceOf(DeskError);
  });

  it('sends desk.stop with keep_workspace true by default', async () => {
    const { desk, frames } = deskReturning((frame) => ({
      type: 'desk.stopped',
      desk_id: frame.desk_id,
    }));
    await createRunnerHands(desk).stop({ id: 'desk-ai1-p1', key: SPEC.key });
    expect(frames[0]).toEqual({
      type: 'desk.stop',
      desk_id: 'desk-ai1-p1',
      keep_workspace: true,
    });
  });
});

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
