// effect-plain: the turn's computer resolution is a Promise over a database read and the
// hub's synchronous desk lookup; the domain logic stays plain.
import type { AiComputerMode } from '@zilar/api-contract';
import type { Hands } from '@zilar/desk';
import type { ServerDatabase } from '../db/client';
import { findOwnedMachine } from '../machines/machines';
import { createRunnerHands, type RunnerDesk } from './runner-hands';

/**
 * The computer a turn runs on, resolved once per turn, so an offline or revoked runner is
 * seen on the next turn. A foreign, revoked or unapproved machine reads like a missing one.
 */

export interface CloudDesk {
  readonly hands: Hands;
  readonly imageDigest: string;
}

export interface RunnerDeskSource {
  deskFor(machineId: string): RunnerDesk | null;
}

export type MachineUsable = (machineId: string, ownerId: string) => Promise<boolean>;

export type ResolvedDesk =
  | { readonly hands: Hands; readonly imageDigest: string; readonly where: 'cloud' | 'runner' }
  | { readonly unavailable: 'offline' | 'no-runner' | 'off' };

export interface ResolveDeskInput {
  readonly computerMode: AiComputerMode;
  readonly machineId: string | null;
  readonly ownerId: string;
  readonly cloud: CloudDesk | null;
  readonly runnerImage: string | null;
  readonly hub: RunnerDeskSource | null;
  readonly isMachineUsable: MachineUsable;
}

export async function resolveDeskForAi(input: ResolveDeskInput): Promise<ResolvedDesk> {
  switch (input.computerMode) {
    case 'off':
      return { unavailable: 'off' };
    case 'cloud':
      return input.cloud === null ? { unavailable: 'no-runner' } : cloudResult(input.cloud);
    case 'runner': {
      const runner = await resolveRunner(input);
      return runner ?? { unavailable: input.machineId === null ? 'no-runner' : 'offline' };
    }
    case 'auto': {
      const runner = await resolveRunner(input);
      if (runner !== null) {
        return runner;
      }
      return input.cloud === null ? { unavailable: 'no-runner' } : cloudResult(input.cloud);
    }
  }
}

async function resolveRunner(input: ResolveDeskInput): Promise<ResolvedDesk | null> {
  const { machineId, hub, runnerImage } = input;
  if (machineId === null || hub === null || runnerImage === null) {
    return null;
  }
  if (!(await input.isMachineUsable(machineId, input.ownerId))) {
    return null;
  }
  const desk = hub.deskFor(machineId);
  if (desk === null) {
    return null;
  }
  return { hands: createRunnerHands(desk), imageDigest: runnerImage, where: 'runner' };
}

function cloudResult(cloud: CloudDesk): ResolvedDesk {
  return { hands: cloud.hands, imageDigest: cloud.imageDigest, where: 'cloud' };
}

export function machineUsableFor(db: ServerDatabase): MachineUsable {
  return async (machineId, ownerId) => {
    const machine = await findOwnedMachine(db, machineId, ownerId);
    return machine !== null && machine.status === 'approved' && machine.revokedAt === null;
  };
}
