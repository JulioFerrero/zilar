// effect-plain: the driver probe runs the docker CLI and parses two outputs;
// there is no Effect runtime in the runner process, so it is plain async.
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

/**
 * The isolation driver (plan §6.2). There is no unsandboxed mode: with no driver,
 * `desk.provision` answers `jail_unavailable`. Linux needs Docker with `runsc`;
 * macOS uses Docker Desktop or OrbStack's VM boundary; anything else refuses.
 */

export type DeskDriverKind = 'runsc' | 'docker-vm' | 'none';

export interface DeskDriver {
  readonly kind: DeskDriverKind;
  /** The runtime for `--runtime`, or null to leave the daemon default. */
  readonly dockerRuntime: string | null;
  readonly labels: readonly string[];
  /** A short reason for logs when the driver is `none`; never a secret. */
  readonly reason: string;
}

export type DriverProbe = (
  file: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>;

export interface DriverDeps {
  readonly platform: NodeJS.Platform;
  readonly execFile: DriverProbe;
}

const PROBE = { timeout: 3000, maxBuffer: 64 * 1024 };

const execFileProbe: DriverProbe = async (file, args, options) => {
  const result = await promisify(execFile)(file, [...args], options);
  return { stdout: typeof result.stdout === 'string' ? result.stdout : String(result.stdout) };
};

export function defaultDriverDeps(): DriverDeps {
  return { platform: os.platform(), execFile: execFileProbe };
}

async function hasDocker(deps: DriverDeps): Promise<boolean> {
  try {
    const { stdout } = await deps.execFile(
      'docker',
      ['version', '--format', '{{.Server.Version}}'],
      PROBE,
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function hasRunsc(deps: DriverDeps): Promise<boolean> {
  try {
    const { stdout } = await deps.execFile(
      'docker',
      ['info', '--format', '{{json .Runtimes}}'],
      PROBE,
    );
    return stdout.includes('runsc');
  } catch {
    return false;
  }
}

export async function detectDriver(deps: DriverDeps = defaultDriverDeps()): Promise<DeskDriver> {
  if (!(await hasDocker(deps))) {
    return { kind: 'none', dockerRuntime: null, labels: [], reason: 'docker is not available' };
  }
  if (deps.platform === 'darwin') {
    return { kind: 'docker-vm', dockerRuntime: null, labels: ['docker-vm'], reason: '' };
  }
  if (deps.platform === 'linux') {
    if (await hasRunsc(deps)) {
      return { kind: 'runsc', dockerRuntime: 'runsc', labels: ['docker', 'runsc'], reason: '' };
    }
    return {
      kind: 'none',
      dockerRuntime: null,
      labels: ['docker'],
      reason: 'the runsc runtime is not registered with docker',
    };
  }
  return {
    kind: 'none',
    dockerRuntime: null,
    labels: ['docker'],
    reason: `unsupported platform ${deps.platform}`,
  };
}
