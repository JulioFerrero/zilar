// effect-plain: wraps the docker CLI with an argument list built in code. `execFile`/`spawn`
// only, never a shell; the sidecar never accepts a flag, image or command from the caller.
import { spawn } from 'node:child_process';
import type net from 'node:net';
import { Exit, Schema } from 'effect';
import type { DeskChunk, DeskSpec, DeskToolCall } from '../hands';
import { DeskError, ResponseSchema, type Request } from '../protocol';
import type { DockerSettings } from './config';
import {
  containerAddress,
  createArgs,
  egressContainerId,
  execFile,
  proxyAddress,
  type Exec,
} from './docker-args';

export { createArgs, proxyAddress };

export type DockerLog = (message: string) => void;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface DockerLayer {
  create(
    name: string,
    spec: DeskSpec,
    workspaceDir: string,
    proxyUrl: string | null,
  ): Promise<void>;
  start(name: string): Promise<void>;
  inspect(name: string): Promise<boolean>;
  run(name: string, call: DeskToolCall, signal?: AbortSignal): AsyncIterable<DeskChunk>;
  remove(name: string): Promise<void>;
  listDeskNames(): Promise<readonly string[]>;
  cleanupNetworks?(): Promise<number>;
  runtimeAvailable(): Promise<boolean>;
  /** Pulls `ref` and returns its repo digest, or null when either step fails. */
  pullAndResolveDigest(ref: string): Promise<string | null>;
}

export const DESK_LABEL = 'zilar.desk';

// effect-plain: one private internal network per jail, shared only with the egress
// proxy. Name and label are fixed in code; no caller input reaches a docker argument.
const DESK_NETWORK_PREFIX = 'zilar-desk-';

function deskNetworkName(jailName: string): string {
  return `${DESK_NETWORK_PREFIX}${jailName}`;
}

function lines(output: string): readonly string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Creates the jail's internal network, or reuses one a crash left behind.
async function ensureDeskNetwork(jailName: string, exec: Exec = execFile): Promise<string> {
  const network = deskNetworkName(jailName);
  try {
    await exec('docker', [
      'network',
      'create',
      '--internal',
      '--label',
      `${DESK_LABEL}=${jailName}`,
      network,
    ]);
    return network;
  } catch {
    try {
      await exec('docker', ['network', 'inspect', network]);
      return network;
    } catch {
      throw new DeskError(
        'jail_unavailable',
        `could not create the network for ${jailName}; Docker's address pool may be full`,
      );
    }
  }
}

// Joins the proxy to the jail network; on failure the jail starts without web access.
async function connectEgress(
  network: string,
  host: string,
  exec: Exec = execFile,
): Promise<string | null> {
  try {
    const id = await egressContainerId(host, exec);
    if (id === null) {
      return null;
    }
    try {
      await exec('docker', ['network', 'connect', network, id]);
    } catch {
      // Already connected from an earlier run: the address read below decides.
    }
    return await containerAddress(network, id, exec);
  } catch {
    return null;
  }
}

async function networkContainerNames(network: string, exec: Exec): Promise<readonly string[]> {
  try {
    const output = await exec('docker', [
      'network',
      'inspect',
      '-f',
      '{{range .Containers}}{{.Name}} {{end}}',
      network,
    ]);
    return output.split(/\s+/).filter((name) => name.length > 0);
  } catch {
    return [];
  }
}

async function disconnectContainers(network: string, exec: Exec = execFile): Promise<void> {
  for (const name of await networkContainerNames(network, exec)) {
    try {
      await exec('docker', ['network', 'disconnect', network, name]);
    } catch {
      // Already detached: removal stays idempotent.
    }
  }
}

async function removeNetwork(network: string, exec: Exec = execFile): Promise<void> {
  await disconnectContainers(network, exec);
  try {
    await exec('docker', ['network', 'rm', network]);
  } catch {
    // Already gone.
  }
}

async function removeDeskNetwork(jailName: string, exec: Exec = execFile): Promise<void> {
  await removeNetwork(deskNetworkName(jailName), exec);
}

