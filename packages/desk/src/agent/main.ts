// effect-plain: the sidecar entry point; reads env config and runs the unix
// socket server plus the idle sweeper as a plain Node process.
import { pathToFileURL } from 'node:url';
import { Admission, readCgroupMemory } from './admission';
import { loadAgentConfig, type AgentConfig } from './config';
import { createDockerLayer, type DockerLayer } from './docker';
import { createEgressRegistrar, type EgressRegistrar } from './egress';
import { Lifecycle } from './lifecycle';
import { createAgentServer, type AgentServer } from './server';
import { createWorkspaces } from './workspace';

/** How often idle desks are checked (plan §4.2: stop after ~2 minutes idle). */
export const IDLE_SWEEP_MS = 30_000;

/**
 * The cap for stopping jails on shutdown. Docker's default stop grace period is
 * 10 s, so the sidecar must finish its cleanup well inside it.
 */
export const STOP_ALL_TIMEOUT_MS = 8_000;

/** The egress registrar, or null when the jail gets no web access (plan §5.1). */
function egressFor(config: AgentConfig): EgressRegistrar | null {
  return config.egress === null ? null : createEgressRegistrar(config.egress);
}

/**
 * Runs one idle sweep. A failing stop (e.g. a failing `umount`) must not become
 * an unhandled rejection that takes down the whole sidecar, so the failure is
 * logged and dropped.
 */
export function runIdleSweep(lifecycle: Lifecycle, log: (message: string) => void): void {
  void lifecycle.sweepIdle().catch((error: unknown) => {
    log(`idle sweep failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

export interface RunningAgent {
  readonly server: AgentServer;
  readonly lifecycle: Lifecycle;
  /** The Docker layer, so shutdown and start can see jails left behind. */
  readonly docker: DockerLayer;
  readonly config: AgentConfig;
}

/** Builds the sidecar from the environment and starts listening. */
export async function start(env: NodeJS.ProcessEnv = process.env): Promise<RunningAgent> {
  const config = loadAgentConfig(env);
  const admission = new Admission({
    maxRunning: config.maxRunning,
    memoryRatioLimit: config.memoryRatioLimit,
    pool: () => readCgroupMemory(config.poolCgroupPath),
  });
  const docker = createDockerLayer(config.docker);
  const lifecycle = new Lifecycle({
    docker,
    workspaces: createWorkspaces(config),
    admission,
    config,
    egress: egressFor(config),
    log: (message) => process.stderr.write(`desk-agent: ${message}\n`),
  });
  const server = createAgentServer(config, lifecycle);
  await server.listen();
  return { server, lifecycle, docker, config };
}

/**
 * Removes every jail this process or an earlier one left behind (a crash, or an
 * old agent without a shutdown sweep). The workspaces (images and folders) stay;
 * only containers go. Bounded by `STOP_ALL_TIMEOUT_MS` so a stuck Docker call
 * cannot outlive the stop grace period, and never rejects.
 */
async function stopAllJails(
  running: RunningAgent,
  log: (message: string) => void,
  reportIdle: boolean,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      (async () => {
        const names = await running.docker.listDeskNames();
        const failures = await running.lifecycle.stopAll();
        return { removed: names.length, failures, timedOut: false };
      })(),
      new Promise<{ removed: number; failures: number; timedOut: true }>((resolve) => {
        timer = setTimeout(
          () => resolve({ removed: 0, failures: 0, timedOut: true }),
          STOP_ALL_TIMEOUT_MS,
        );
      }),
    ]);
    if (outcome.timedOut) {
      log(`stopping jails timed out after ${STOP_ALL_TIMEOUT_MS / 1000}s`);
    } else if (reportIdle || outcome.removed > 0 || outcome.failures > 0) {
      log(`stopped ${outcome.removed} jail(s), ${outcome.failures} failed`);
    }
  } catch (error) {
    log(`stopping jails failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** `desk-agent`: runs until SIGTERM/SIGINT, then closes the socket. */
export async function main(): Promise<number> {
  const running = await start();
  const log = (message: string): void => {
    process.stderr.write(`desk-agent: ${message}\n`);
  };
  // A crash or an old agent without a shutdown sweep can leave jails behind;
  // they carry a dead proxy credential, so remove them before serving.
  await stopAllJails(running, log, false);
  // One log line per readiness change, never raw command output.
  let loggedReadiness: string | undefined;
  const pollReadiness = async (): Promise<void> => {
    try {
      await running.lifecycle.checkReadiness();
    } catch (error) {
      log(`readiness check failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const status = running.lifecycle.status();
    const key = status.ready ? 'ready' : (status.detail ?? 'ready');
    if (key === loggedReadiness) {
      return;
    }
    loggedReadiness = key;
    if (status.ready) {
      log(`ready (${status.imageDigest})`);
    } else if (status.detail === 'host_not_set_up') {
      log(`waiting for the ${running.config.docker.runtime ?? 'docker'} runtime`);
    } else {
      log('jail image not resolved, retrying');
    }
  };
  void pollReadiness();
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      runIdleSweep(running.lifecycle, log);
      void pollReadiness();
    }, IDLE_SWEEP_MS);
    const shutdown = (): void => {
      clearInterval(timer);
      // Remove this process's jails before the socket closes, bounded so Docker's
      // stop grace period is never exceeded and no jail outlives the deploy.
      void stopAllJails(running, log, true)
        .then(() => running.server.close())
        .then(() => resolve());
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  });
  return 0;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `desk-agent: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
