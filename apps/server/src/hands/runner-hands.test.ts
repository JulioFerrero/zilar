import { describe, expect, it } from 'vitest';
import { DeskError, DeskQueued, type DeskSpec } from '@zilar/desk';
import type { DeskReplyFrame, DeskRequestFrame } from '@zilar/runner-tunnel';
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
