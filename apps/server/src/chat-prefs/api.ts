import type { ServerCore } from '../app/deps';

import { HttpApi, HttpApiBuilder } from 'effect/http-api';

import { ChatPrefsGroup } from '@zilar/api-contract';

import { HttpError } from '../errors';
import { decodeChatJid } from '../chats/api';
import { limiter } from '../rate-limit';
import {
  mountGroups,
  handler,
  withLimit,
  httpErrorResponse,
  requestIdOf,
  type EffectApiMount,
} from '../effect/http-core';
import {
  getChatBackgroundDefault,
  listChatPrefs,
  putChatBackgroundDefault,
  putChatPref,
} from './service';
import { requireChatAccess } from './access';

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

export interface ChatPrefsApiDependencies extends Pick<
  ServerCore,
  'auth' | 'db' | 'config' | 'logger'
> {
  now?: () => number;
}

export function createChatPrefsApi(deps: ChatPrefsApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const logger = deps.logger;
  const writeLimiter = limiter('chatPrefsWrite', now);
  const limited = withLimit(logger, writeLimiter, 'Too many preference changes, try again later');

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
      // Session, body decode, access check, then the write budget.
      .handle(
        'putPref',
        handler(logger, async (request, user) => {
          const chatJid = decodeChatJid(request.params.chatJid);
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
            unreadMark: request.payload.unreadMark,
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
        limited(async (request, user) => {
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

  return mountGroups(ChatPrefsApi, groupLayer, {
    auth: deps.auth,
    logger,
    schemaErrors: true,
  });
}
