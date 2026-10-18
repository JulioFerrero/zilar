// A key is write-only: no response carries one.
// `create` is served with `handleRaw` so `requireCipher` (503) still runs before the decode (400).

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { LenientNullableString } from './lenient-nullable-string';
import { Session } from './middleware';

// The ids are the stable machine-readable names; the UI layer chooses the display labels.
export const PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'xai',
  'openrouter',
  'github',
  'openai-compatible',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

// An id may be any models.dev-shaped id; the server only accepts one it knows from the catalog.
const CATALOG_PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;

export const ProviderIdSchema = Schema.Union([
  Schema.Literals(PROVIDER_IDS),
  Schema.String.check(Schema.isPattern(CATALOG_PROVIDER_ID_PATTERN)),
]);

export const isProviderId = Schema.is(ProviderIdSchema);

// The key is trimmed because pasted keys often carry a trailing newline.
// The custom (OpenAI-compatible) provider alone requires `baseUrl` and also requires a label.
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

// Only the key changes; provider and label are fixed at create. The key stays write-only.
export const UpdateConnectionPayload = Schema.Struct({
  key: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(16384)),
});

export type UpdateConnectionPayload = typeof UpdateConnectionPayload.Type;

// The encrypted key is not a field; `provider` and `status` stay plain strings,
// so an older app still shows a provider a newer server added.
export const ConnectionView = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  label: LenientNullableString,
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
