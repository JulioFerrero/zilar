// effect-plain: the turn's computer resolution is a Promise over a database
// read and the hub's synchronous desk lookup; the domain logic stays plain.
import type { AiComputerMode } from '@zilar/api-contract';
import type { Hands } from '@zilar/desk';
import type { ServerDatabase } from '../db/client';
import { findOwnedMachine } from '../machines/machines';
import { createRunnerHands, type RunnerDesk } from './runner-hands';

/**
 * T-1423: turns an AI's `computer_mode` and its assigned machine into the
 * computer a turn runs on. The gateway calls it once per turn, so a runner
 * that goes offline (or is revoked) is seen on the next turn. It never leaks a
 * decision: a machine that is foreign, revoked or not approved reads exactly
 * like a missing one.
 */

/** The cloud desk: a `Hands` plus the pinned image the sidecar runs. */
export interface CloudDesk {
  readonly hands: Hands;
  readonly imageDigest: string;
}

/** The hub's desk ops, keyed by machine id (from `RunnerHub.deskFor`). */
export interface RunnerDeskSource {
  deskFor(machineId: string): RunnerDesk | null;
}

/** True when `machineId` is owned by `ownerId`, approved and not revoked. */
export type MachineUsable = (machineId: string, ownerId: string) => Promise<boolean>;

export type ResolvedDesk =
  | { readonly hands: Hands; readonly imageDigest: string; readonly where: 'cloud' | 'runner' }
  | { readonly unavailable: 'offline' | 'no-runner' | 'off' };

export interface ResolveDeskInput {
  readonly computerMode: AiComputerMode;
  readonly machineId: string | null;
  readonly ownerId: string;
  /** The cloud client, when the sidecar is wired; null otherwise. */
  readonly cloud: CloudDesk | null;
  /** The image a runner desk runs; null when none is configured. */
  readonly runnerImage: string | null;
  /** The runner hub, when it is running; null otherwise. */
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

/** The runner result, or null when it cannot serve: no id, offline or not owned. */
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

/** The `MachineUsable` probe over the database, scoped to the AI's owner. */
export function machineUsableFor(db: ServerDatabase): MachineUsable {
  return async (machineId, ownerId) => {
    const machine = await findOwnedMachine(db, machineId, ownerId);
    return machine !== null && machine.status === 'approved' && machine.revokedAt === null;
  };
}
