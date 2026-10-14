// effect-plain: the sidecar entry point; reads env config and runs the unix
// socket server plus the idle sweeper as a plain Node process.
import { pathToFileURL } from 'node:url';
import { Admission, readCgroupMemory } from './admission';
import { loadAgentConfig, type AgentConfig } from './config';
import { createDockerLayer } from './docker';
import { createEgressRegistrar, type EgressRegistrar } from './egress';
import { Lifecycle } from './lifecycle';
import { createAgentServer, type AgentServer } from './server';
import { createWorkspaces } from './workspace';

/** How often idle desks are checked (plan §4.2: stop after ~2 minutes idle). */
export const IDLE_SWEEP_MS = 30_000;

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
}

/** Builds the sidecar from the environment and starts listening. */
export async function start(env: NodeJS.ProcessEnv = process.env): Promise<RunningAgent> {
  const config = loadAgentConfig(env);
  const admission = new Admission({
    maxRunning: config.maxRunning,
    memoryRatioLimit: config.memoryRatioLimit,
    pool: () => readCgroupMemory(config.poolCgroupPath),
  });
  const lifecycle = new Lifecycle({
    docker: createDockerLayer(config.docker),
    workspaces: createWorkspaces(config),
    admission,
    config,
    egress: egressFor(config),
    log: (message) => process.stderr.write(`desk-agent: ${message}\n`),
  });
  const server = createAgentServer(config, lifecycle);
  await server.listen();
  return { server, lifecycle };
}

/** `desk-agent`: runs until SIGTERM/SIGINT, then closes the socket. */
export async function main(): Promise<number> {
  const running = await start();
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      runIdleSweep(running.lifecycle, (message) => {
        process.stderr.write(`desk-agent: ${message}\n`);
      });
    }, IDLE_SWEEP_MS);
    const shutdown = (): void => {
      clearInterval(timer);
      void running.server.close().then(() => resolve());
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
