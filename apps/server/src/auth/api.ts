// Auth module on the Effect `HttpApi` adapter (T-0561): the same methods,
// paths, statuses, bodies and texts as the deleted router (`routes.ts`),
// mounted by the Effect edge (`apps/server/src/effect/edge.ts`). Its services
// run on effect/sql and call Better Auth's API.
//
// The name decode runs manually inside the PATCH handler (Effect Schema,
// same rules as the old zod schema) instead of by the framework, so
// the route keeps its exact order: session -> raw body -> decode ->
// `updateUser` -> session read again -> roster refresh. No decode text
// changes: every failure answers byte-identical codes and messages.

import { Effect, Exit, Layer, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import {
  AuthGroup,
  AuthInviteRateLimit,
  AuthInvitesPublicGroup,
  AuthMeRateLimit,
  UpdateMePayload,
} from '@zilar/api-contract';
import type { Logger } from 'pino';
import { createAuditRecorder } from '../audit/service';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import type { ServerConfig } from '../config';
import { refreshRosterNicknames } from '../contacts/service';
import type { ServerDatabase } from '../db/client';
import { rateLimitLayer } from '../effect/rate-limit-middleware';
import { firstIssueMessage } from '../effect/schema-issues';
import { runSql } from '../effect/sql';
import { createRateLimiter } from '../rate-limit';
import {
  handler,
  mountApi,
  requestIdOf,
  schemaErrorLayer,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
} from '../effect/http-core';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { findXmppAccount } from '../xmpp/provisioning';
import type { Auth } from './auth';
import { createInvite, findInviteByCode, findUsableInvite, revokeInvite } from './invites';
import { bioForUser, upsertProfileBio } from './profile-bio';
import { listSessions, revokeSession } from './sessions';
import { cancelDeletion, deletionStatus, requestDeletion } from './deletion-request';
import { createExportHandler } from './export';
import type { ArchivePool } from '../search/service';

export const AUTH_INVITE_RATE_LIMIT_MAX = 10;
export const AUTH_INVITE_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const AUTH_ME_RATE_LIMIT_MAX = 10;
export const AUTH_ME_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export interface AuthApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: Logger;
  /** Injected in tests so the rate-limit window can advance. */
  now?: () => number;
  /**
   * The read-only archive pool for `GET /me/export` (T-1262). Absent, the
   * export route resolves one from `XMPP_ARCHIVE_DATABASE_URL`
   * (`createExportArchivePool`), so `app.ts` needs no new wiring.
   */
  archive?: ArchivePool;
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

// The profile rules (name and bio) live in the contract as `UpdateMePayload`,
// non-strict: unknown keys are stripped.
const UpdateMeBody = UpdateMePayload;

const PROFILE_MESSAGES = new Set([
  'name must not be empty',
  'name must be at most 64 characters',
  'name must not contain control characters',
  'bio must be at most 140 characters',
  'bio must not contain control characters',
]);
function updateMeMessage(body: unknown): string {
  const exit = Schema.decodeUnknownExit(UpdateMeBody, { errors: 'all' })(body);
  if (Exit.isSuccess(exit)) {
    return 'Invalid name';
  }
  for (const reason of exit.cause.reasons) {
    if (reason._tag === 'Fail') {
      const firstLine = reason.error.message.split('\n')[0]?.trim();
      if (firstLine !== undefined && PROFILE_MESSAGES.has(firstLine)) {
        return firstLine;
      }
      return firstIssueMessage(reason.error.issue) ?? 'Invalid name';
    }
  }
  return 'Invalid name';
}

// The groups and the reply schemas live in the shared contract
// (`@zilar/api-contract`, `auth.ts`, T-0895). GET /invites/:code stays public:
// a would-be sign-up needs to know if a code works. Every other route requires
// a session.
//
// PATCH /me declares its payload so a derived client is typed, but it is
// served with `handleRaw`: the framework does not decode the body. The name
// rules run by hand (see the header) because the framework's decode would
// change the texts of a malformed or empty body (400 "Expected a valid JSON
// body" instead of "Invalid name") and reject a request without a JSON
// content-type with 415.
const AuthApi = HttpApi.make('auth').add(AuthGroup, AuthInvitesPublicGroup);

export function createAuthApi(deps: AuthApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const inviteLimiter = createRateLimiter({
    max: AUTH_INVITE_RATE_LIMIT_MAX,
    windowMs: AUTH_INVITE_RATE_LIMIT_WINDOW_MS,
    now,
  });
  const meLimiter = createRateLimiter({
    max: AUTH_ME_RATE_LIMIT_MAX,
    windowMs: AUTH_ME_RATE_LIMIT_WINDOW_MS,
    now,
  });
  const audit = createAuditRecorder({ db: deps.db, logger });
  const exportHandler = createExportHandler({ ...deps, audit });

  const groupLayer = HttpApiBuilder.group(AuthApi, 'auth', (handlers) =>
    handlers
      .handle(
        'me',
        handler(logger, (_request, user) => meView(deps, user.id)),
      )
      .handleRaw(
        'patchMe',
        handler(logger, (request) =>
          Effect.gen(function* () {
            const headers = new Headers(request.request.headers);
            // Mirrors `c.req.json().catch(() => null)`: an unparseable body
            // is a validation failure, not a 500.
            const raw = yield* request.request.json.pipe(
              Effect.catchCause(() => Effect.succeed<unknown>(null)),
            );
            return yield* Effect.promise(() => updateMe(headers, raw));
          }),
        ),
      )
      .handle(
        'createInvite',
        handler(logger, async (_request, user) => {
          const invite = await createInvite(deps.db, { createdBy: user.id });
          return {
            code: invite.code,
            url: `${deps.config.PUBLIC_URL}/invite/${invite.code}`,
            expiresAt: invite.expiresAt.toISOString(),
          };
        }),
      )
      .handle(
        'revokeInvite',
        handler(logger, async (request, user) => {
          const code = request.params.code;
          const invite = await findInviteByCode(deps.db, code);
          if (!invite) {
            throw new HttpError(404, 'not_found', 'Invite not found');
          }
          if (invite.createdBy !== user.id) {
            throw new HttpError(403, 'forbidden', 'Only the creator can revoke this invite');
          }
          await revokeInvite(deps.db, code);
          return { revoked: true };
        }),
      )
      // The caller's own sessions (T-1235): a direct `session` read, so a
      // session older than 24 h still lists (`freshSessionMiddleware` is not
      // in play, unlike Better Auth's own `/list-sessions`).
      .handle(
        'listSessions',
        handler(logger, (request, user) =>
          listSessions(
            { db: deps.db, auth: deps.auth },
            user.id,
            new Headers(request.request.headers),
          ),
        ),
      )
      // Signs out one other device; the caller's own session answers 400.
      .handle(
        'revokeSession',
        handler(logger, (request, user) =>
          revokeSession(
            { db: deps.db, auth: deps.auth, audit },
            user.id,
            new Headers(request.request.headers),
            request.params.id,
          ),
        ),
      )
      // The 7-day account-deletion grace (T-1261). GET and DELETE never touch
      // anything but the caller's row; POST demands a fresh session and is
      // idempotent, keeping the first date.
      .handle(
        'getDeletion',
        handler(logger, (_request, user) => deletionStatus(deps.db, user.id)),
      )
      .handle(
        'requestDeletion',
        handler(logger, (request, user) =>
          requestDeletion(
            { db: deps.db, auth: deps.auth, audit, now },
            user.id,
            new Headers(request.request.headers),
          ),
        ),
      )
      .handle(
        'cancelDeletion',
        handler(logger, (_request, user) => cancelDeletion({ db: deps.db, audit }, user.id, null)),
      )
      // The streamed account export (T-1262): a raw body, so the handler
      // returns the `HttpServerResponse` the service built.
      .handle(
        'export',
        handler(logger, (request, user) =>
          exportHandler(user.id, new Headers(request.request.headers)),
        ),
      ),
  );

  async function updateMe(headers: Headers, raw: unknown) {
    const exit = Schema.decodeUnknownExit(UpdateMeBody, { errors: 'all' })(raw);
    if (!Exit.isSuccess(exit)) {
      throw new HttpError(400, 'invalid_request', updateMeMessage(raw));
    }
    // Update through Better Auth's own API so its hooks and
    // validation apply.
    await deps.auth.api.updateUser({ headers, body: { name: exit.value.name } });
    const session = await deps.auth.api.getSession({ headers });
    if (!session) {
      throw new HttpError(401, 'unauthorized', 'Authentication required');
    }
    const { user } = session;
    // T-1258: the bio lives in its own table; upsert it when the payload
    // carries one (`''` clears it). The bio is never logged.
    if (exit.value.bio !== undefined) {
      await upsertProfileBio(deps.db, user.id, exit.value.bio);
    }
    // The nickname must follow the name in every contact's roster.
    // Best-effort: a failure leaves the rows unsynced and the token
    // endpoint retries with the current name. Logs ids only.
    const refreshed = await refreshRosterNicknames(
      deps.db,
      deps.adminClient,
      deps.config.xmpp.domain,
      user.id,
      user.name,
    ).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    if (refreshed.ok) {
      if (!refreshed.result.ok) {
        logger.warn(
          { userId: user.id, pending: refreshed.result.pending },
          'roster nickname refresh is incomplete',
        );
      }
    } else {
      logger.warn({ userId: user.id, err: refreshed.error }, 'could not refresh roster nicknames');
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image ?? null,
    };
  }

  const publicGroupLayer = HttpApiBuilder.group(AuthApi, 'authInvitesPublic', (handlers) =>
    handlers.handle('checkInvite', (request) =>
      withErrorEnvelope(
        Effect.gen(function* () {
          const invite = yield* Effect.promise(() =>
            findUsableInvite(deps.db, request.params.code),
          );
          return { valid: invite !== null };
        }),
        logger,
        requestIdOf(request.request),
      ),
    ),
  );

  const apiLayer = HttpApiBuilder.layer(AuthApi).pipe(
    Layer.provide(Layer.merge(groupLayer, publicGroupLayer)),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(
      rateLimitLayer(AuthInviteRateLimit, inviteLimiter, 'Too many invites, try again later'),
    ),
    Layer.provide(
      rateLimitLayer(AuthMeRateLimit, meLimiter, 'Too many profile changes, try again later'),
    ),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(AuthApi, apiLayer);
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
  bio?: string;
}> {
  const sessionUser = await sessionUserById(deps, userId);
  const account = await findXmppAccount(deps.db, userId);
  const bio = await bioForUser(deps.db, userId);
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
    ...(bio === null ? {} : { bio }),
  };
}

async function sessionUserById(
  deps: AuthApiDependencies,
  userId: string,
): Promise<{ id: string; email: string; name: string; image: string | null; createdAt: Date }> {
  // `created_at` is a timestamp WITHOUT a time zone, which the pg driver parses
  // in the process's local zone. The
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
