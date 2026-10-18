// effect-plain: the privileged sidecar's process settings, read once from the
// environment at startup; the sidecar is a host daemon, not an Effect service.
import { MAX_DISK_BYTES } from '../hands';
import { DEFAULT_REGISTRY_SOCKET } from '../egress/registry';

export interface DockerSettings {
  /** The runtime for `--runtime`, or null to leave the docker daemon's default. */
  readonly runtime: string | null;
  /** `DESK_IMAGE` (a pinned digest) or the published ref; the pin lives in the lifecycle. */
  readonly image: string;
  readonly network: string;
  /** The parent cgroup every jail runs under (`zilar-desks.slice`), or null. */
  readonly cgroupParent: string | null;
}

export interface EgressSettings {
  /** The proxy's base URL as the jails dial it, e.g. `http://desk-egress:3128`. */
  readonly proxyUrl: string;
  readonly registrySocket: string;
}

export interface AgentConfig {
  readonly socketPath: string;
  readonly workspaceRoot: string;
  /** `image` loop-mounts an ext4 file (the VPS); `dir` binds a plain folder (macOS dev). */
  readonly workspaceMode: 'image' | 'dir';
  readonly diskBytes: number;
  readonly maxRunning: number;
  readonly idleMs: number;
  /** Pool memory use above this ratio blocks a new jail (plan §2.3, 75%). */
  readonly memoryRatioLimit: number;
  readonly poolCgroupPath: string | null;
  readonly docker: DockerSettings;
  readonly egress: EgressSettings | null;
}

export const DEFAULT_SOCKET_PATH = '/run/zilar/desk.sock';
export const DEFAULT_WORKSPACE_ROOT = '/var/lib/zilar/desks';
export const DEFAULT_CGROUP_PARENT = 'zilar-desks.slice';
export const DEFAULT_MAX_RUNNING = 12;
export const DEFAULT_IDLE_MS = 120_000;
export const MEMORY_RATIO_LIMIT = 0.75;
export const DEFAULT_IMAGE_OWNER = 'julioferrero';
export const DEFAULT_IMAGE_TAG = 'latest';

const IMAGE_OWNER_PATTERN = /^[a-z0-9._-]+$/;
const IMAGE_TAG_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function intFromEnv(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`invalid integer: ${value}`);
  }
  return parsed;
}

function textFromEnv(value: string | undefined, fallback: string): string {
  return value === undefined ? fallback : value;
}

function workspaceModeFromEnv(value: string | undefined): 'image' | 'dir' {
  if (value === undefined || value === '') {
    return 'image';
  }
  if (value !== 'image' && value !== 'dir') {
    throw new Error('DESK_WORKSPACE_MODE must be image or dir');
  }
  return value;
}

/** The `DESK_IMAGE` override (digest-checked unless `DESK_ALLOW_UNPINNED_IMAGE`), else the
 * published ref; owner and tag are validated because this reaches a `docker` argument. */
function imageFromEnv(env: NodeJS.ProcessEnv): string {
  const override = env.DESK_IMAGE;
  if (override !== undefined && override.length > 0) {
    if (env.DESK_ALLOW_UNPINNED_IMAGE !== 'true' && !override.includes('@sha256:')) {
      throw new Error(
        'DESK_IMAGE must be pinned by digest (…@sha256:…), or set DESK_ALLOW_UNPINNED_IMAGE=true',
      );
    }
    return override;
  }
  const owner = textFromEnv(env.DESK_IMAGE_OWNER, DEFAULT_IMAGE_OWNER);
  if (!IMAGE_OWNER_PATTERN.test(owner)) {
    throw new Error('DESK_IMAGE_OWNER must match [a-z0-9._-]');
  }
  const tag = textFromEnv(env.DESK_IMAGE_TAG, DEFAULT_IMAGE_TAG);
  if (!IMAGE_TAG_PATTERN.test(tag)) {
    throw new Error('DESK_IMAGE_TAG must match [A-Za-z0-9._-] and be 1-128 characters');
  }
  return `ghcr.io/${owner}/zilar-desk:${tag}`;
}

/** `DESK_IMAGE` must be pinned by digest unless `DESK_ALLOW_UNPINNED_IMAGE` is set;
 * otherwise the image is resolved from `DESK_IMAGE_OWNER`/`DESK_IMAGE_TAG`. */
export function loadAgentConfig(env: NodeJS.ProcessEnv): AgentConfig {
  const image = imageFromEnv(env);
  const cgroupParent = textFromEnv(env.DESK_CGROUP_PARENT, DEFAULT_CGROUP_PARENT);
  const poolCgroupPath =
    env.DESK_POOL_CGROUP_PATH ??
    (cgroupParent.length > 0 ? `/sys/fs/cgroup/${cgroupParent}` : null);
  const proxyUrl = env.DESK_EGRESS_PROXY;
  const egress: EgressSettings | null =
    proxyUrl === undefined || proxyUrl === ''
      ? null
      : {
          proxyUrl,
          registrySocket: textFromEnv(env.DESK_EGRESS_REGISTRY, DEFAULT_REGISTRY_SOCKET),
        };
  return {
    socketPath: textFromEnv(env.DESK_AGENT_SOCKET, DEFAULT_SOCKET_PATH),
    workspaceRoot: textFromEnv(env.DESK_WORKSPACE_ROOT, DEFAULT_WORKSPACE_ROOT),
    workspaceMode: workspaceModeFromEnv(env.DESK_WORKSPACE_MODE),
    diskBytes: intFromEnv(env.DESK_DISK_BYTES, MAX_DISK_BYTES, MAX_DISK_BYTES),
    maxRunning: intFromEnv(env.DESK_MAX_RUNNING, DEFAULT_MAX_RUNNING, 1024),
    idleMs: intFromEnv(env.DESK_IDLE_MS, DEFAULT_IDLE_MS, Number.MAX_SAFE_INTEGER),
    memoryRatioLimit: MEMORY_RATIO_LIMIT,
    poolCgroupPath,
    docker: {
      runtime: textFromEnv(env.DESK_RUNTIME, 'runsc'),
      image,
      network: textFromEnv(env.DESK_NETWORK, 'desk-net'),
      cgroupParent: cgroupParent.length > 0 ? cgroupParent : null,
    },
    egress,
  };
}