// Startup sweep: removes every `zilar.desk`-labelled network whose jail is gone,
// catching networks left by a crash.
async function cleanupDeskNetworks(
  liveJailNames: readonly string[],
  exec: Exec = execFile,
): Promise<number> {
  let output: string;
  try {
    output = await exec('docker', [
      'network',
      'ls',
      '--filter',
      `label=${DESK_LABEL}`,
      '--format',
      `{{.Name}} {{.Label "${DESK_LABEL}"}}`,
    ]);
  } catch {
    return 0;
  }
  const live = new Set(liveJailNames);
  let removed = 0;
  for (const line of lines(output)) {
    const [network, jailName] = line.split(/\s+/, 2);
    if (network === undefined || jailName === undefined || live.has(jailName)) {
      continue;
    }
    await removeNetwork(network, exec);
    removed += 1;
  }
  return removed;
}

// One daemon frame is a JSON line; a process sending more than this is killed
// rather than allowed to grow our buffer.
const MAX_DAEMON_LINE_CHARS = 1024 * 1024;

/**
 * The daemon request for one tool call. `timeout_ms` rides in `args` because
 * the daemon re-validates `args` itself.
 */
function daemonRequest(call: DeskToolCall): Request {
  const args =
    call.timeoutMs === undefined || typeof call.args !== 'object' || call.args === null
      ? call.args
      : { ...(call.args as Record<string, unknown>), timeout_ms: call.timeoutMs };
  return { id: 1, tool: call.tool, args };
}

