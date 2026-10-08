import { Effect, Exit, Schema } from 'effect';
import type { ServerConfig } from '../config';

// The address the dev stack publishes LiteLLM on. Kept here rather than in the
// env schema so an absent LITELLM_BASE_URL does not change the parsed config.
export const DEFAULT_LITELLM_BASE_URL = 'http://127.0.0.1:4000';

// Every failure coming from LiteLLM is wrapped in this type. The message is
// redacted before construction: it never carries the master key or a provider
// key, whatever the proxy echoed back.
export class LitellmApiError extends Error {
  readonly operation: string;
  readonly status: number;

  constructor(operation: string, status: number, detail: string) {
    super(
      status === 0
        ? `LiteLLM "${operation}" request failed: ${detail}`
        : `LiteLLM "${operation}" failed with HTTP ${status}: ${detail}`,
    );
    this.name = 'LitellmApiError';
    this.operation = operation;
    this.status = status;
  }
}

export interface LitellmClientConfig {
  baseUrl: string;
  masterKey: string;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface GenerateVirtualKeyInput {
  /** Model groups the key may call. At least one, and never empty. */
  models: string[];
  /** Hard spend cap in USD. Enforced by the proxy before every call. */
  maxBudget?: number;
  /** Reset window for the budget, e.g. "30d" or "1h". */
  budgetDuration?: string;
  tpmLimit?: number;
  rpmLimit?: number;
  keyAlias?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateVirtualKeyInput {
  key: string;
  /** Replaces the model allowlist. At least one model when present. */
  models?: string[];
  maxBudget?: number;
  tpmLimit?: number;
  rpmLimit?: number;
  blocked?: boolean;
  /**
   * Admin-only spend override. LiteLLM accepts it on /key/update; the spike's
   * integration script uses it to cross a cap without a real provider. Never
   * used by the app to *set* what a user spent.
   */
  spend?: number;
}

export interface AddModelInput {
  /** The model group our AIs call, e.g. "ai-<aiId>". Unique per AI. */
  modelName: string;
  /** The provider-qualified model, e.g. "openai/gpt-4o-mini". */
  litellmModel: string;
  /**
   * The owner's provider key. LiteLLM stores its own encrypted copy; the
   * plaintext never leaves this request and is redacted from every error.
   */
  apiKey: string;
  /** Extra metadata stored as LiteLLM's `model_info`, e.g. `{ ai_id }`. */
  metadata?: Record<string, unknown>;
}

export interface VirtualKey {
  /** LiteLLM's token id, the stable handle we store for a key. */
  id: string;
  /** The placeholder key handed to the client. */
  key: string;
  keyAlias: string | null;
  maxBudget: number | null;
  spend: number;
  models: string[];
}

export interface VirtualKeyInfo {
  keyAlias: string | null;
  maxBudget: number | null;
  spend: number;
  tpmLimit: number | null;
  rpmLimit: number | null;
  blocked: boolean | null;
  models: string[];
}

export interface ModelListing {
  /** LiteLLM's model id, the handle `/model/delete` needs. */
  id: string;
  /** The public group name, e.g. `ai-<aiId>`. */
  name: string;
}

export interface LitellmAdminClient {
  generateKey(input: GenerateVirtualKeyInput): Promise<VirtualKey>;
  getKeyInfo(key: string): Promise<VirtualKeyInfo>;
  updateKey(input: UpdateVirtualKeyInput): Promise<VirtualKeyInfo>;
  revokeKey(key: string): Promise<void>;
  /** Registers a private model group and returns LiteLLM's model id. */
  addModel(input: AddModelInput): Promise<string>;
  /** Deletes a registered model. A model that is already gone is not an error. */
  deleteModel(modelId: string): Promise<void>;
  /** Lists the registered models. Entries without an id or a name are skipped. */
  listModels(): Promise<ModelListing[]>;
}

const nonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

const KeySchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(4096)));
const ModelsSchema = Schema.mutable(
  Schema.Array(Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(256)))),
).check(Schema.isMinLength(1));
const BudgetSchema = Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const SpendSchema = Schema.Finite;
const LimitSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)));
const DurationSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
);
const AliasSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
);

// A model group name and the provider-qualified model, matching the rules in
// ai/model-entry.ts. The name is derived from an AI id, never user text.
const ModelNameSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) =>
      /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)
        ? undefined
        : 'must be 1-64 characters of lowercase letters, digits, ".", "_" or "-"',
    ),
  ),
);
const ProviderModelSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) =>
      /^[a-z0-9][a-z0-9_-]*\/\S+$/i.test(value) ? undefined : 'must look like "provider/model"',
    ),
  ),
);
const ApiKeySchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
);
const ModelIdSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
);

