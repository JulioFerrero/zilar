import type { Logger } from 'pino';
import type { DeskClient } from '../agents/gateway/desk-exec';
import type { ServerConfig } from '../config';
import { createCloudHands, type Hands } from './cloud-hands';

/**
 * The cloud `Hands` adapter, built only when `DESK_AGENT_SOCKET` is set.
 */
export function buildHands(config: ServerConfig): Hands | null {
  return config.DESK_AGENT_SOCKET === undefined ? null : createCloudHands(config.DESK_AGENT_SOCKET);
}

/**
 * T-1418: the gateway's desk client, built only when the sidecar socket and the
 * pinned image are both configured. It logs once at start-up (ids only) why
 * desks are off, so a default install behaves as today.
 */
export function buildDeskClient(config: ServerConfig, logger: Logger): DeskClient | null {
  const hands = buildHands(config);
  if (hands === null) {
    logger.info('desks: off (DESK_AGENT_SOCKET unset)');
    return null;
  }
  const imageDigest = config.DESK_IMAGE;
  if (imageDigest === undefined) {
    logger.info('desks: off (DESK_IMAGE unset)');
    return null;
  }
  logger.info({ imageDigest }, 'desks: on');
  return { hands, imageDigest };
}
