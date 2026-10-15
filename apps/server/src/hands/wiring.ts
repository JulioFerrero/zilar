import type { Logger } from 'pino';
import type { ServerConfig } from '../config';
import { createCloudHands, type Hands } from './cloud-hands';
import { createDeskProbe, type DeskProbe } from './desk-status';

/** The cloud `Hands` adapter over the desk agent's socket (always buildable:
 * the socket path has a default, so the server never guesses from env). */
export function buildHands(config: ServerConfig): Hands {
  return createCloudHands(config.DESK_AGENT_SOCKET);
}

/**
 * T-1603: the cached read-only probe the gateway and the AI routes ask whether
 * Zilar cloud desks are ready. It returns a `DeskClient` only when the agent
 * answers ready with a pinned image; `null` covers a stopped or old agent and
 * `DESK_IMAGE` remains the image override for an old agent.
 */
export function buildDeskProbe(config: ServerConfig, logger: Logger): DeskProbe {
  return createDeskProbe({
    socketPath: config.DESK_AGENT_SOCKET,
    hands: buildHands(config),
    ...(config.DESK_IMAGE === undefined ? {} : { overrideImage: config.DESK_IMAGE }),
    logger,
  });
}
