import { Effect, Exit, Schema } from 'effect';
import { LitellmApiError, type VirtualKey, type VirtualKeyInfo } from './litellm-types';

const nonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

export const KeySchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
);
export const ModelsSchema = Schema.mutable(
  Schema.Array(Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(256)))),
).check(Schema.isMinLength(1));
export const BudgetSchema = Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
export const SpendSchema = Schema.Finite;
export const LimitSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)));
export const DurationSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
);
export const AliasSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
);

// A model group name and the provider-qualified model, matching the rules in
// ai/model-entry.ts. The name is derived from an AI id, never user text.
export const ModelNameSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) =>
      /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)
        ? undefined
        : 'must be 1-64 characters of lowercase letters, digits, ".", "_" or "-"',
    ),
  ),
);
export const ProviderModelSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) =>
      /^[a-z0-9][a-z0-9_-]*\/\S+$/i.test(value) ? undefined : 'must look like "provider/model"',
    ),
  ),
);
export const ApiKeySchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
);
export const ModelIdSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
);

export const GeneratedKeySchema = Schema.Struct({
  key: KeySchema,
  token_id: Schema.optional(Schema.NullOr(nonEmptyString)),
  token: Schema.optional(Schema.NullOr(nonEmptyString)),
  key_alias: Schema.optional(Schema.NullOr(Schema.String)),
  max_budget: Schema.optional(Schema.NullOr(Schema.Finite)),
  spend: Schema.optional(Schema.Finite),
  models: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
}).pipe(
  Schema.check(
    Schema.makeFilter((value) =>
      (value.token_id ?? value.token) !== undefined
        ? undefined
        : 'response has neither token_id nor token',
    ),
  ),
);

const KeyInfoSchema = Schema.Struct({
  key_alias: Schema.optional(Schema.NullOr(Schema.String)),
  spend: Schema.Finite.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  max_budget: Schema.optional(Schema.NullOr(Schema.Finite)),
  tpm_limit: Schema.optional(Schema.NullOr(Schema.Finite)),
  rpm_limit: Schema.optional(Schema.NullOr(Schema.Finite)),
  blocked: Schema.optional(Schema.NullOr(Schema.Boolean)),
  models: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
});

export const KeyInfoResponseSchema = Schema.Struct({
  info: KeyInfoSchema,
});

export const UpdateResponseSchema = Schema.Struct({
  key_alias: Schema.optional(Schema.NullOr(Schema.String)),
  spend: Schema.Finite.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  max_budget: Schema.optional(Schema.NullOr(Schema.Finite)),
  tpm_limit: Schema.optional(Schema.NullOr(Schema.Finite)),
  rpm_limit: Schema.optional(Schema.NullOr(Schema.Finite)),
  blocked: Schema.optional(Schema.NullOr(Schema.Boolean)),
  models: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
});

export const DeleteResponseSchema = Schema.Struct({
  deleted_keys: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
});

// `/model/new` returns the created row: at minimum `model_id`. Older shapes
// nest the id under `model_info.id`, so both are accepted.
export const NewModelResponseSchema = Schema.Struct({
  model_id: Schema.optional(nonEmptyString),
  model_info: Schema.optional(Schema.Struct({ id: Schema.optional(nonEmptyString) })),
});

export const DeleteModelResponseSchema = Schema.Struct({
  message: Schema.optional(Schema.String),
});

// `GET /model/info` answers `{ data: [...] }`, one entry per registered model.
// The id lives at the top level on some shapes and under `model_info.id` on
// others (verified live: `/model/info` entries carry no top-level `model_id`),
// so both are accepted. Entries with neither an id nor a name are skipped
// rather than failing the whole listing.
export const ModelListResponseSchema = Schema.Struct({
  data: Schema.optional(
    Schema.mutable(
      Schema.Array(
        Schema.Struct({
          model_id: Schema.optional(nonEmptyString),
          model_name: Schema.optional(nonEmptyString),
          model_info: Schema.optional(Schema.Struct({ id: Schema.optional(nonEmptyString) })),
        }),
      ),
    ),
  ),
});

// LiteLLM answers a delete for a model that is already gone with a 400 whose
// message says it was not found. That is the same state the caller wanted, so
// `deleteModel` treats it as success and deletes stay idempotent.
export function modelAlreadyGone(error: LitellmApiError): boolean {
  return error.status === 404 || /not found/i.test(error.message);
}

// Deleting a key that is already gone answers 404
// `{'error': 'No keys found'}`. That is the state the caller wanted, so
// `revokeKey` treats exactly that as success and revokes stay idempotent.
// Verified against the live gateway 2026-09-28: generate a key, delete it
// twice — the second delete answers this 404, whether addressed by key or by
// token id. Any other error still fails.
export function keyAlreadyGone(error: LitellmApiError): boolean {
  return error.status === 404 && /no keys found/i.test(error.message);
}

// Redacts any exact secret the caller names, then any credential-shaped token.
// The sk- rule also catches virtual keys LiteLLM masks as "sk-...abcd".
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 4) {
      out = out.split(secret).join('[redacted]');
    }
  }
  return out.replace(/sk-[A-Za-z0-9_-]{4,}/g, 'sk-***');
}

export function errorDetail(body: unknown): string {
  if (typeof body === 'string') {
    return body === '' ? 'no response body' : body;
  }
  if (body !== null && typeof body === 'object') {
    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string') {
      return error;
    }
    if (error !== null && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }
    try {
      return JSON.stringify(body);
    } catch {
      return 'unreadable response body';
    }
  }
  return 'no response body';
}

export function isErrorBody(body: unknown): boolean {
  if (body === null || typeof body !== 'object') {
    return false;
  }
  const error = (body as { error?: unknown }).error;
  return typeof error === 'string' || (error !== null && typeof error === 'object');
}

// Response bodies are a network boundary, so a shape mismatch is an error.
// The message is fixed: it never echoes the (possibly sensitive) body back.
export function parseResponse<S extends Schema.ConstraintDecoder<unknown>>(
  operation: string,
  schema: S,
  value: unknown,
): S['Type'] {
  const result = Schema.decodeUnknownExit(schema)(value);
  if (Exit.isFailure(result)) {
    throw new LitellmApiError(operation, 200, 'unexpected response shape');
  }
  return result.value;
}

// Inputs are validated before any request; a bad input throws, like the zod
// `.parse` calls this replaces.
export function parseInput<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown,
): S['Type'] {
  return Schema.decodeUnknownSync(schema)(value);
}

function keyId(value: {
  token_id?: string | null | undefined;
  token?: string | null | undefined;
}): string {
  const id = value.token_id ?? value.token;
  if (!id) {
    throw new Error('LiteLLM key response carried no token id');
  }
  return id;
}

export function toVirtualKey(value: typeof GeneratedKeySchema.Type): VirtualKey {
  return {
    id: keyId(value),
    key: value.key,
    keyAlias: value.key_alias ?? null,
    maxBudget: value.max_budget ?? null,
    spend: value.spend ?? 0,
    models: value.models ?? [],
  };
}

export function toKeyInfo(value: typeof UpdateResponseSchema.Type): VirtualKeyInfo {
  return {
    keyAlias: value.key_alias ?? null,
    maxBudget: value.max_budget ?? null,
    spend: value.spend,
    tpmLimit: value.tpm_limit ?? null,
    rpmLimit: value.rpm_limit ?? null,
    blocked: value.blocked ?? null,
    models: value.models ?? [],
  };
}
