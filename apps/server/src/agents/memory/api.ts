// The AI-memory routes on the Effect `HttpApi` adapter (T-0533): the same
// methods, paths, limiter order, status codes and bodies as the deleted
// router (`routes.ts`), mounted by the Effect edge (`apps/server/src/effect/edge.ts`).
// A DM is visible to and changeable by the AI's owner only; a room is visible
// to everyone who can see it and changeable by the AI's owner and the topic
// managers. Text is never logged.

import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { AiMemoryGroup, AiMemoryWriteRateLimit } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { Auth } from '../../auth/auth';
import type { ServerConfig } from '../../config';
import type { ServerDatabase } from '../../db/client';
import { runSql } from '../../effect/sql';
import { HttpError } from '../../errors';
import { createRateLimiter } from '../../rate-limit';
import { resolvePinChat } from '../../pins/access';
import { canManageTopic } from '../../topics/access';
import { jidFor, localpartFor } from '../../xmpp/provisioning';
import {
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../../effect/http-core';
import { rateLimitLayer } from '../../effect/rate-limit-middleware';
import { clearMemory, deleteFact, listFacts, renderMemoryBlock } from './store';

export const AI_MEMORY_WRITE_RATE_LIMIT_MAX = 60;
export const AI_MEMORY_WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface AiMemoryApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
  logger: Logger;
}

export interface ResolvedMemoryChat {
  aiId: string;
  chatKey: string;
  canChange: boolean;
}

interface AiOwnerLookupRow {
  id: string;
  owner: string;
  jid: string;
}

// The same 404 as for an unknown chat or an unknown AI, so neither can be
// probed.
function toMissingMemoryChat(): HttpError {
  return new HttpError(404, 'not_found', 'Chat not found');
}

function toForbiddenChange(): HttpError {
  return new HttpError(
    403,
    'forbidden',
    'Only the AI owner or a room admin can change this memory',
  );
}

// Resolves the `chat` and `ai` parameters to the stored `chat_key`, the AI id
// and whether the caller may change the memory. An unknown AI, a chat the
// caller may not see, a DM the caller does not own, or any other host all
// answer the same 404.
export async function resolveMemoryChat(
  db: ServerDatabase,
  config: ServerConfig,
  userId: string,
  chat: string,
  aiId: string,
): Promise<ResolvedMemoryChat> {
  const [ai] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiOwnerLookupRow>`SELECT id, owner, jid FROM ais WHERE id = ${aiId} LIMIT 1`;
    }),
  );
  if (!ai) {
    throw toMissingMemoryChat();
  }

  const domain = config.xmpp.domain.toLowerCase();
  const mucDomain = config.xmpp.mucDomain.toLowerCase();
  const bare = (chat.split('/')[0] ?? '').toLowerCase();
  const at = bare.indexOf('@');
  const host = at <= 0 ? '' : bare.slice(at + 1);

  if (host === domain) {
    if (ai.owner !== userId || bare !== ai.jid.toLowerCase()) {
      throw toMissingMemoryChat();
    }
    return {
      aiId: ai.id,
      chatKey: `dm:${jidFor(localpartFor(userId), config.xmpp.domain).toLowerCase()}`,
      canChange: true,
    };
  }

  if (host === mucDomain) {
    const resolved = await resolvePinChat(db, {
      chatJid: chat,
      userId,
      domain: config.xmpp.domain,
      mucDomain: config.xmpp.mucDomain,
    });
    if (resolved.kind !== 'room') {
      throw toMissingMemoryChat();
    }
    const canChange = ai.owner === userId || (await canManageTopic(db, resolved.topic, userId));
    return { aiId: ai.id, chatKey: `room:${resolved.chatJid}`, canChange };
  }

  throw toMissingMemoryChat();
}

const AiMemoryApi = HttpApi.make('aiMemory').add(AiMemoryGroup);

export function createAiMemoryApi(deps: AiMemoryApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const logger = deps.logger;
  const writeLimiter = createRateLimiter({
    max: AI_MEMORY_WRITE_RATE_LIMIT_MAX,
    windowMs: AI_MEMORY_WRITE_RATE_LIMIT_WINDOW_MS,
    now,
  });

  const groupLayer = HttpApiBuilder.group(AiMemoryApi, 'aiMemory', (handlers) =>
    handlers
      // The facts and cover lines of one chat; everyone who can see the chat
      // may read them.
      .handle(
        'view',
        handler(logger, async (request, user) => {
          const resolved = await resolveMemoryChat(
            deps.db,
            deps.config,
            user.id,
            request.query.chat,
            request.query.ai,
          );
          const [facts, lines] = await Promise.all([
            listFacts(deps.db, resolved.aiId, resolved.chatKey),
            renderMemoryBlock(deps.db, resolved.aiId, resolved.chatKey),
          ]);
          return { facts, lines, canChange: resolved.canChange };
        }),
      )
      // Deletes one fact; only the AI owner or a room manager may.
      .handle(
        'deleteFact',
        handler(logger, async (request, user) => {
          const resolved = await resolveMemoryChat(
            deps.db,
            deps.config,
            user.id,
            request.query.chat,
            request.query.ai,
          );
          if (!resolved.canChange) {
            throw toForbiddenChange();
          }
          const removed = await deleteFact(
            deps.db,
            resolved.aiId,
            resolved.chatKey,
            request.params.id,
          );
          if (!removed) {
            throw new HttpError(404, 'not_found', 'Fact not found');
          }
          return { ok: true };
        }),
      )
      // Clears the memory; only the AI owner or a room manager may.
      .handle(
        'clear',
        handler(logger, async (request, user) => {
          const resolved = await resolveMemoryChat(
            deps.db,
            deps.config,
            user.id,
            request.payload.chat,
            request.payload.ai,
          );
          if (!resolved.canChange) {
            throw toForbiddenChange();
          }
          await clearMemory(deps.db, resolved.aiId, resolved.chatKey);
          return { ok: true };
        }),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(AiMemoryApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
    // The write budget runs before the query or body is decoded: an invalid
    // request still spends budget.
    Layer.provide(
      rateLimitLayer(
        AiMemoryWriteRateLimit,
        writeLimiter,
        'Too many memory changes, try again later',
      ),
    ),
  );

  return mountApi(AiMemoryApi, apiLayer);
}
