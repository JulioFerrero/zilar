import { Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import {
  ContactRequestByHandleRateLimit,
  ContactRequestCreateRateLimit,
  ContactRequestReadRateLimit,
  ContactRequestsGroup,
  ContactRequestsSchemaErrors,
  UserSearchRateLimit,
} from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerConfig } from '../config/load';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import {
  handler,
  mountApi,
  schemaErrorLayerFor,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import {
  acceptContactRequest,
  cancelContactRequest,
  createContactRequest,
  declineContactRequest,
  listContactRequests,
  profileForHandle,
  type ContactRequestRow,
  type ContactRequestsDeps,
} from './service';
import { searchUsers } from './search';

export const CONTACT_REQUEST_CREATE_RATE_LIMIT_MAX = 20;
export const CONTACT_REQUEST_CREATE_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const CONTACT_REQUEST_READ_RATE_LIMIT_MAX = 60;
export const CONTACT_REQUEST_READ_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const BY_HANDLE_RATE_LIMIT_MAX = 30;
export const BY_HANDLE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const USER_SEARCH_RATE_LIMIT_MAX = 120;
export const USER_SEARCH_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const RATE_LIMITED_MESSAGE = 'Too many attempts, try again later';

const ContactRequestsApi = HttpApi.make('contactRequests').add(ContactRequestsGroup);

export interface ContactRequestsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  audit?: AuditRecorder;
  logger: Logger;
  now?: () => number;
  createLimiter?: RateLimiter;
  readLimiter?: RateLimiter;
  byHandleLimiter?: RateLimiter;
  userSearchLimiter?: RateLimiter;
}

function toJson(row: ContactRequestRow) {
  return {
    id: row.id,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
  };
}

export function createContactRequestsApi(deps: ContactRequestsApiDependencies): EffectApiMount {
  const now = deps.now ?? Date.now;
  const db = deps.db;
  const logger = deps.logger;
  const createLimiter =
    deps.createLimiter ??
    createRateLimiter({
      max: CONTACT_REQUEST_CREATE_RATE_LIMIT_MAX,
      windowMs: CONTACT_REQUEST_CREATE_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const readLimiter =
    deps.readLimiter ??
    createRateLimiter({
      max: CONTACT_REQUEST_READ_RATE_LIMIT_MAX,
      windowMs: CONTACT_REQUEST_READ_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const byHandleLimiter =
    deps.byHandleLimiter ??
    createRateLimiter({
      max: BY_HANDLE_RATE_LIMIT_MAX,
      windowMs: BY_HANDLE_RATE_LIMIT_WINDOW_MS,
      now,
    });
  const userSearchLimiter =
    deps.userSearchLimiter ??
    createRateLimiter({
      max: USER_SEARCH_RATE_LIMIT_MAX,
      windowMs: USER_SEARCH_RATE_LIMIT_WINDOW_MS,
      now,
    });

  function service(): ContactRequestsDeps {
    return {
      db,
      ...(deps.audit === undefined ? {} : { audit: deps.audit }),
      adminClient: deps.adminClient,
      domain: deps.config.xmpp.domain,
    };
  }

  const groupLayer = HttpApiBuilder.group(ContactRequestsApi, 'contactRequests', (handlers) =>
    handlers
      // Unknown handles answer the same 404 as retired ones. A reverse pending
      // request answers 200 with `incoming: true`, so the web can offer "Accept".
      .handle(
        'create',
        handler(logger, async (request, user) => {
          const { request: created, reverseOf } = await createContactRequest(
            service(),
            user.id,
            request.payload.handle,
          );
          if (reverseOf) {
            return { request: toJson(reverseOf), incoming: true as const };
          }
          return { request: toJson(created) };
        }),
      )
      .handle(
        'list',
        handler(logger, (_request, user) => listContactRequests(service(), user.id)),
      )
      // Accepts a request (recipient only). Idempotent and repairing.
      .handle(
        'accept',
        handler(logger, async (request, user) => ({
          request: toJson(await acceptContactRequest(service(), request.params.id, user.id)),
        })),
      )
      // Recipient only; not-actable and unknown ids answer the same 404.
      .handle(
        'decline',
        handler(logger, async (request, user) => ({
          request: toJson(await declineContactRequest(service(), request.params.id, user.id)),
        })),
      )
      // Sender only; not-actable and unknown ids answer the same 404.
      .handle(
        'cancel',
        handler(logger, async (request, user) => ({
          request: toJson(await cancelContactRequest(service(), request.params.id, user.id)),
        })),
      )
      // Exact, case-insensitive handle lookup. Unknown and retired handles answer
      // the same 404. Never an email.
      .handle(
        'byHandle',
        handler(logger, (request, user) => profileForHandle(db, user.id, request.params.handle)),
      )
      // Prefix search by `@username` only, up to 10 people. The query is never
      // logged.
      .handle(
        'search',
        handler(logger, async (request, user) => ({
          entries: await searchUsers(db, user.id, request.query.q),
        })),
      ),
  );

  // The create budget runs before the payload is decoded, so an invalid body
  // still spends it. The read budget covers list, accept, decline and cancel.
  const apiLayer = HttpApiBuilder.layer(ContactRequestsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(
      schemaErrorLayerFor(
        ContactRequestsSchemaErrors,
        logger,
        'handle must be a string of 1 to 64 characters, with no other keys',
      ),
    ),
    Layer.provide(
      rateLimitLayer(ContactRequestCreateRateLimit, createLimiter, RATE_LIMITED_MESSAGE),
    ),
    Layer.provide(rateLimitLayer(ContactRequestReadRateLimit, readLimiter, RATE_LIMITED_MESSAGE)),
    Layer.provide(
      rateLimitLayer(ContactRequestByHandleRateLimit, byHandleLimiter, RATE_LIMITED_MESSAGE),
    ),
    Layer.provide(rateLimitLayer(UserSearchRateLimit, userSearchLimiter, RATE_LIMITED_MESSAGE)),
  );

  return mountApi(ContactRequestsApi, apiLayer);
}
