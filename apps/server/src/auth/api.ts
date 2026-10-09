// Auth module on the Effect `HttpApi` adapter (T-0561): the same methods,
// paths, statuses, bodies and texts as the deleted Hono router
// (`routes.ts`), mounted under Hono by `apps/server/src/effect/http.ts`.
// Handlers keep calling the drizzle services and Better Auth's API; the DB
// rewrite is a separate lane.
//
// The name decode runs manually inside the PATCH handler (Effect Schema,
// same rules as the old zod schema) instead of as an endpoint payload, so
// the route keeps its exact order: session -> raw body -> decode ->
// `updateUser` -> session read again -> roster refresh. No decode text
// changes: every failure answers byte-identical codes and messages.

import { Effect, Exit, Layer, Schema, SchemaIssue } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import { HttpServer, HttpServerRequest, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import type { Logger } from 'pino';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import type { ServerConfig } from '../config';
import { refreshRosterNicknames } from '../contacts/service';
import type { ServerDatabase } from '../db/client';
import { sqlRuntimeFor } from '../effect/sql';
import {
  CurrentUser,
  Session,
  failureResponse,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http-core';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { findXmppAccount } from '../xmpp/provisioning';
import type { Auth } from './auth';
import { createInvite, findInviteByCode, findUsableInvite, revokeInvite } from './invites';

export interface AuthApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: Logger;
}

const CONTROL_CHAR_MAX = 0x1f;
const CONTROL_CHAR_DEL = 0x7f;

function runSql<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

interface HandleLookupRow {
  handle: string;
}

interface SessionUserLookupRow {
  id: string;
  email: string;
  name: string;
  image: string | null;
  createdAt: Date;
}

function isControlCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code <= CONTROL_CHAR_MAX || code === CONTROL_CHAR_DEL;
}

// Replaces `displayNameSchema` (zod): trimmed, 1..64 characters, with the
// same three messages. `isMinLength`/`isMaxLength` carry them as `message`
// annotations, and the control-character filter returns its own string.
const DisplayName = Schema.Trim.pipe(
  Schema.check(
    Schema.isMinLength(1, { message: 'name must not be empty' }),
    Schema.isMaxLength(64, { message: 'name must be at most 64 characters' }),
    Schema.makeFilter((value: string) =>
      [...value].every((character) => !isControlCharacter(character))
        ? undefined
        : 'name must not contain control characters',
    ),
  ),
);

// Replaces `updateMeSchema` (zod), non-strict: unknown keys are stripped.
const UpdateMeBody = Schema.Struct({ name: DisplayName });

// The first decode message, like the old `parsed.error.issues[0]?.message`.
// Walks the issue tree depth-first: a filter that returned a string carries
// it on the `InvalidValue` message annotation (the control-character case).
// In Effect v4 the `{ message }` option on `isMinLength`/`isMaxLength` does
// NOT reach those annotations, but the `SchemaError.message` first line
// already carries the exact text (empty / overlong names). A missing key or
// a non-string name falls back to `Invalid name`.
const NAME_MESSAGES = new Set([
  'name must not be empty',
  'name must be at most 64 characters',
  'name must not contain control characters',
]);
function firstIssueMessage(issue: SchemaIssue.Issue): string | undefined {
  switch (issue._tag) {
    case 'Composite':
    case 'AnyOf':
      for (const child of issue.issues) {
        const message = firstIssueMessage(child);
        if (message !== undefined) {
          return message;
        }
      }
      return undefined;
    case 'Pointer':
    case 'Filter':
    case 'Encoding':
      return firstIssueMessage(issue.issue);
    case 'InvalidValue': {
      const message = issue.annotations?.message;
      return typeof message === 'string' && message.length > 0 ? message : undefined;
    }
    default:
      return undefined;
  }
}

function updateMeMessage(body: unknown): string {
  const exit = Schema.decodeUnknownExit(UpdateMeBody, { errors: 'all' })(body);
  if (Exit.isSuccess(exit)) {
    return 'Invalid name';
  }
  for (const reason of exit.cause.reasons) {
    if (reason._tag === 'Fail') {
      const firstLine = reason.error.message.split('\n')[0]?.trim();
      if (firstLine !== undefined && NAME_MESSAGES.has(firstLine)) {
        return firstLine;
      }
      return firstIssueMessage(reason.error.issue) ?? 'Invalid name';
    }
  }
  return 'Invalid name';
}

