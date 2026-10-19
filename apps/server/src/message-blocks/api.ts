// The route a member's tap on a card reaches: records the answer, merges the card
// and corrects it in the room as the AI. It never wakes the AI, so it never
// touches the turn queue.

import type { ServerCore } from '../app/deps';

import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { BlocksRespondRateLimit, MessageBlocksGroup } from '@zilar/api-contract';

import type { AuditRecorder } from '../audit/recorder';

import { mountGroups, handler, type EffectApiMount } from '../effect/http-core';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import { limiter, type RateLimiter } from '../rate-limit';
import { respondToCard, myPicks, type CorrectCardInput } from './respond';

/** The one live-gateway call this module needs; no XMPP types leak here. */
export interface CardCorrector {
  correctInRoom: (input: CorrectCardInput) => Promise<boolean>;
}

// A gateway double without the hook reads as "no gateway".
export function cardCorrectorOf(gateway: unknown): CardCorrector | null {
  if (typeof gateway !== 'object' || gateway === null || !('correctInRoom' in gateway)) {
    return null;
  }
  const correct = gateway.correctInRoom;
  if (typeof correct !== 'function') {
    return null;
  }
  return {
    correctInRoom: (input) =>
      (correct as (value: CorrectCardInput) => Promise<boolean>).call(gateway, input),
  };
}

const MessageBlocksApi = HttpApi.make('message-blocks').add(MessageBlocksGroup);

export interface MessageBlocksApiDependencies extends Pick<ServerCore, 'auth' | 'db' | 'logger'> {
  /** The live gateway, read lazily: the app is built before the gateway. */
  getGateway?: () => CardCorrector | null;
  now?: () => number;
  respondLimiter?: RateLimiter;
  audit?: AuditRecorder;
}

export function createMessageBlocksApi(deps: MessageBlocksApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const respondLimiter = deps.respondLimiter ?? limiter('blocksRespond', deps.now ?? Date.now);

  const groupLayer = HttpApiBuilder.group(MessageBlocksApi, 'message-blocks', (handlers) =>
    handlers
      .handle(
        'respond',
        handler(logger, (request, user) => {
          const corrector = deps.getGateway?.() ?? null;
          return respondToCard(
            {
              db: deps.db,
              logger,
              ...(corrector === null ? {} : { correctInRoom: corrector.correctInRoom }),
              ...(deps.audit === undefined ? {} : { audit: deps.audit }),
            },
            user.id,
            request.payload,
          );
        }),
      )
      .handle(
        'mine',
        handler(logger, (request, user) => myPicks(deps.db, user.id, request.query.messageId)),
      ),
  );

  return mountGroups(MessageBlocksApi, groupLayer, {
    auth: deps.auth,
    logger,
    // Every answer writes a row and corrects the card, so it is capped per user
    // before the payload is decoded.
    extra: rateLimitLayer(
      BlocksRespondRateLimit,
      respondLimiter,
      'Too many card answers, try again later',
    ),
    schemaErrors: true,
  });
}
