// effect-plain: builds the fixed `docker run` argument list in code. Only the
// validated numbers from the spec and the resolved proxy address reach it.
import { execFile as execFileCallback } from 'node:child_process';
import type { DeskSpec } from '../hands';
import type { DockerSettings } from './config';
import { DESK_LABEL } from './docker';

/** Runs one docker CLI call and resolves its stdout; tests swap in a fake. */
export type Exec = (
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<string>;

export function execFile(
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFileCallback(
      command,
      [...args],
      { encoding: 'utf8', maxBuffer: 1024 * 1024, ...(signal === undefined ? {} : { signal }) },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/** Keeps a jail alive; every tool then runs in the daemon via `docker exec`. */
function keepAliveFlags(image: string): readonly string[] {
  return ['--entrypoint', 'sleep', image, 'infinity'];
}

function mountFlags(workspaceDir: string): readonly string[] {
  return ['--mount', `type=bind,src=${workspaceDir},dst=/workspace`];
}

function proxyFlags(proxyUrl: string | null): readonly string[] {
  if (proxyUrl === null) {
    return [];
  }
  return [
    '--env',
    `HTTP_PROXY=${proxyUrl}`,
    '--env',
    `HTTPS_PROXY=${proxyUrl}`,
    '--env',
    'NO_PROXY=localhost,127.0.0.1',
  ];
}

function isIpv4Literal(host: string): boolean {
  const parts = host.split('.');
  return (
    parts.length === 4 &&
    parts.every(
      (part) => /^\d{1,3}$/.test(part) && String(Number(part)) === part && Number(part) <= 255,
    )
  );
}

/** The container id of the compose service `host`, on any network. */
export async function egressContainerId(
  host: string,
  exec: Exec = execFile,
): Promise<string | null> {
  const found = await exec('docker', [
    'ps',
    '-q',
    '--filter',
    `label=com.docker.compose.service=${host}`,
  ]);
  return (
    found
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null
  );
}

/** The container's IPv4 on `network`, or null when it is not attached there. */
export async function containerAddress(
  network: string,
  id: string,
  exec: Exec = execFile,
): Promise<string | null> {
  try {
    const output = await exec('docker', [
      'inspect',
      '-f',
      `{{with index .NetworkSettings.Networks "${network}"}}{{.IPAddress}}{{end}}`,
      id,
    ]);
    const address = output.trim();
    return address.length > 0 ? address : null;
  } catch {
    return null;
  }
}

/**
 * Finds the egress proxy's IPv4 on the jail network. gVisor's own network stack
 * cannot reach Docker's embedded DNS, so the proxy name is pinned in the jail's
 * /etc/hosts instead (the lead's live check, plan §4.4).
 */
export async function proxyAddress(
  network: string,
  host: string,
  exec: Exec = execFile,
): Promise<string | null> {
  if (isIpv4Literal(host)) {
    return host;
  }
  try {
    const id = await egressContainerId(host, exec);
    if (id === null) {
      return null;
    }
    return await containerAddress(network, id, exec);
  } catch {
    return null;
  }
}

/** The §4.2 run flags, fixed in code; only validated numbers come from the spec. */
export function createArgs(
  name: string,
  spec: DeskSpec,
  workspaceDir: string,
  settings: DockerSettings,
  proxyUrl: string | null,
  proxyAddress: string | null = null,
  network: string = settings.network,
): readonly string[] {
  const memory = spec.limits.memoryBytes;
  return [
    'create',
    '--name',
    name,
    '--label',
    `${DESK_LABEL}=1`,
    ...(settings.runtime === null ? [] : ['--runtime', settings.runtime]),
    '--read-only',
    '--tmpfs',
    '/tmp:rw,size=256m,exec',
    '--tmpfs',
    '/home/desk:rw,size=64m',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--memory',
    String(memory),
    '--memory-swap',
    String(memory),
    '--memory-reservation',
    String(Math.floor(memory / 2)),
    '--pids-limit',
    String(spec.limits.pids),
    '--cpu-shares',
    String(spec.limits.cpuShares),
    ...mountFlags(workspaceDir),
    ...(settings.cgroupParent === null ? [] : ['--cgroup-parent', settings.cgroupParent]),
    '--network',
    network,
    ...(proxyUrl !== null && proxyAddress !== null
      ? ['--add-host', `${new URL(proxyUrl).hostname}:${proxyAddress}`]
      : []),
    ...proxyFlags(proxyUrl),
    ...keepAliveFlags(spec.imageDigest),
  ];
}
