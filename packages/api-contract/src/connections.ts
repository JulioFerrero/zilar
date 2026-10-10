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
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const ProviderIdSchema = Schema.Literals(PROVIDER_IDS);

/** Narrows a free-form provider string to a known id before it is sent. */
export const isProviderId = Schema.is(ProviderIdSchema);

/**
 * The key is trimmed because pasted keys often carry a trailing newline. A
 * client encodes the trimmed form, so it sends `key` and `label` trimmed.
 * Excess keys fail the server decode.
 */
export const CreateConnectionPayload = Schema.Struct({
  provider: ProviderIdSchema,
  key: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(16384)),
  label: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
});

export type CreateConnectionPayload = typeof CreateConnectionPayload.Type;

/**
 * Every field of a public connection: the encrypted key is not one of them.
 * `provider` and `status` stay plain strings on the wire, so an older app
 * still shows a provider a newer server added.
 */
export const ConnectionView = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  label: LenientNullableString,
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
