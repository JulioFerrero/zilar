import type { ServerCore } from '../app/deps';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import type { HttpServerRequest } from 'effect/http';
import { ChatPrefsGroup, PutChatPrefPayload } from '@zilar/api-contract';
import { chatAccessFromParam } from '../chats/access';
import { HttpError } from '../errors';
import {
  handler,
  httpErrorResponse,
  mountGroups,
  requestIdOf,
  type EffectApiMount,
  type SessionUser,
} from '../effect/http-core';
import { limiter, type RateLimiter } from '../rate-limit';
import {
  getChatBackgroundDefault,
  listChatPrefs,
  putChatBackgroundDefault,
  putChatPref,
} from './service';
function parseMutedUntil(value: string | null | undefined): Date | null | undefined {
  if (value === undefined || value === null) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new HttpError(400, 'invalid_request', 'mutedUntil must be a valid date and time');
  return date;
}
type PutPrefRequest = {
  params: { chatJid: string };
  payload: typeof PutChatPrefPayload.Type;
  request: HttpServerRequest.HttpServerRequest;
};
function withChatAccess(deps: ChatPrefsApiDependencies, limit: RateLimiter) {
  return handler(deps.logger, async (request: PutPrefRequest, user: SessionUser) => {
    const { bare } = await chatAccessFromParam(deps, request.params.chatJid, user.id);
    if (!limit.allow(user.id))
      return httpErrorResponse(
        requestIdOf(request.request),
        new HttpError(429, 'rate_limited', 'Too many preference changes, try again later'),
      );
    const pref = await putChatPref(deps.db, {
      userId: user.id,
      bare,
      ...request.payload,
      mutedUntil: parseMutedUntil(request.payload.mutedUntil),
      now: new Date((deps.now ?? Date.now)()),
    });
    return pref === null ? { prefs: null } : pref;
  });
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
  const writeLimit = limiter('chatPrefsWrite', now);
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
      .handle('putPref', withChatAccess(deps, writeLimit))
      .handle(
        'getBackground',
        handler(logger, async (_request, user) => ({
          defaultBackground: await getChatBackgroundDefault(deps.db, user.id),
        })),
      )
      .handle(
        'putBackground',
        handler(
          logger,
          async (request, user) => ({
            defaultBackground: await putChatBackgroundDefault(deps.db, user.id, {
              ...request.payload,
              now: new Date(now()),
            }),
          }),
          { limit: writeLimit, limitMessage: 'Too many preference changes, try again later' },
        ),
      ),
  );
  return mountGroups(ChatPrefsApi, groupLayer, { auth: deps.auth, logger, schemaErrors: true });
}
