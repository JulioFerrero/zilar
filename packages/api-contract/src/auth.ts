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
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { SchemaErrors, Session } from './middleware';

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

/** Non-strict: unknown keys are stripped. */
export const UpdateMePayload = Schema.Struct({ name: AuthDisplayName });

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

export const AuthGroup = HttpApiGroup.make('auth')
  .add(
    HttpApiEndpoint.get('me', '/me', { success: AuthMe }),
    HttpApiEndpoint.patch('patchMe', '/me', { payload: UpdateMePayload, success: PatchedMe }),
    HttpApiEndpoint.post('createInvite', '/invites', { success: AuthInvite }),
    HttpApiEndpoint.delete('revokeInvite', '/invites/:code', {
      params: { code: Schema.String },
      success: AuthInviteRevoked,
    }),
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
