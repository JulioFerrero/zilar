// Name decode runs by hand inside PATCH so the route keeps its exact order and failure texts; the framework decode would change them.
import type { ServerCore } from '../app/deps';
import { Effect, Exit, Layer, Schema } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import {
  AuthGroup,
  AuthInviteRateLimit,
  AuthInvitesPublicGroup,
  AuthMeRateLimit,
  UpdateMePayload,
} from '@zilar/api-contract';

import { createAuditRecorder } from '../audit/recorder';

import { refreshRosterNicknames } from '../contacts/service';

import { rateLimitLayer } from '../effect/rate-limit-middleware';
import { firstIssueMessage } from '../effect/schema-issues';
import { limiter } from '../rate-limit';
import {
  mountGroups,
  handler,
  requestIdOf,
  withErrorEnvelope,
  type EffectApiMount,
} from '../effect/http-core';
import { HttpError } from '../errors';
import { createInvite, findInviteByCode, findUsableInvite, revokeInvite } from './invites';
import { upsertProfileBio, bioForUser } from './profile-bio';
import { isValidTimeZone, upsertProfileTimeZone, timeZoneFor } from './profile-time-zone';
import { listSessions, revokeSession } from './sessions';
import { cancelDeletion, deletionStatus, requestDeletion } from './deletion-request';
import { createExportHandler } from './export';
import type { ArchivePool } from '../search/service';
import { SqlClient } from 'effect/sql';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import { runSql } from '../effect/sql';
import { findXmppAccount } from '../xmpp/provisioning';

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
  timeZone?: string;
}> {
  const sessionUser = await sessionUserById(deps, userId);
  const account = await findXmppAccount(deps.db, userId);
  const bio = await bioForUser(deps.db, userId);
  const timeZone = await timeZoneFor(deps.db, userId);
  const [handleRow] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<HandleLookupRow>`SELECT handle FROM handles WHERE user_id = ${userId} LIMIT 1`;
    }),
  );
  // A stored picture wins, otherwise the existing `user.image` is kept.
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
    ...(timeZone === null ? {} : { timeZone }),
  };
}

async function sessionUserById(
  deps: AuthApiDependencies,
  userId: string,
): Promise<{ id: string; email: string; name: string; image: string | null; createdAt: Date }> {
  // `created_at` is `timestamp WITHOUT time zone`; the `AT TIME ZONE 'UTC'` cast makes `/me` timezone-independent.
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
export interface AuthApiDependencies extends Pick<
  ServerCore,
  'auth' | 'db' | 'config' | 'adminClient' | 'logger'
> {
  now?: () => number;
  // Absent, the export route resolves a pool from `XMPP_ARCHIVE_DATABASE_URL`.
  archive?: ArchivePool;
}

// `UpdateMePayload` is non-strict: unknown keys are stripped.
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

// GET /invites/:code is public so a would-be sign-up can test a code; every other route requires a session.
// PATCH /me declares its payload for typing but is served with `handleRaw`: decoding by hand preserves its texts.
const AuthApi = HttpApi.make('auth').add(AuthGroup, AuthInvitesPublicGroup);

export function createAuthApi(deps: AuthApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const inviteLimiter = limiter('authInvite', now);
  const meLimiter = limiter('authMe', now);
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
            // An unparseable body is a validation failure, not a 500.
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
      // A direct `session` read so a session older than 24 h still lists (no fresh-session gate).
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
            {
              db: deps.db,
              auth: deps.auth,
              audit,
              adminClient: deps.adminClient,
              logger,
            },
            user.id,
            new Headers(request.request.headers),
            request.params.id,
          ),
        ),
      )
      // GET and DELETE touch only the caller's row; POST needs a fresh session and keeps the first date.
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
      // A raw body: the handler returns the `HttpServerResponse` the service built.
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
    // Validate before any write, so a refused PATCH has no side effects.
    if (exit.value.timeZone !== undefined && !isValidTimeZone(exit.value.timeZone)) {
      throw new HttpError(400, 'invalid_request', 'timeZone must be a valid IANA time zone');
    }
    // Through Better Auth's own API so its hooks and validation apply.
    await deps.auth.api.updateUser({ headers, body: { name: exit.value.name } });
    const session = await deps.auth.api.getSession({ headers });
    if (!session) {
      throw new HttpError(401, 'unauthorized', 'Authentication required');
    }
    const { user } = session;
    // The bio lives in its own table and is never logged; `''` clears it.
    if (exit.value.bio !== undefined) {
      await upsertProfileBio(deps.db, user.id, exit.value.bio);
    }
    if (exit.value.timeZone !== undefined) {
      await upsertProfileTimeZone(deps.db, user.id, exit.value.timeZone);
    }
    // Best effort: the token endpoint retries with the current name; logs ids only.
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

  return mountGroups(AuthApi, Layer.merge(groupLayer, publicGroupLayer), {
    auth: deps.auth,
    logger,
    extra: [
      rateLimitLayer(AuthInviteRateLimit, inviteLimiter, 'Too many invites, try again later'),
      rateLimitLayer(AuthMeRateLimit, meLimiter, 'Too many profile changes, try again later'),
    ],
    schemaErrors: true,
  });
}
