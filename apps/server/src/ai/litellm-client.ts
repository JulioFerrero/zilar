// effect-plain: async LiteLLM admin client; its Effect/Schema code moved to ai/litellm-schemas.ts (size split)
import type { ServerConfig } from '../config';
import {
  DEFAULT_LITELLM_BASE_URL,
  LitellmApiError,
  type AddModelInput,
  type FetchLike,
  type GenerateVirtualKeyInput,
  type LitellmAdminClient,
  type LitellmClientConfig,
  type ModelListing,
  type UpdateVirtualKeyInput,
  type VirtualKey,
  type VirtualKeyInfo,
} from './litellm-types';
import {
  AliasSchema,
  ApiKeySchema,
  BudgetSchema,
  DeleteModelResponseSchema,
  DeleteResponseSchema,
  DurationSchema,
  GeneratedKeySchema,
  KeyInfoResponseSchema,
  KeySchema,
  LimitSchema,
  ModelIdSchema,
  ModelListResponseSchema,
  ModelNameSchema,
  ModelsSchema,
  NewModelResponseSchema,
  ProviderModelSchema,
  SpendSchema,
  UpdateResponseSchema,
  errorDetail,
  isErrorBody,
  keyAlreadyGone,
  modelAlreadyGone,
  parseInput,
  parseResponse,
  redactSecrets,
  toKeyInfo,
  toVirtualKey,
} from './litellm-schemas';

export * from './litellm-types';
export { redactSecrets };

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
