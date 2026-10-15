// The app's own account routes (T-0561, T-0895): the signed-in profile and the
// personal invite codes. Better Auth's own endpoints (`/api/auth/*`) stay
// outside the contract.
//
// `GET /invites/:code` is public (a would-be sign-up needs to know whether a
// code works), so it sits in its own group without `Session`.
//
// `patchMe` declares its payload so the derived client is typed, but the server
// serves it with `handleRaw`: the framework does not decode the body, because
// its decode would change the texts of a malformed or empty body and reject a
// request without a JSON content type. The name rules run by hand on the
// server with the same `UpdatePayload` schema.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { AuthInviteRateLimit, AuthMeRateLimit, SchemaErrors, Session } from './middleware';

const CONTROL_CHAR_MAX = 0x1f;
const CONTROL_CHAR_DEL = 0x7f;

function isControlCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code <= CONTROL_CHAR_MAX || code === CONTROL_CHAR_DEL;
}

/** Trimmed, 1..64 characters, no control characters. A client sends it trimmed. */
export const AuthDisplayName = Schema.Trim.pipe(
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

/**
 * Trimmed, at most 140 characters, no control characters (`\n` and `\r`
 * included, so it stays one line). Empty clears the bio.
 */
export const AuthBio = Schema.Trim.pipe(
  Schema.check(
    Schema.isMaxLength(140, { message: 'bio must be at most 140 characters' }),
    Schema.makeFilter((value: string) =>
      [...value].every((character) => !isControlCharacter(character))
        ? undefined
        : 'bio must not contain control characters',
    ),
  ),
);

/**
 * Non-strict: unknown keys are stripped. `name` stays required — every caller
 * sends it (web `updateMe`, `apps/web/src/lib/api/chats.ts:66-67`; mobile
 * `updateMe`, `apps/mobile/src/lib/auth-api.ts:42-51`). `timeZone` is the
 * caller's IANA zone (T-1440): a value the server validates and stores.
 */
export const UpdateMePayload = Schema.Struct({
  name: AuthDisplayName,
  bio: Schema.optional(AuthBio),
  timeZone: Schema.optional(Schema.String),
});

/**
 * The signed-in profile. Fields added after the first release are optional, so
 * a payload from an older server still decodes (an absent one reads like null).
 */
export const AuthMe = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  image: Schema.optional(Schema.NullOr(Schema.String)),
  avatarUrl: Schema.optional(Schema.String),
  handle: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
  jid: Schema.optional(Schema.NullOr(Schema.String)),
  bio: Schema.optional(Schema.String),
  /** T-1440: the user's IANA time zone; absent when never reported. */
  timeZone: Schema.optional(Schema.String),
});

export type AuthMe = typeof AuthMe.Type;

/** The reply to `PATCH /me`: the Better Auth user after the update. */
export const PatchedMe = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  image: Schema.optional(Schema.NullOr(Schema.String)),
});

export type PatchedMe = typeof PatchedMe.Type;

/** A personal invite; `expiresAt` is an ISO string. */
export const AuthInvite = Schema.Struct({
  code: Schema.String,
  url: Schema.String,
  expiresAt: Schema.optional(Schema.String),
});

export type AuthInvite = typeof AuthInvite.Type;

export const AuthInviteCheck = Schema.Struct({ valid: Schema.Boolean });

export const AuthInviteRevoked = Schema.Struct({ revoked: Schema.Boolean });

/**
 * One signed-in session of the caller (T-1235). The token and the IP address
 * never leave the server: the page only needs the id, the two timestamps, the
 * user agent and whether this is the session making the request.
 */
export const AuthSession = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  userAgent: Schema.optional(Schema.NullOr(Schema.String)),
  current: Schema.Boolean,
});

export type AuthSession = typeof AuthSession.Type;

export const AuthSessions = Schema.Struct({ sessions: Schema.Array(AuthSession) });

export type AuthSessions = typeof AuthSessions.Type;

/**
 * The account-deletion grace status (T-1261). `scheduled` is false when nothing
 * is pending; otherwise `deleteAfter` is the ISO instant the deletion job may
 * run (the request plus seven days). The deletion job itself is a later task.
 */
export const AuthDeletionStatus = Schema.Union([
  Schema.Struct({ scheduled: Schema.Literal(false) }),
  Schema.Struct({ scheduled: Schema.Literal(true), deleteAfter: Schema.String }),
]);

export type AuthDeletionStatus = typeof AuthDeletionStatus.Type;

export const AuthGroup = HttpApiGroup.make('auth')
  .add(
    HttpApiEndpoint.get('me', '/me', { success: AuthMe }),
    HttpApiEndpoint.patch('patchMe', '/me', {
      payload: UpdateMePayload,
      success: PatchedMe,
    }).middleware(AuthMeRateLimit),
    HttpApiEndpoint.post('createInvite', '/invites', { success: AuthInvite }).middleware(
      AuthInviteRateLimit,
    ),
    HttpApiEndpoint.delete('revokeInvite', '/invites/:code', {
      params: { code: Schema.String },
      success: AuthInviteRevoked,
    }),
    // The caller's own sessions. `freshSessionMiddleware` is deliberately not
    // in play: a session older than 24 h still lists here (T-1235).
    HttpApiEndpoint.get('listSessions', '/me/sessions', { success: AuthSessions }),
    // Signing out another device is a write, so it shares the auth-write budget.
    HttpApiEndpoint.delete('revokeSession', '/me/sessions/:id', {
      params: { id: Schema.String },
      success: HttpApiSchema.NoContent,
    }).middleware(AuthMeRateLimit),
    // The 7-day account-deletion grace (T-1261): read the status, schedule it
    // (writes share the auth-write budget) or cancel it. Nothing is deleted here.
    HttpApiEndpoint.get('getDeletion', '/me/deletion', { success: AuthDeletionStatus }),
    HttpApiEndpoint.post('requestDeletion', '/me/deletion', {
      success: AuthDeletionStatus,
    }).middleware(AuthMeRateLimit),
    HttpApiEndpoint.delete('cancelDeletion', '/me/deletion', {
      success: AuthDeletionStatus,
    }).middleware(AuthMeRateLimit),
    // The streamed account export (T-1262). No `success` schema: like the files
    // route (`apps/server/src/files/api.ts:176-182`) and the GIF media route
    // (`gifs.ts:52-54`), the handler answers a raw body (`HttpServerResponse.raw`)
    // with its own `Content-Type` and `Content-Disposition`, not a decoded JSON.
    HttpApiEndpoint.get('export', '/me/export'),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');

export const AuthInvitesPublicGroup = HttpApiGroup.make('authInvitesPublic')
  .add(
    HttpApiEndpoint.get('checkInvite', '/invites/:code', {
      params: { code: Schema.String },
      success: AuthInviteCheck,
    }),
  )
  .middleware(SchemaErrors)
  .prefix('/api');
