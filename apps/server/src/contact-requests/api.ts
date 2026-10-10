// Contact requests on the Effect `HttpApi` adapter (T-0515): the same
// methods, paths, statuses and bodies as the deleted router (`routes.ts`),
// mounted by the Effect edge (`apps/server/src/effect/edge.ts`). Its service
// runs on effect/sql.

import { Effect, Layer, Schema } from 'effect';
import { HttpServerRequest } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from 'effect/http-api';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { makeRateLimit } from '../effect/rate-limit-middleware';
import {
  Session,
  failureResponse,
  handler,
  mountApi,
  requestIdOf,
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

export const CONTACT_REQUEST_CREATE_RATE_LIMIT_MAX = 20;
export const CONTACT_REQUEST_CREATE_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const CONTACT_REQUEST_READ_RATE_LIMIT_MAX = 60;
export const CONTACT_REQUEST_READ_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const BY_HANDLE_RATE_LIMIT_MAX = 30;
export const BY_HANDLE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const ContactRequestStatus = Schema.Literals(['pending', 'accepted', 'declined', 'cancelled']);

// The JSON shape of a contact request row (`toJson` below). `decidedAt` is
// absent until the request is decided.
const ContactRequest = Schema.Struct({
  id: Schema.String,
  fromUserId: Schema.String,
  toUserId: Schema.String,
  status: ContactRequestStatus,
  createdAt: Schema.String,
  decidedAt: Schema.optional(Schema.String),
});

const ContactRequestResult = Schema.Struct({ request: ContactRequest });

// The create body: 1..64 characters. The payload decode is strict
// (`PayloadParseOptions` below) so an excess key is rejected.
const CreateContactRequestBody = Schema.Struct({
  handle: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});

// Two success statuses: 200 when the other side already asked
// (`incoming: true`), 201 for a new request. The 200 member comes first so an
// `incoming` value never falls through to the 201 member, which would strip it.
const ReverseContactRequestResult = Schema.Struct({
  request: ContactRequest,
  incoming: Schema.Literal(true),
});

const CreatedContactRequestResult = ContactRequestResult.pipe(HttpApiSchema.status(201));

const CreateContactRequestResult = [ReverseContactRequestResult, CreatedContactRequestResult];

const ContactRequestView = Schema.Struct({
  id: Schema.String,
  status: ContactRequestStatus,
  createdAt: Schema.String,
  other: Schema.Struct({
    userId: Schema.String,
    name: Schema.String,
    handle: Schema.NullOr(Schema.String),
    image: Schema.NullOr(Schema.String),
  }),
});

const ListContactRequestsResult = Schema.Struct({
  incoming: Schema.Array(ContactRequestView),
  outgoing: Schema.Array(ContactRequestView),
});

const ByHandleResult = Schema.Struct({
  userId: Schema.String,
  name: Schema.String,
  handle: Schema.String,
  image: Schema.NullOr(Schema.String),
  relation: Schema.Literals([
    'self',
    'blocked',
    'contact',
    'request_sent',
    'request_received',
    'none',
  ]),
});

// Applied to the group so a payload decode failure answers 400
// `invalid_request` with one fixed message. This module keeps its own copy
// because the shared `SchemaErrors` carries the schema's text instead.
class ContactRequestsSchemaErrors extends HttpApiMiddleware.Service<ContactRequestsSchemaErrors>()(
  'zilar/effect/http/ContactRequestsSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<ContactRequestsSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(ContactRequestsSchemaErrors, () =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(
          400,
          'invalid_request',
          'handle must be a string of 1 to 64 characters, with no other keys',
        ),
      );
    }),
  );
}

const RATE_LIMITED_MESSAGE = 'Too many attempts, try again later';

// Runs the create budget before the payload is decoded, exactly like the old
// route's `createLimiter.allow` -> `safeParse` order: an invalid body still
// spends budget.
const CreateRateLimit = makeRateLimit(
  'zilar/effect/http/ContactRequestCreateRateLimit',
  RATE_LIMITED_MESSAGE,
);

