// effect-plain: wraps the docker CLI with a fixed argument list built in code.
// `execFile`/`spawn` only, never a shell; the sidecar never accepts a flag, an
// image or a command from the caller (plan §4.4).
import { execFile as execFileCallback, spawn } from 'node:child_process';
import type net from 'node:net';
import { Exit, Schema } from 'effect';
import type { DeskChunk, DeskSpec, DeskToolCall } from '../hands';
import { DeskError, ResponseSchema, type Request } from '../protocol';
import type { DockerSettings } from './config';

/** The only interface the lifecycle needs; tests swap in a fake. */
export interface DockerLayer {
  create(
    name: string,
    spec: DeskSpec,
    workspaceDir: string,
    proxyUrl: string | null,
  ): Promise<void>;
  start(name: string): Promise<void>;
  /** True when the named container exists and is running. */
  inspect(name: string): Promise<boolean>;
  run(name: string, call: DeskToolCall, signal?: AbortSignal): AsyncIterable<DeskChunk>;
  remove(name: string): Promise<void>;
  /** Every live desk container, so `Stop all` can kill them across restarts. */
  listDeskNames(): Promise<readonly string[]>;
  /** True when the configured runtime is registered with the docker daemon. */
  runtimeAvailable(): Promise<boolean>;
  /** Pulls `ref` and returns its repo digest, or null when either step fails. */
  pullAndResolveDigest(ref: string): Promise<string | null>;
}

export const DESK_LABEL = 'zilar.desk';

function execFile(command: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
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

/**
 * The daemon request for one tool call. `timeout_ms` rides in `args` because
 * that is where the daemon reads it; the daemon re-validates `args` itself.
 */
function daemonRequest(call: DeskToolCall): Request {
  const args =
    call.timeoutMs === undefined || typeof call.args !== 'object' || call.args === null
      ? call.args
      : { ...(call.args as Record<string, unknown>), timeout_ms: call.timeoutMs };
  return { id: 1, tool: call.tool, args };
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

/**
 * Finds the egress proxy's IPv4 on the jail network. gVisor's own network stack
 * cannot reach Docker's embedded DNS, so the proxy name is pinned in the jail's
 * /etc/hosts instead (the lead's live check, plan §4.4).
 */
export async function proxyAddress(network: string, host: string): Promise<string | null> {
  if (isIpv4Literal(host)) {
    return host;
  }
  try {
    const found = await execFile('docker', [
      'ps',
      '-q',
      '--filter',
      `network=${network}`,
      '--filter',
      `label=com.docker.compose.service=${host}`,
    ]);
    const id = found
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (id === undefined) {
      return null;
    }
    const output = await execFile('docker', [
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

/** The §4.2 run flags, fixed in code; only validated numbers come from the spec. */
export function createArgs(
  name: string,
  spec: DeskSpec,
  workspaceDir: string,
  settings: DockerSettings,
  proxyUrl: string | null,
  proxyAddress: string | null = null,
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
    settings.network,
    ...(proxyUrl !== null && proxyAddress !== null
      ? ['--add-host', `${new URL(proxyUrl).hostname}:${proxyAddress}`]
      : []),
    ...proxyFlags(proxyUrl),
    ...keepAliveFlags(spec.imageDigest),
  ];
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
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) {
          const decoded = decodeDaemonLine(line);
          finished = finished || decoded.done;
          yield decoded.chunk;
        }
        newline = buffer.indexOf('\n');
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

/** The real Docker layer: one `docker` CLI per operation, no shell. */
export function createDockerLayer(settings: DockerSettings): DockerLayer {
  return {
    async create(name, spec, workspaceDir, proxyUrl) {
      let address: string | null = null;
      if (proxyUrl !== null) {
        const host = new URL(proxyUrl).hostname;
        address = await proxyAddress(settings.network, host);
        if (address === null) {
          // A computer with no web still beats no computer; say why it has none.
          process.stderr.write(
            `desk-agent: could not find ${host} on network ${settings.network}; ` +
              `the jail for ${name} will have no web access\n`,
          );
        }
      }
      const args = createArgs(name, spec, workspaceDir, settings, proxyUrl, address);
      try {
        await execFile('docker', args);
      } catch {
        throw new DeskError('jail_unavailable', `could not create the jail for ${name}`);
      }
    },
    async start(name) {
      try {
        await execFile('docker', ['start', name]);
      } catch {
        throw new DeskError('jail_unavailable', `could not start the jail for ${name}`);
      }
    },
    async inspect(name) {
      try {
        const running = await execFile('docker', [
          'inspect',
          '--format',
          '{{.State.Running}}',
          name,
        ]);
        return running.trim() === 'true';
      } catch {
        return false;
      }
    },
    run: readDaemon,
    async remove(name) {
      try {
        await execFile('docker', ['rm', '-f', name]);
      } catch {
        // Already gone: stopping is idempotent.
      }
    },
    async listDeskNames() {
      const output = await execFile('docker', [
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
    async runtimeAvailable() {
      if (settings.runtime === null) {
        return true;
      }
      try {
        const output = await execFile('docker', ['info', '--format', '{{json .Runtimes}}']);
        const parsed: unknown = JSON.parse(output);
        return (
          typeof parsed === 'object' &&
          parsed !== null &&
          Object.prototype.hasOwnProperty.call(parsed, settings.runtime)
        );
      } catch {
        // The daemon is unreachable or answered something unexpected; not ready.
        return false;
      }
    },
    async pullAndResolveDigest(ref) {
      try {
        await execFile('docker', ['pull', ref]);
        const output = await execFile('docker', [
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
 * Bridges a duplex socket to `docker exec -i … desk-tool serve`. A runner uses
 * this instead of `readDaemon`: the daemon's request/response lines travel on
 * the socket (plan §2), and the runner never parses them.
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