const MeView = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  image: Schema.NullOr(Schema.String),
  avatarUrl: Schema.optional(Schema.String),
  handle: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  jid: Schema.NullOr(Schema.String),
});

const PatchMeView = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  image: Schema.NullOr(Schema.String),
});

const InviteView = Schema.Struct({
  code: Schema.String,
  url: Schema.String,
  expiresAt: Schema.Date,
});

const InviteCheckView = Schema.Struct({ valid: Schema.Boolean });

const InviteParams = Schema.Struct({ code: Schema.String });

const RevokedView = Schema.Struct({ revoked: Schema.Boolean });

// A body or params decode failure renders like the old zod path: a 400
// `invalid_request`. Only the DELETE params decode runs in the framework
// (always a string); the PATCH body is decoded manually in its handler.
class AuthSchemaErrors extends HttpApiMiddleware.Service<AuthSchemaErrors>()(
  'zilar/effect/http/AuthSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<AuthSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(AuthSchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', error.cause.message || 'Invalid request'),
      );
    }),
  );
}

// GET /invites/:code stays public: a would-be sign-up needs to know if a
// code works. Every other route requires a session.
const AuthGroup = HttpApiGroup.make('auth')
  .add(
    HttpApiEndpoint.get('me', '/me', { success: MeView }),
    HttpApiEndpoint.patch('patchMe', '/me', { success: PatchMeView }),
    HttpApiEndpoint.post('createInvite', '/invites', { success: InviteView }),
    HttpApiEndpoint.delete('revokeInvite', '/invites/:code', {
      params: InviteParams,
      success: RevokedView,
    }),
  )
  .middleware(Session)
  .middleware(AuthSchemaErrors)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

const AuthInvitesPublicGroup = HttpApiGroup.make('authInvitesPublic')
  .add(
    HttpApiEndpoint.get('checkInvite', '/invites/:code', {
      params: InviteParams,
      success: InviteCheckView,
    }),
  )
  .middleware(AuthSchemaErrors)
  .prefix('/api');

const AuthApi = HttpApi.make('auth').add(AuthGroup, AuthInvitesPublicGroup);

export const AUTH_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/me' },
  { method: 'PATCH', path: '/api/me' },
  { method: 'POST', path: '/api/invites' },
  { method: 'GET', path: '/api/invites/:code' },
  { method: 'DELETE', path: '/api/invites/:code' },
];

