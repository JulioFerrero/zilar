// `GET /invites/:code` is public (a would-be sign-up must know whether a code works), so it sits in its own group without `Session`.
// `patchMe` is served with `handleRaw` so the framework's decode keeps the fixed error texts and accepts a request without a JSON content type.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { AuthInviteRateLimit, AuthMeRateLimit, SchemaErrors, Session } from './middleware';

const CONTROL_CHAR_MAX = 0x1f;
const CONTROL_CHAR_DEL = 0x7f;

function isControlCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code <= CONTROL_CHAR_MAX || code === CONTROL_CHAR_DEL;
}

// Trimmed, 1..64 characters, no control characters.
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

// Trimmed, at most 140 characters, no control characters (`\n` and `\r` included, so it stays one line). Empty clears the bio.
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

// Non-strict: unknown keys are stripped. `name` stays required because every caller sends it;
// `timeZone` is the caller's IANA zone.
export const UpdateMePayload = Schema.Struct({
  name: AuthDisplayName,
  bio: Schema.optional(AuthBio),
  timeZone: Schema.optional(Schema.String),
});

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
  timeZone: Schema.optional(Schema.String),
});

export type AuthMe = typeof AuthMe.Type;

export const PatchedMe = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  image: Schema.optional(Schema.NullOr(Schema.String)),
});

export type PatchedMe = typeof PatchedMe.Type;

export const AuthInvite = Schema.Struct({
  code: Schema.String,
  url: Schema.String,
  expiresAt: Schema.optional(Schema.String),
});

export type AuthInvite = typeof AuthInvite.Type;

export const AuthInviteCheck = Schema.Struct({ valid: Schema.Boolean });

export const AuthInviteRevoked = Schema.Struct({ revoked: Schema.Boolean });

// The token and the IP address never leave the server.
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

// `deleteAfter` is the ISO instant the deletion job may run (the request plus seven days).
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
    // `freshSessionMiddleware` is deliberately not in play: a session older than 24 h still lists here.
    HttpApiEndpoint.get('listSessions', '/me/sessions', { success: AuthSessions }),
    // Signing out another device is a write, so it shares the auth-write budget.
    HttpApiEndpoint.delete('revokeSession', '/me/sessions/:id', {
      params: { id: Schema.String },
      success: HttpApiSchema.NoContent,
    }).middleware(AuthMeRateLimit),
    // Nothing is deleted here; writes share the auth-write budget.
    HttpApiEndpoint.get('getDeletion', '/me/deletion', { success: AuthDeletionStatus }),
    HttpApiEndpoint.post('requestDeletion', '/me/deletion', {
      success: AuthDeletionStatus,
    }).middleware(AuthMeRateLimit),
    HttpApiEndpoint.delete('cancelDeletion', '/me/deletion', {
      success: AuthDeletionStatus,
    }).middleware(AuthMeRateLimit),
    // No `success` schema: the handler answers a raw body with its own `Content-Type` and `Content-Disposition`, not decoded JSON.
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
