// Model provider connections (T-0557): the API keys a user lets their AIs
// use. A key is write-only: no response carries one.
//
// `create` declares its payload so the derived client is typed and encodes it,
// but the server serves it with `handleRaw` and decodes the body by hand, so
// `requireCipher` (503) still runs before the decode (400).

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { LenientNullableString } from './lenient-nullable-string';
import { Session } from './middleware';

// The fixed list of providers matched from the plan §20.3 (OpenAI, Anthropic,
// Google Gemini, DeepSeek, xAI, OpenRouter) plus GitHub (needed for git
// integration). The ids are the stable machine-readable names; the UI layer
// can choose whatever display label it wants.
export const PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'xai',
  'openrouter',
  'github',
  // T-1396: any service that speaks the OpenAI API, with the user's own base
  // URL. It is an LLM provider but has no fixed catalog of models.
  'openai-compatible',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

// T-1429: the models.dev catalog adds every OpenAI-compatible provider, so an
// id may also be any models.dev-shaped id. The server only accepts one it knows
// from the catalog (`Unknown provider`), so this stays a shape check.
const CATALOG_PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;

export const ProviderIdSchema = Schema.Union([
  Schema.Literals(PROVIDER_IDS),
  Schema.String.check(Schema.isPattern(CATALOG_PROVIDER_ID_PATTERN)),
]);

/** Narrows a free-form provider string to a known id before it is sent. */
export const isProviderId = Schema.is(ProviderIdSchema);

/**
 * The key is trimmed because pasted keys often carry a trailing newline. A
 * client encodes the trimmed form, so it sends `key` and `label` trimmed.
 * Excess keys fail the server decode.
 *
 * T-1396: the custom (OpenAI-compatible) provider also sends `baseUrl`, and it
 * alone requires one — every other provider refuses it. The custom provider
 * also requires a label, so several connections can be told apart in a list.
 */
export const CreateConnectionPayload = Schema.Struct({
  provider: ProviderIdSchema,
  key: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(16384)),
  label: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  baseUrl: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(300))),
}).check(
  Schema.makeFilter((value) => {
    const custom = value.provider === 'openai-compatible';
    if (custom && value.baseUrl === undefined) {
      return 'A base URL is required for an OpenAI-compatible provider';
    }
    if (custom && value.label === undefined) {
      return 'A label is required for an OpenAI-compatible provider';
    }
    if (!custom && value.baseUrl !== undefined) {
      return 'A base URL is only allowed for an OpenAI-compatible provider';
    }
    return undefined;
  }),
);

export type CreateConnectionPayload = typeof CreateConnectionPayload.Type;

/**
 * Replacing the key of an existing connection (T-1292). Only the key changes:
 * the provider and label are fixed at create. The same trim and length rules
 * as `CreateConnectionPayload` apply, and the key stays write-only.
 */
export const UpdateConnectionPayload = Schema.Struct({
  key: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(16384)),
});

export type UpdateConnectionPayload = typeof UpdateConnectionPayload.Type;

/**
 * Every field of a public connection: the encrypted key is not one of them.
 * `provider` and `status` stay plain strings on the wire, so an older app
 * still shows a provider a newer server added.
 */
export const ConnectionView = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  label: LenientNullableString,
  // T-1396: the custom provider's base URL; `null` for every other provider
  // (and for an older server that does not send the field).
  baseUrl: LenientNullableString,
  status: Schema.String,
  createdAt: Schema.String,
});

export type ConnectionView = typeof ConnectionView.Type;

export const ConnectionTestResult = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({ ok: Schema.Literal(false), message: Schema.String }),
]);

export type ConnectionTestResult = typeof ConnectionTestResult.Type;

const ConnectionIdParams = Schema.Struct({ id: Schema.String });

export const ConnectionsGroup = HttpApiGroup.make('connections')
  .add(
    HttpApiEndpoint.get('list', '/connections', {
      success: Schema.Array(ConnectionView),
    }),
    HttpApiEndpoint.post('create', '/connections', {
      payload: CreateConnectionPayload,
      success: ConnectionView.pipe(HttpApiSchema.status(201)),
    }),
    HttpApiEndpoint.patch('update', '/connections/:id', {
      params: ConnectionIdParams,
      payload: UpdateConnectionPayload,
      success: ConnectionView,
    }),
    HttpApiEndpoint.post('test', '/connections/:id/test', {
      params: ConnectionIdParams,
      success: ConnectionTestResult,
    }),
    HttpApiEndpoint.delete('remove', '/connections/:id', {
      params: ConnectionIdParams,
      success: HttpApiSchema.NoContent,
    }),
  )
  .middleware(Session)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
