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

import { Effect, Exit, Layer, Schema, SchemaIssue } from 'effect';
import { SqlClient } from 'effect/sql';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { AuthGroup, AuthInvitesPublicGroup, UpdateMePayload } from '@zilar/api-contract';
import type { Logger } from 'pino';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import type { ServerConfig } from '../config';
import { refreshRosterNicknames } from '../contacts/service';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import {
  handler,
  mountApi,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
} from '../effect/http-core';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { findXmppAccount } from '../xmpp/provisioning';
import type { Auth } from './auth';
import { contractSchemaErrorLayer } from './schema-errors';
import { createInvite, findInviteByCode, findUsableInvite, revokeInvite } from './invites';

export interface AuthApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: Logger;
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

// The name rules (trimmed, 1..64 characters, no control characters, with the
// three messages) live in the contract as `UpdateMePayload`, non-strict:
// unknown keys are stripped.
const UpdateMeBody = UpdateMePayload;

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
    Layer.provide(contractSchemaErrorLayer(logger)),
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