// The read budget covers list, accept, decline and cancel; it runs after the
// session and before the store call.
const ReadRateLimit = makeRateLimit(
  'zilar/effect/http/ContactRequestReadRateLimit',
  RATE_LIMITED_MESSAGE,
);

const ByHandleRateLimit = makeRateLimit(
  'zilar/effect/http/ContactRequestByHandleRateLimit',
  RATE_LIMITED_MESSAGE,
);

const RequestIdParams = Schema.Struct({ id: Schema.String });
const HandleParams = Schema.Struct({ handle: Schema.String });

const ContactRequestsGroup = HttpApiGroup.make('contactRequests')
  .add(
    HttpApiEndpoint.post('create', '/contact-requests', {
      payload: CreateContactRequestBody,
      success: CreateContactRequestResult,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(CreateRateLimit.Middleware),
    HttpApiEndpoint.get('list', '/contact-requests', {
      success: ListContactRequestsResult,
    }).middleware(ReadRateLimit.Middleware),
    HttpApiEndpoint.post('accept', '/contact-requests/:id/accept', {
      params: RequestIdParams,
      success: ContactRequestResult,
    }).middleware(ReadRateLimit.Middleware),
    HttpApiEndpoint.post('decline', '/contact-requests/:id/decline', {
      params: RequestIdParams,
      success: ContactRequestResult,
    }).middleware(ReadRateLimit.Middleware),
    HttpApiEndpoint.delete('cancel', '/contact-requests/:id', {
      params: RequestIdParams,
      success: ContactRequestResult,
    }).middleware(ReadRateLimit.Middleware),
    HttpApiEndpoint.get('byHandle', '/users/by-handle/:handle', {
      params: HandleParams,
      success: ByHandleResult,
    }).middleware(ByHandleRateLimit.Middleware),
  )
  .middleware(Session)
  .middleware(ContactRequestsSchemaErrors)
  // The edge forwards the full request path, so the router keeps the `/api` prefix.
  .prefix('/api');

const ContactRequestsApi = HttpApi.make('contactRequests').add(ContactRequestsGroup);

export interface ContactRequestsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  audit?: AuditRecorder;
  logger: Logger;
  /** Injected in tests so the rate windows can advance without waiting. */
  now?: () => number;
  createLimiter?: RateLimiter;
  readLimiter?: RateLimiter;
  byHandleLimiter?: RateLimiter;
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
      // Creates a pending request to the owner of `handle`. Unknown handles
      // answer the same 404 as retired ones. When the other side already asked,
      // answers 200 `{ request, incoming: true }` so the web can offer
      // "Accept"; otherwise 201 `{ request }`. Both statuses are declared on
      // the endpoint, so the handler returns the value and the schema picks
      // the status.
      .handle(
        'create',
        handler(logger, async (request, user) => {
          // The create budget was already charged by `CreateRateLimit`,
          // before the payload decode.
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
      // The viewer's pending requests: `{ incoming, outgoing }`, newest first.
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
      // Declines a request (recipient only). Not-actable and unknown ids
      // answer the same 404.
      .handle(
        'decline',
        handler(logger, async (request, user) => ({
          request: toJson(await declineContactRequest(service(), request.params.id, user.id)),
        })),
      )
      // Cancels a request (sender only). Not-actable and unknown ids answer
      // the same 404.
      .handle(
        'cancel',
        handler(logger, async (request, user) => ({
          request: toJson(await cancelContactRequest(service(), request.params.id, user.id)),
        })),
      )
      // Exact, case-insensitive handle lookup: `{ userId, name, handle, image,
      // relation }`. Unknown and retired handles answer the same 404. Never an
      // email.
      .handle(
        'byHandle',
        handler(logger, (request, user) => profileForHandle(db, user.id, request.params.handle)),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(ContactRequestsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
    Layer.provide(CreateRateLimit.layer(createLimiter)),
    Layer.provide(ReadRateLimit.layer(readLimiter)),
    Layer.provide(ByHandleRateLimit.layer(byHandleLimiter)),
  );

  return mountApi(ContactRequestsApi, apiLayer);
}
