// effect-plain: the runner's desk handler drives @zilar/desk's effect-plain
// lifecycle and the docker CLI; the runner process has no Effect runtime.
import type net from 'node:net';
import {
  DeskError,
  type DeskEgressPolicy,
  type DeskKey,
  type DeskLimits,
  type DeskRef,
  type DeskSpec,
} from '@zilar/desk';
import {
  Admission,
  Lifecycle,
  bridgeDaemon,
  createDockerLayer,
  createWorkspaces,
  deskName,
  type AgentConfig,
} from '@zilar/desk/agent';
import type {
  DeskErrorCode,
  DeskExecFrame,
  DeskProvisionFrame,
  DeskProvisionOutcome,
  DeskRunnerHandler,
  DeskStopFrame,
  DeskStopOutcome,
} from '@zilar/runner-tunnel';
import type { DeskDriver } from './driver.ts';
import { GIB, clampEgress, clampLimits, type LocalPolicy } from './policy.ts';

export interface RunnerDeskOptions {
  readonly driver: DeskDriver;
  readonly policy: LocalPolicy;
  /** Where desk workspaces live, e.g. `~/.zilar-runner/desks`. */
  readonly workspaceRoot: string;
  /** A local image pin; when absent the image is pinned from the first provision. */
  readonly image?: string | undefined;
  /** The docker network jails join (the egress proxy is a later task). */
  readonly network?: string | undefined;
  readonly log?: ((message: string) => void) | undefined;
}

const DESK_NAME = /^desk-[A-Za-z0-9_-]{1,64}-[A-Za-z0-9_-]{1,64}$/;

/**
 * The runner's desk handler: it clamps the server's request with the local
 * policy, then drives `@zilar/desk`'s `Lifecycle` in process with this host's
 * driver (plan §2, §6.2, §6.4). With no jail driver it refuses every provision
 * with `jail_unavailable`; there is no unsandboxed mode.
 */
export class RunnerDeskHandler implements DeskRunnerHandler {
  private readonly keys = new Map<string, DeskKey>();
  private lifecycle: Lifecycle | null = null;
  private image: string | null;
  private readonly log: (message: string) => void;

  constructor(private readonly options: RunnerDeskOptions) {
    this.image = options.image ?? null;
    this.log = options.log ?? (() => {});
  }

  async provision(frame: DeskProvisionFrame): Promise<DeskProvisionOutcome> {
    if (this.options.driver.kind === 'none') {
      return {
        kind: 'error',
        code: 'jail_unavailable',
        message: this.options.driver.reason || 'no jail driver on this host',
      };
    }
    try {
      const key: DeskKey = { aiId: frame.ai_id, projectId: frame.project_id };
      const name = deskName(key);
      if (frame.desk_id !== name) {
        return {
          kind: 'error',
          code: 'tool_failed',
          message: 'desk id does not match the ai and project',
        };
      }
      const result = await this.lifecycleFor(frame.image_digest).provision(
        this.specFor(frame, key),
      );
      if (result.kind === 'queued') {
        return { kind: 'queued', position: result.position };
      }
      this.keys.set(name, key);
      return { kind: 'ready' };
    } catch (error) {
      return { kind: 'error', code: deskCode(error), message: deskMessage(error) };
    }
  }

  async stop(frame: DeskStopFrame): Promise<DeskStopOutcome> {
    const lifecycle = this.lifecycle;
    const key = this.keys.get(frame.desk_id);
    if (lifecycle === null || key === undefined) {
      return { kind: 'error', code: 'not_provisioned', message: 'no live desk for this id' };
    }
    const ref: DeskRef = { id: frame.desk_id, key };
    try {
      await lifecycle.stop(ref, { keepWorkspace: frame.keep_workspace });
      this.keys.delete(frame.desk_id);
      return { kind: 'stopped' };
    } catch (error) {
      return { kind: 'error', code: deskCode(error), message: deskMessage(error) };
    }
  }

  async exec(frame: DeskExecFrame, stream: net.Socket): Promise<void> {
    if (!this.keys.has(frame.desk_id) || !DESK_NAME.test(frame.desk_id)) {
      throw new DeskError('not_provisioned', 'no live desk for this id');
    }
    bridgeDaemon(frame.desk_id, stream);
  }

  /** Builds the lifecycle lazily, pinning the image from the first provision. */
  private lifecycleFor(imageDigest: string): Lifecycle {
    if (this.lifecycle === null) {
      const image = this.image ?? imageDigest;
      this.image = image;
      const config: AgentConfig = {
        socketPath: '',
        workspaceRoot: this.options.workspaceRoot,
        // A runner is unprivileged: a plain folder, no loop-mounted image.
        workspaceMode: 'dir',
        diskBytes: this.options.policy.maxDiskGb * GIB,
        maxRunning: this.options.policy.maxRunning,
        idleMs: 120_000,
        memoryRatioLimit: 0.75,
        poolCgroupPath: null,
        docker: {
          runtime: this.options.driver.dockerRuntime,
          image,
          network: this.options.network ?? 'none',
          cgroupParent: null,
        },
        egress: null,
      };
      this.lifecycle = new Lifecycle({
        docker: createDockerLayer(config.docker),
        workspaces: createWorkspaces(config),
        admission: new Admission({
          maxRunning: config.maxRunning,
          memoryRatioLimit: config.memoryRatioLimit,
        }),
        config,
        log: this.log,
      });
    }
    return this.lifecycle;
  }

  private specFor(frame: DeskProvisionFrame, key: DeskKey): DeskSpec {
    const limits = clampLimits(frameLimits(frame), this.options.policy, this.log);
    const egress = clampEgress(frameEgress(frame), this.options.policy);
    const base: DeskSpec = {
      key,
      ownerUserId: frame.ai_id,
      imageDigest: frame.image_digest,
      limits,
    };
    return egress === undefined ? base : { ...base, egress };
  }
}

function frameLimits(frame: DeskProvisionFrame): DeskLimits {
  return {
    memoryBytes: frame.limits.memory_bytes,
    pids: frame.limits.pids,
    cpuShares: frame.limits.cpu_shares,
    diskBytes: frame.limits.disk_bytes,
    commandTimeoutMs: frame.limits.command_timeout_ms,
    taskWallClockMs: frame.limits.task_wall_clock_ms,
  };
}

function frameEgress(frame: DeskProvisionFrame): DeskEgressPolicy | undefined {
  const egress = frame.egress;
  if (egress === undefined) {
    return undefined;
  }
  return {
    ...(egress.allowed_hosts === undefined ? {} : { allowedHosts: egress.allowed_hosts }),
    ...(egress.git === undefined
      ? {}
      : { git: { host: egress.git.host, ownerRepo: egress.git.owner_repo } }),
  };
}

function deskCode(error: unknown): DeskErrorCode {
  return error instanceof DeskError ? error.code : 'tool_failed';
}

function deskMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.slice(0, 512) : '';
  return message.length > 0 ? message : 'the desk failed';
}
