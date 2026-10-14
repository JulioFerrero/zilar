// effect-plain: the runner hands maps `desk.*` frames to the same Promise/
// generator shape as `cloud-hands.ts`; the frames carry their own bounded
// schemas, so the domain logic stays plain.
import type { Socket } from 'node:net';
import {
  DeskError,
  DeskQueued,
  type DeskChunk,
  type DeskEgressPolicy,
  type DeskRef,
  type DeskSpec,
  type DeskToolCall,
  type Hands,
} from '@zilar/desk';
import { deskName } from '@zilar/desk/agent';
import type { DeskEgressFrame, DeskReplyFrame, DeskRequestFrame } from '@zilar/runner-tunnel';
import { runExecuteOverSocket } from './cloud-hands';

/**
 * T-1423: the hub's desk ops for one runner, already bound to its runner id so
 * the `Hands` never carry one. `sendDesk` resolves with the runner's reply
 * frame; `openDeskExec` returns the socket that carries the daemon bytes.
 */
export interface RunnerDesk {
  sendDesk(frame: DeskRequestFrame): Promise<DeskReplyFrame>;
  openDeskExec(deskId: string): Promise<Socket>;
}

/**
 * The app-side `Hands` over a runner's tunnel (plan §2, §6.1). It is the runner
 * twin of `cloud-hands.ts`: the same four operations, the same daemon protocol
 * over `execute`, but the transport is the hub's `desk.*` control frames. Every
 * reply frame carries a fixed error code, never host text.
 */
export function createRunnerHands(desk: RunnerDesk): Hands {
  async function* runExecute(
    ref: DeskRef,
    call: DeskToolCall,
    signal?: AbortSignal,
  ): AsyncIterable<DeskChunk> {
    const socket = await desk.openDeskExec(ref.id);
    yield* runExecuteOverSocket(socket, ref, call, signal);
  }

  return {
    async provision(spec) {
      const deskId = deskName(spec.key);
      const reply = await desk.sendDesk(provisionFrame(spec, deskId));
      switch (reply.type) {
        case 'desk.ready':
          return { id: deskId, key: spec.key };
        case 'queued':
          throw new DeskQueued(reply.position);
        case 'desk.error':
          throw new DeskError(reply.code, reply.message);
        default:
          throw new DeskError('tool_failed', 'the runner answered an unexpected desk reply');
      }
    },
    execute(ref, call, signal) {
      return runExecute(ref, call, signal);
    },
    async stop(ref, opts) {
      const reply = await desk.sendDesk({
        type: 'desk.stop',
        desk_id: ref.id,
        keep_workspace: opts?.keepWorkspace ?? true,
      });
      if (reply.type === 'desk.error') {
        throw new DeskError(reply.code, reply.message);
      }
    },
    async snapshot() {
      throw new DeskError('tool_failed', 'snapshot is not available on a runner yet');
    },
  };
}

/** The runner frame for one provision request; `desk_id` is deterministic. */
function provisionFrame(spec: DeskSpec, deskId: string): DeskRequestFrame {
  return {
    type: 'desk.provision',
    desk_id: deskId,
    ai_id: spec.key.aiId,
    project_id: spec.key.projectId,
    image_digest: spec.imageDigest,
    limits: {
      memory_bytes: spec.limits.memoryBytes,
      pids: spec.limits.pids,
      cpu_shares: spec.limits.cpuShares,
      disk_bytes: spec.limits.diskBytes,
      command_timeout_ms: spec.limits.commandTimeoutMs,
      task_wall_clock_ms: spec.limits.taskWallClockMs,
    },
    ...(spec.egress === undefined ? {} : { egress: egressFrame(spec.egress) }),
  };
}

function egressFrame(egress: DeskEgressPolicy): DeskEgressFrame {
  return {
    ...(egress.allowedHosts === undefined ? {} : { allowed_hosts: egress.allowedHosts }),
    ...(egress.git === undefined
      ? {}
      : { git: { host: egress.git.host, owner_repo: egress.git.ownerRepo } }),
  };
}