async function* readDaemon(
  name: string,
  call: DeskToolCall,
  signal?: AbortSignal,
): AsyncIterable<DeskChunk> {
  const child = spawn(
    'docker',
    ['exec', '-i', '--user', 'desk', name, '/opt/desk/desk-tool', 'serve'],
    {
      stdio: ['pipe', 'pipe', 'ignore'],
    },
  );
  const onAbort = (): void => {
    child.kill('SIGKILL');
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  let failure: Error | null = null;
  child.on('error', (error) => {
    failure = error;
  });
  child.stdin.on('error', () => {
    // The process already failed; `failure` or the close path reports it.
  });
  child.stdin.write(`${JSON.stringify(daemonRequest(call))}\n`);
  child.stdin.end();

  let buffer = '';
  let finished = false;
  try {
    for await (const data of child.stdout) {
      buffer += String(data);
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const raw = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (raw.length > MAX_DAEMON_LINE_CHARS) {
          child.kill('SIGKILL');
          throw new DeskError('output_too_large', 'desk output line too long');
        }
        const line = raw.trim();
        if (line.length > 0) {
          const decoded = decodeDaemonLine(line);
          finished = finished || decoded.done;
          yield decoded.chunk;
        }
        newline = buffer.indexOf('\n');
      }
      if (buffer.length > MAX_DAEMON_LINE_CHARS) {
        child.kill('SIGKILL');
        throw new DeskError('output_too_large', 'desk output line too long');
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  if (failure !== null) {
    throw new DeskError('jail_unavailable', `docker exec failed for ${name}`);
  }
  if (!finished) {
    throw new DeskError('tool_failed', 'the daemon closed without a result');
  }
}

function decodeResponse(line: string): typeof ResponseSchema.Type {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new DeskError('tool_failed', 'the daemon sent invalid JSON');
  }
  const decoded = Schema.decodeUnknownExit(ResponseSchema)(parsed);
  if (!Exit.isSuccess(decoded)) {
    throw new DeskError('tool_failed', 'the daemon sent an unknown response');
  }
  return decoded.value;
}

function decodeDaemonLine(line: string): { readonly chunk: DeskChunk; readonly done: boolean } {
  const response = decodeResponse(line);
  if ('stream' in response) {
    return { chunk: { type: response.stream, data: response.data }, done: false };
  }
  if ('error' in response) {
    throw new DeskError(response.error.code, response.error.message);
  }
  return {
    chunk: { type: 'exit', code: response.exit_code, truncated: response.truncated },
    done: true,
  };
}

export function createDockerLayer(
  settings: DockerSettings,
  exec: Exec = execFile,
  log: DockerLog = (message) => process.stderr.write(`desk-agent: ${message}\n`),
): DockerLayer {
  return {
    async create(name, spec, workspaceDir, proxyUrl) {
      let network = settings.network;
      if (network !== 'none') {
        try {
          network = await ensureDeskNetwork(name, exec);
        } catch (error) {
          log(
            `could not create network ${network} for ${name}; ` +
              `Docker's default address pool is full or the daemon refused: ${reason(error)}`,
          );
          throw error instanceof DeskError
            ? error
            : new DeskError('jail_unavailable', `could not create the network for ${name}`);
        }
      }
      let address: string | null = null;
      if (proxyUrl !== null) {
        const host = new URL(proxyUrl).hostname;
        if (network !== 'none') {
          address = await connectEgress(network, host, exec);
        }
        if (address === null) {
          // DESK_NETWORK is the proxy's own network; keep it as a fallback.
          address = await proxyAddress(settings.network, host, exec);
        }
        if (address === null) {
          log(
            `could not find ${host} on network ${network}; ` +
              `the jail for ${name} will have no web access`,
          );
        }
      }
      const args = createArgs(name, spec, workspaceDir, settings, proxyUrl, address, network);
      try {
        await exec('docker', args);
      } catch {
        throw new DeskError('jail_unavailable', `could not create the jail for ${name}`);
      }
    },
    async start(name) {
      try {
        await exec('docker', ['start', name]);
      } catch {
        throw new DeskError('jail_unavailable', `could not start the jail for ${name}`);
      }
    },
    async inspect(name) {
      try {
        const running = await exec('docker', ['inspect', '--format', '{{.State.Running}}', name]);
        return running.trim() === 'true';
      } catch {
        return false;
      }
    },
    run: readDaemon,
    async remove(name) {
      try {
        await exec('docker', ['rm', '-f', name]);
      } catch {
        // Already gone: stopping is idempotent.
      }
      if (settings.network !== 'none') {
        await removeDeskNetwork(name, exec);
      }
    },
    async listDeskNames() {
      const output = await exec('docker', [
        'ps',
        '--all',
        '--filter',
        `label=${DESK_LABEL}=1`,
        '--format',
        '{{.Names}}',
      ]);
      return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    },
    async cleanupNetworks() {
      if (settings.network === 'none') {
        return 0;
      }
      const names = await exec('docker', [
        'ps',
        '--all',
        '--filter',
        `label=${DESK_LABEL}=1`,
        '--format',
        '{{.Names}}',
      ]);
      return cleanupDeskNetworks(
        names
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
        exec,
      );
    },
    async runtimeAvailable() {
      if (settings.runtime === null) {
        return true;
      }
      try {
        const output = await exec('docker', ['info', '--format', '{{json .Runtimes}}']);
        const parsed: unknown = JSON.parse(output);
        return (
          typeof parsed === 'object' &&
          parsed !== null &&
          Object.prototype.hasOwnProperty.call(parsed, settings.runtime)
        );
      } catch {
        return false;
      }
    },
    async pullAndResolveDigest(ref) {
      try {
        await exec('docker', ['pull', ref]);
        const output = await exec('docker', [
          'image',
          'inspect',
          '--format',
          '{{index .RepoDigests 0}}',
          ref,
        ]);
        const digest = output.trim();
        return digest.includes('@sha256:') ? digest : null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Bridges a duplex socket to `docker exec -i … desk-tool serve`; the daemon's
 * request/response lines travel on the socket and the runner never parses them.
 */
export function bridgeDaemon(name: string, socket: net.Socket): void {
  const child = spawn(
    'docker',
    ['exec', '-i', '--user', 'desk', name, '/opt/desk/desk-tool', 'serve'],
    { stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const kill = (): void => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  };
  socket.pipe(child.stdin);
  child.stdout.pipe(socket);
  child.on('error', () => {
    socket.destroy();
  });
  child.on('exit', () => {
    if (!socket.destroyed) {
      socket.end();
    }
  });
  socket.on('close', kill);
  socket.on('error', kill);
}