export function createAuthApi(deps: AuthApiDependencies): EffectApiMount {
  const logger = deps.logger;

  const groupLayer = HttpApiBuilder.group(AuthApi, 'auth', (handlers) =>
    handlers
      .handle('me', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            return yield* Effect.promise(() => meView(deps, user.id));
          }),
          logger,
          requestId,
        );
      })
      .handle('patchMe', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            yield* CurrentUser;
            const headers = new Headers(request.request.headers);
            // Mirrors `c.req.json().catch(() => null)`: an unparseable body
            // is a validation failure, not a 500.
            const raw = yield* request.request.json.pipe(
              Effect.catchCause(() => Effect.succeed<unknown>(null)),
            );
            const exit = Schema.decodeUnknownExit(UpdateMeBody, { errors: 'all' })(raw);
            if (!Exit.isSuccess(exit)) {
              throw new HttpError(400, 'invalid_request', updateMeMessage(raw));
            }
            // Update through Better Auth's own API so its hooks and
            // validation apply.
            yield* Effect.promise(() =>
              deps.auth.api.updateUser({ headers, body: { name: exit.value.name } }),
            );
            const session = yield* Effect.promise(() => deps.auth.api.getSession({ headers }));
            if (!session) {
              throw new HttpError(401, 'unauthorized', 'Authentication required');
            }
            const { user } = session;
            // The nickname must follow the name in every contact's roster.
            // Best-effort: a failure leaves the rows unsynced and the token
            // endpoint retries with the current name. Logs ids only.
            const refreshed = yield* Effect.promise(() =>
              refreshRosterNicknames(
                deps.db,
                deps.adminClient,
                deps.config.xmpp.domain,
                user.id,
                user.name,
              ).then(
                (result) => ({ ok: true as const, result }),
                (error: unknown) => ({ ok: false as const, error }),
              ),
            );
            if (refreshed.ok) {
              if (!refreshed.result.ok) {
                logger.warn(
                  { userId: user.id, pending: refreshed.result.pending },
                  'roster nickname refresh is incomplete',
                );
              }
            } else {
              logger.warn(
                { userId: user.id, err: refreshed.error },
                'could not refresh roster nicknames',
              );
            }
            return {
              id: user.id,
              email: user.email,
              name: user.name,
              image: user.image ?? null,
            };
          }),
          logger,
          requestId,
        );
      })
      .handle('createInvite', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const invite = yield* Effect.promise(() =>
              createInvite(deps.db, { createdBy: user.id }),
            );
            return {
              code: invite.code,
              url: `${deps.config.PUBLIC_URL}/invite/${invite.code}`,
              expiresAt: invite.expiresAt,
            };
          }),
          logger,
          requestId,
        );
      })
      .handle('revokeInvite', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const code = request.params.code;
            const invite = yield* Effect.promise(() => findInviteByCode(deps.db, code));
            if (!invite) {
              throw new HttpError(404, 'not_found', 'Invite not found');
            }
            if (invite.createdBy !== user.id) {
              throw new HttpError(403, 'forbidden', 'Only the creator can revoke this invite');
            }
            yield* Effect.promise(() => revokeInvite(deps.db, code));
            return { revoked: true };
          }),
          logger,
          requestId,
        );
      }),
  );

  const publicGroupLayer = HttpApiBuilder.group(AuthApi, 'authInvitesPublic', (handlers) =>
    handlers.handle('checkInvite', (request) => {
      const requestId = requestIdOf(request.request);
      return withErrorEnvelope(
        Effect.gen(function* () {
          const invite = yield* Effect.promise(() =>
            findUsableInvite(deps.db, request.params.code),
          );
          return { valid: invite !== null };
        }),
        logger,
        requestId,
      );
    }),
  );

  const apiLayer = HttpApiBuilder.layer(AuthApi).pipe(
    Layer.provide(Layer.merge(groupLayer, publicGroupLayer)),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: AUTH_API_ROUTES };
}

async function meView(
  deps: AuthApiDependencies,
  userId: string,
): Promise<{
  id: string;
  email: string;
  name: string;
  image: string | null;
  avatarUrl?: string;
  handle: string | null;
  createdAt: string;
  jid: string | null;
}> {
  const sessionUser = await sessionUserById(deps, userId);
  const account = await findXmppAccount(deps.db, userId);
  const [handleRow] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<HandleLookupRow>`SELECT handle FROM handles WHERE user_id = ${userId} LIMIT 1`;
    }),
  );
  // T-0165: a stored picture wins (`/api/avatars/<id>`), otherwise the
  // existing `user.image` value is kept (Better Auth's table untouched).
  const ownAvatar = await avatarIdsByOwner(deps.db, 'user', [userId]);
  const avatarId = ownAvatar.get(userId);
  return {
    id: sessionUser.id,
    email: sessionUser.email,
    name: sessionUser.name,
    image: sessionUser.image ?? null,
    ...(avatarId === undefined ? {} : { avatarUrl: avatarUrlFor(avatarId) }),
    handle: handleRow?.handle ?? null,
    createdAt:
      sessionUser.createdAt instanceof Date
        ? sessionUser.createdAt.toISOString()
        : String(sessionUser.createdAt),
    jid: account?.jid ?? null,
  };
}

async function sessionUserById(
  deps: AuthApiDependencies,
  userId: string,
): Promise<{ id: string; email: string; name: string; image: string | null; createdAt: Date }> {
  // `created_at` is a timestamp WITHOUT a time zone, which drizzle reads as
  // UTC while the raw pg driver parses it in the process's local zone. The
  // `AT TIME ZONE 'UTC'` cast returns the same instant as a timestamptz, so
  // `/me` answers the same `createdAt` in any process time zone.
  const [sessionUser] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<SessionUserLookupRow>`SELECT id, email, name, image, (created_at AT TIME ZONE 'UTC') AS "createdAt" FROM "user" WHERE id = ${userId} LIMIT 1`;
    }),
  );
  if (!sessionUser) {
    throw new HttpError(401, 'unauthorized', 'Authentication required');
  }
  return sessionUser;
}
