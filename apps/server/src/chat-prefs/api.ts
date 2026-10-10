// Chat preferences on the Effect `HttpApi` adapter (T-0520): the same methods,
// paths, limiter order and answers as the deleted router (`routes.ts`),
// mounted by the Effect edge (`apps/server/src/effect/edge.ts`). Its service
// runs on effect/sql.
//
// The schemas and the group live in the shared contract (`@zilar/api-contract`,
// T-0892); this file keeps the handlers and layers.

import { Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import type { Logger } from 'pino';
import { ChatPrefsGroup } from '@zilar/api-contract';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import {
  handler,
  httpErrorResponse,
  mountApi,
  requestIdOf,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import {
  getChatBackgroundDefault,
  listChatPrefs,
  putChatBackgroundDefault,
  putChatPref,
  requireChatAccess,
} from './service';

export const CHAT_PREFS_WRITE_RATE_LIMIT_MAX = 60;
export const CHAT_PREFS_WRITE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

// A malformed percent escape is an unknown chat (404), not a server error.
function decodePathJid(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(404, 'not_found', 'Chat not found');
  }
}

function parseMutedUntil(value: string | null | undefined): Date | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'invalid_request', 'mutedUntil must be a valid date and time');
  }
  return date;
}

function tooManyChanges(): HttpError {
  return new HttpError(429, 'rate_limited', 'Too many preference changes, try again later');
}

const ChatPrefsApi = HttpApi.make('chatPrefs').add(ChatPrefsGroup);

export interface ChatPrefsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
  logger: Logger;
}

export function createChatPrefsApi(deps: ChatPrefsApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const logger = deps.logger;
  const writeLimiter = createRateLimiter({
    max: CHAT_PREFS_WRITE_RATE_LIMIT_MAX,
    windowMs: CHAT_PREFS_WRITE_RATE_LIMIT_WINDOW_MS,
    now,
  });

  const groupLayer = HttpApiBuilder.group(ChatPrefsApi, 'chatPrefs', (handlers) =>
    handlers
      .handle(
        'list',
        handler(logger, async (_request, user) => {
          const [prefs, defaultBackground] = await Promise.all([
            listChatPrefs(deps.db, user.id),
            getChatBackgroundDefault(deps.db, user.id),
          ]);
          return { prefs, defaultBackground };
        }),
      )
      // Partial update of one pref row. The session runs first, then the body
      // is decoded, then access is checked, then the write budget is charged.
      .handle(
        'putPref',
        handler(logger, async (request, user) => {
          const chatJid = decodePathJid(request.params.chatJid);
          const { bare } = await requireChatAccess(deps.db, {
            chatJid,
            userId: user.id,
            domain: deps.config.xmpp.domain,
            mucDomain: deps.config.xmpp.mucDomain,
          });
          if (!writeLimiter.allow(user.id)) {
            return httpErrorResponse(requestIdOf(request.request), tooManyChanges());
          }
          const mutedUntil = parseMutedUntil(request.payload.mutedUntil);
          const pref = await putChatPref(deps.db, {
            userId: user.id,
            bare,
            mutedUntil,
            archived: request.payload.archived,
            pinned: request.payload.pinned,
            backgroundPreset: request.payload.backgroundPreset,
            backgroundImageId: request.payload.backgroundImageId,
            backgroundDim: request.payload.backgroundDim,
            now: new Date(now()),
          });
          // A row back at all defaults is deleted, not kept: the client drops it.
          return pref === null ? { prefs: null } : pref;
        }),
      )
      .handle(
        'getBackground',
        handler(logger, async (_request, user) => ({
          defaultBackground: await getChatBackgroundDefault(deps.db, user.id),
        })),
      )
      .handle(
        'putBackground',
        handler(logger, async (request, user) => {
          if (!writeLimiter.allow(user.id)) {
            return httpErrorResponse(requestIdOf(request.request), tooManyChanges());
          }
          const defaultBackground = await putChatBackgroundDefault(deps.db, user.id, {
            backgroundPreset: request.payload.backgroundPreset,
            backgroundImageId: request.payload.backgroundImageId,
            backgroundDim: request.payload.backgroundDim,
            now: new Date(now()),
          });
          return { defaultBackground };
        }),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(ChatPrefsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(ChatPrefsApi, apiLayer);
}
