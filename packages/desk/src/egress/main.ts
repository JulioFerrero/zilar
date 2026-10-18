// effect-plain: the egress proxy entry point; reads env config and runs the TCP
// proxy plus the registry unix socket as a plain Node process.
import { pathToFileURL } from 'node:url';
import { EgressLog } from './log';
import { createEgressProxy, type EgressProxy } from './proxy';
import {
  createRegistryServer,
  DEFAULT_REGISTRY_SOCKET,
  DeskRegistry,
  type RegistryServer,
} from './registry';

/** The port the jails dial as `desk-egress:3128` (plan §5.1). */
export const DEFAULT_EGRESS_PORT = 3128;
export const DEFAULT_EGRESS_HOST = '0.0.0.0';

export interface EgressConfig {
  readonly port: number;
  readonly host: string;
  readonly registrySocket: string;
}

function portFromEnv(value: string | undefined): number {
  if (value === undefined || value === '') {
    return DEFAULT_EGRESS_PORT;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`invalid DESK_EGRESS_PORT: ${value}`);
  }
  return parsed;
}

export function loadEgressConfig(env: NodeJS.ProcessEnv): EgressConfig {
  return {
    port: portFromEnv(env.DESK_EGRESS_PORT),
    host:
      env.DESK_EGRESS_HOST === undefined || env.DESK_EGRESS_HOST === ''
        ? DEFAULT_EGRESS_HOST
        : env.DESK_EGRESS_HOST,
    registrySocket:
      env.DESK_EGRESS_REGISTRY === undefined || env.DESK_EGRESS_REGISTRY === ''
        ? DEFAULT_REGISTRY_SOCKET
        : env.DESK_EGRESS_REGISTRY,
  };
}

export interface RunningEgress {
  readonly proxy: EgressProxy;
  readonly registry: RegistryServer;
}

export async function start(env: NodeJS.ProcessEnv = process.env): Promise<RunningEgress> {
  const config = loadEgressConfig(env);
  const registry = new DeskRegistry();
  const log = new EgressLog();
  const registryServer = createRegistryServer(registry, config.registrySocket);
  const proxy = createEgressProxy({ registry, log });
  await registryServer.listen();
  try {
    await proxy.listen(config.port, config.host);
  } catch (error) {
    await registryServer.close();
    throw error;
  }
  return { proxy, registry: registryServer };
}

export async function main(): Promise<number> {
  const running = await start();
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      void running.proxy.close().then(() => running.registry.close().then(() => resolve()));
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
        `desk-egress: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