const GeneratedKeySchema = Schema.Struct({
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

const KeyInfoResponseSchema = Schema.Struct({
  info: KeyInfoSchema,
});

const UpdateResponseSchema = Schema.Struct({
  key_alias: Schema.optional(Schema.NullOr(Schema.String)),
  spend: Schema.Finite.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  max_budget: Schema.optional(Schema.NullOr(Schema.Finite)),
  tpm_limit: Schema.optional(Schema.NullOr(Schema.Finite)),
  rpm_limit: Schema.optional(Schema.NullOr(Schema.Finite)),
  blocked: Schema.optional(Schema.NullOr(Schema.Boolean)),
  models: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
});

const DeleteResponseSchema = Schema.Struct({
  deleted_keys: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
});

// `/model/new` returns the created row: at minimum `model_id`. Older shapes
// nest the id under `model_info.id`, so both are accepted.
const NewModelResponseSchema = Schema.Struct({
  model_id: Schema.optional(nonEmptyString),
  model_info: Schema.optional(Schema.Struct({ id: Schema.optional(nonEmptyString) })),
});

const DeleteModelResponseSchema = Schema.Struct({
  message: Schema.optional(Schema.String),
});

// `GET /model/info` answers `{ data: [...] }`, one entry per registered model.
// The id lives at the top level on some shapes and under `model_info.id` on
// others (verified live: `/model/info` entries carry no top-level `model_id`),
// so both are accepted. Entries with neither an id nor a name are skipped
// rather than failing the whole listing.
const ModelListResponseSchema = Schema.Struct({
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
function modelAlreadyGone(error: LitellmApiError): boolean {
  return error.status === 404 || /not found/i.test(error.message);
}

// Deleting a key that is already gone answers 404
// `{'error': 'No keys found'}`. That is the state the caller wanted, so
// `revokeKey` treats exactly that as success and revokes stay idempotent.
// Verified against the live gateway 2026-09-28: generate a key, delete it
// twice — the second delete answers this 404, whether addressed by key or by
// token id. Any other error still fails.
function keyAlreadyGone(error: LitellmApiError): boolean {
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

function errorDetail(body: unknown): string {
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

function isErrorBody(body: unknown): boolean {
  if (body === null || typeof body !== 'object') {
    return false;
  }
  const error = (body as { error?: unknown }).error;
  return typeof error === 'string' || (error !== null && typeof error === 'object');
}

// Response bodies are a network boundary, so a shape mismatch is an error.
// The message is fixed: it never echoes the (possibly sensitive) body back.
function parseResponse<S extends Schema.ConstraintDecoder<unknown>>(
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
function parseInput<S extends Schema.ConstraintDecoder<unknown>>(
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

function toVirtualKey(value: typeof GeneratedKeySchema.Type): VirtualKey {
  return {
    id: keyId(value),
    key: value.key,
    keyAlias: value.key_alias ?? null,
    maxBudget: value.max_budget ?? null,
    spend: value.spend ?? 0,
    models: value.models ?? [],
  };
}

function toKeyInfo(value: typeof UpdateResponseSchema.Type): VirtualKeyInfo {
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

export function createLitellmAdminClient(
  config: LitellmClientConfig,
  fetchImpl: FetchLike = fetch,
): LitellmAdminClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const { masterKey } = config;

  async function request(
    operation: string,
    path: string,
    init: RequestInit,
    secrets: readonly string[],
  ): Promise<unknown> {
    const redacted = [masterKey, ...secrets];
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, init);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'network error';
      throw new LitellmApiError(operation, 0, redactSecrets(message, redacted));
    }

    const text = await response.text();
    let body: unknown = null;
    if (text !== '') {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (!response.ok || isErrorBody(body)) {
      throw new LitellmApiError(
        operation,
        response.status,
        redactSecrets(errorDetail(body), redacted),
      );
    }
    return body;
  }

  function headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${masterKey}`,
    };
  }

  function post(operation: string, path: string, body: unknown, secrets: readonly string[] = []) {
    return request(
      operation,
      path,
      { method: 'POST', headers: headers(), body: JSON.stringify(body) },
      secrets,
    );
  }

  return {
    async generateKey(input: GenerateVirtualKeyInput): Promise<VirtualKey> {
      const body: Record<string, unknown> = { models: parseInput(ModelsSchema, input.models) };
      if (input.maxBudget !== undefined) {
        body['max_budget'] = parseInput(BudgetSchema, input.maxBudget);
      }
      if (input.budgetDuration !== undefined) {
        body['budget_duration'] = parseInput(DurationSchema, input.budgetDuration);
      }
      if (input.tpmLimit !== undefined) {
        body['tpm_limit'] = parseInput(LimitSchema, input.tpmLimit);
      }
      if (input.rpmLimit !== undefined) {
        body['rpm_limit'] = parseInput(LimitSchema, input.rpmLimit);
      }
      if (input.keyAlias !== undefined) {
        body['key_alias'] = parseInput(AliasSchema, input.keyAlias);
      }
      if (input.metadata !== undefined) {
        body['metadata'] = input.metadata;
      }

      const parsed = parseResponse(
        'key/generate',
        GeneratedKeySchema,
        await post('key/generate', '/key/generate', body),
      );
      return toVirtualKey(parsed);
    },

    async getKeyInfo(key: string): Promise<VirtualKeyInfo> {
      const parsedKey = parseInput(KeySchema, key);
      const parsed = parseResponse(
        'key/info',
        KeyInfoResponseSchema,
        await request(
          'key/info',
          `/key/info?key=${encodeURIComponent(parsedKey)}`,
          { method: 'GET', headers: headers() },
          [parsedKey],
        ),
      );
      return {
        keyAlias: parsed.info.key_alias ?? null,
        maxBudget: parsed.info.max_budget ?? null,
        spend: parsed.info.spend,
        tpmLimit: parsed.info.tpm_limit ?? null,
        rpmLimit: parsed.info.rpm_limit ?? null,
        blocked: parsed.info.blocked ?? null,
        models: parsed.info.models ?? [],
      };
    },

    async updateKey(input: UpdateVirtualKeyInput): Promise<VirtualKeyInfo> {
      const key = parseInput(KeySchema, input.key);
      const body: Record<string, unknown> = { key };
      if (input.models !== undefined) {
        body['models'] = parseInput(ModelsSchema, input.models);
      }
      if (input.maxBudget !== undefined) {
        body['max_budget'] = parseInput(BudgetSchema, input.maxBudget);
      }
      if (input.tpmLimit !== undefined) {
        body['tpm_limit'] = parseInput(LimitSchema, input.tpmLimit);
      }
      if (input.rpmLimit !== undefined) {
        body['rpm_limit'] = parseInput(LimitSchema, input.rpmLimit);
      }
      if (input.blocked !== undefined) {
        body['blocked'] = input.blocked;
      }
      if (input.spend !== undefined) {
        body['spend'] = parseInput(SpendSchema, input.spend);
      }

      const parsed = parseResponse(
        'key/update',
        UpdateResponseSchema,
        await post('key/update', '/key/update', body, [key]),
      );
      return toKeyInfo(parsed);
    },

    async revokeKey(key: string): Promise<void> {
      const parsedKey = parseInput(KeySchema, key);
      try {
        const parsed = parseResponse(
          'key/delete',
          DeleteResponseSchema,
          await post('key/delete', '/key/delete', { keys: [parsedKey] }, [parsedKey]),
        );
        if (parsed.deleted_keys !== undefined && !parsed.deleted_keys.includes(parsedKey)) {
          throw new LitellmApiError('key/delete', 200, 'LiteLLM did not delete the key');
        }
      } catch (error) {
        // Already gone is the state the caller asked for.
        if (error instanceof LitellmApiError && keyAlreadyGone(error)) {
          return;
        }
        throw error;
      }
    },

    async addModel(input: AddModelInput): Promise<string> {
      const body: Record<string, unknown> = {
        model_name: parseInput(ModelNameSchema, input.modelName),
        litellm_params: {
          model: parseInput(ProviderModelSchema, input.litellmModel),
          api_key: parseInput(ApiKeySchema, input.apiKey),
        },
      };
      if (input.metadata !== undefined) {
        body['model_info'] = input.metadata;
      }

      // The provider key travels in this body, so it is named as a secret for
      // the whole request: any error or log line redacts it.
      const parsed = parseResponse(
        'model/new',
        NewModelResponseSchema,
        await post('model/new', '/model/new', body, [input.apiKey]),
      );
      const modelId = parsed.model_id ?? parsed.model_info?.id;
      if (modelId === undefined) {
        throw new LitellmApiError('model/new', 200, 'unexpected response shape');
      }
      return modelId;
    },

    async deleteModel(modelId: string): Promise<void> {
      const id = parseInput(ModelIdSchema, modelId);
      try {
        parseResponse(
          'model/delete',
          DeleteModelResponseSchema,
          await post('model/delete', '/model/delete', { id }),
        );
      } catch (error) {
        // Already gone is the state the caller asked for.
        if (error instanceof LitellmApiError && modelAlreadyGone(error)) {
          return;
        }
        throw error;
      }
    },

    async listModels(): Promise<ModelListing[]> {
      const parsed = parseResponse(
        'model/info',
        ModelListResponseSchema,
        await request('model/info', '/model/info', { method: 'GET', headers: headers() }, []),
      );
      return (parsed.data ?? []).flatMap((entry) => {
        const id = entry.model_id ?? entry.model_info?.id;
        return id !== undefined && entry.model_name !== undefined
          ? [{ id, name: entry.model_name }]
          : [];
      });
    },
  };
}

// Builds the client from the server config. Throws when the master key is not
// configured, so a missing secret fails at startup rather than on first use.
export function createLitellmAdminClientFromConfig(
  config: Pick<ServerConfig, 'LITELLM_BASE_URL' | 'LITELLM_MASTER_KEY'>,
  fetchImpl: FetchLike = fetch,
): LitellmAdminClient {
  if (!config.LITELLM_MASTER_KEY) {
    throw new Error('LITELLM_MASTER_KEY is not configured');
  }
  return createLitellmAdminClient(
    {
      baseUrl: config.LITELLM_BASE_URL ?? DEFAULT_LITELLM_BASE_URL,
      masterKey: config.LITELLM_MASTER_KEY,
    },
    fetchImpl,
  );
}
