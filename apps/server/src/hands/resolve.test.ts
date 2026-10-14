import { describe, expect, it } from 'vitest';
import type { DeskChunk, Hands } from '@zilar/desk';
import {
  resolveDeskForAi,
  type CloudDesk,
  type ResolvedDesk,
  type RunnerDeskSource,
} from './resolve';
import type { RunnerDesk } from './runner-hands';

// T-1423: the per-turn mode resolution. These pin the security-relevant rules:
// a runner that is foreign or revoked never resolves, and `runner` mode never
// silently falls back to cloud.

function stubHands(): Hands {
  return {
    provision: () => Promise.reject(new Error('not used')),
    execute(): AsyncIterable<DeskChunk> {
      return (async function* (): AsyncGenerator<DeskChunk> {})();
    },
    stop: () => Promise.resolve(),
    snapshot: () => Promise.reject(new Error('not used')),
  };
}

const CLOUD: CloudDesk = { hands: stubHands(), imageDigest: 'zilar-desk@sha256:cloud' };
const RUNNER_IMAGE = 'zilar-desk@sha256:runner';

const RUNNER_DESK: RunnerDesk = {
  sendDesk: (frame) => Promise.resolve({ type: 'desk.ready', desk_id: frame.desk_id }),
  openDeskExec: () => Promise.reject(new Error('not used')),
};

function hubWith(machineId: string): RunnerDeskSource {
  return { deskFor: (id) => (id === machineId ? RUNNER_DESK : null) };
}

const NO_HUB: RunnerDeskSource = { deskFor: () => null };

function unavailable(result: ResolvedDesk): string {
  return 'unavailable' in result ? result.unavailable : `resolved:${result.where}`;
}

describe('resolveDeskForAi', () => {
  it('never resolves in off mode', async () => {
    const result = await resolveDeskForAi({
      computerMode: 'off',
      machineId: 'm1',
      ownerId: 'owner',
      cloud: CLOUD,
      runnerImage: RUNNER_IMAGE,
      hub: hubWith('m1'),
      isMachineUsable: () => Promise.resolve(true),
    });
    expect(unavailable(result)).toBe('off');
  });

  it('uses the cloud client in cloud mode', async () => {
    const result = await resolveDeskForAi({
      computerMode: 'cloud',
      machineId: null,
      ownerId: 'owner',
      cloud: CLOUD,
      runnerImage: null,
      hub: NO_HUB,
      isMachineUsable: () => Promise.resolve(true),
    });
    expect(result).toEqual({ hands: CLOUD.hands, imageDigest: CLOUD.imageDigest, where: 'cloud' });
  });

  it('uses the runner when it is online and owned', async () => {
    const result = await resolveDeskForAi({
      computerMode: 'runner',
      machineId: 'm1',
      ownerId: 'owner',
      cloud: CLOUD,
      runnerImage: RUNNER_IMAGE,
      hub: hubWith('m1'),
      isMachineUsable: () => Promise.resolve(true),
    });
    expect('where' in result && result.where).toBe('runner');
    expect('imageDigest' in result && result.imageDigest).toBe(RUNNER_IMAGE);
  });

  it('auto uses the runner when it is online', async () => {
    const result = await resolveDeskForAi({
      computerMode: 'auto',
      machineId: 'm1',
      ownerId: 'owner',
      cloud: CLOUD,
      runnerImage: RUNNER_IMAGE,
      hub: hubWith('m1'),
      isMachineUsable: () => Promise.resolve(true),
    });
    expect('where' in result && result.where).toBe('runner');
  });

  it('auto falls back to cloud only when the runner is offline', async () => {
    const offline = await resolveDeskForAi({
      computerMode: 'auto',
      machineId: 'm1',
      ownerId: 'owner',
      cloud: CLOUD,
      runnerImage: RUNNER_IMAGE,
      hub: NO_HUB,
      isMachineUsable: () => Promise.resolve(true),
    });
    expect('where' in offline && offline.where).toBe('cloud');
  });

  it('auto falls back to cloud when the runner is not usable', async () => {
    const revoked = await resolveDeskForAi({
      computerMode: 'auto',
      machineId: 'm1',
      ownerId: 'owner',
      cloud: CLOUD,
      runnerImage: RUNNER_IMAGE,
      hub: hubWith('m1'),
      isMachineUsable: () => Promise.resolve(false),
    });
    expect('where' in revoked && revoked.where).toBe('cloud');
  });

  it('runner mode never falls back to cloud for a revoked or foreign machine', async () => {
    const result = await resolveDeskForAi({
      computerMode: 'runner',
      machineId: 'm1',
      ownerId: 'owner',
      cloud: CLOUD,
      runnerImage: RUNNER_IMAGE,
      hub: hubWith('m1'),
      isMachineUsable: () => Promise.resolve(false),
    });
    expect(unavailable(result)).toBe('offline');
  });

  it('runner mode is offline without an assigned machine', async () => {
    const result = await resolveDeskForAi({
      computerMode: 'runner',
      machineId: null,
      ownerId: 'owner',
      cloud: CLOUD,
      runnerImage: RUNNER_IMAGE,
      hub: hubWith('m1'),
      isMachineUsable: () => Promise.resolve(true),
    });
    expect(unavailable(result)).toBe('no-runner');
  });

  it('runner mode is offline with no runner image configured', async () => {
    const result = await resolveDeskForAi({
      computerMode: 'runner',
      machineId: 'm1',
      ownerId: 'owner',
      cloud: CLOUD,
      runnerImage: null,
      hub: hubWith('m1'),
      isMachineUsable: () => Promise.resolve(true),
    });
    expect(unavailable(result)).toBe('offline');
  });

  it('cloud mode without a cloud client resolves to no computer', async () => {
    const result = await resolveDeskForAi({
      computerMode: 'cloud',
      machineId: null,
      ownerId: 'owner',
      cloud: null,
      runnerImage: null,
      hub: NO_HUB,
      isMachineUsable: () => Promise.resolve(true),
    });
    expect(unavailable(result)).toBe('no-runner');
  });
});
