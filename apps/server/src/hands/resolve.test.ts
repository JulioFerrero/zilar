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
});
