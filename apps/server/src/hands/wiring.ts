import type { Logger } from 'pino';
import type { ServerConfig } from '../config/load';
import { createCloudHands, type Hands } from './cloud-hands';
import { createDeskProbe, type DeskProbe } from './desk-status';

export function buildHands(config: ServerConfig): Hands {
  return createCloudHands(config.DESK_AGENT_SOCKET);
}

/**
 * The cached read-only probe: returns a `DeskClient` only when the agent answers ready
 * with a pinned image; `null` covers a stopped or old agent.
 */
export function buildDeskProbe(config: ServerConfig, logger: Logger): DeskProbe {
  return createDeskProbe({
    socketPath: config.DESK_AGENT_SOCKET,
    hands: buildHands(config),
    ...(config.DESK_IMAGE === undefined ? {} : { overrideImage: config.DESK_IMAGE }),
    logger,
  });
}
