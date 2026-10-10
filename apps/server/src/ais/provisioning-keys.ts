import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { decryptForGatewayUseEffect, findOwnedConnection } from '../connections/service';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { modelNameForAi } from '../ai/model-entry';
import { isLlmProvider, litellmModelFor } from './litellm-model';
import { type AiServiceDeps, updateFailed } from './persona';
import { findAiForGateway, findGatewayAiEffect, findOwnedAi } from './queries';

// LiteLLM's budget window for every AI key. `per_day_usd` is stored for the
// daily ledger a later task builds; the gateway does not enforce a daily cap.
export const VIRTUAL_KEY_BUDGET_DURATION = '30d';

// The LiteLLM key alias and metadata both name the AI id, so a human reading
// LiteLLM's dashboard can tell which AI a key belongs to without our database.
export function virtualKeyAlias(aiId: string): string {
  return `zilar-ai-${aiId}`;
}

// Deletes every LiteLLM model registered under `modelName`: the live id and
// any stray an earlier attempt left behind (a crash between `addModel` and the
// row update). A stray that cannot be deleted is logged, never thrown: the
// caller decides what a failed delete means.
export async function deleteModelsNamed(
  deps: AiServiceDeps,
  aiId: string,
  modelName: string,
): Promise<void> {
  for (const stray of await deps.litellm.listModels()) {
    if (stray.name === modelName) {
      try {
        await deps.litellm.deleteModel(stray.id);
      } catch (error) {
        deps.logger.warn({ err: error, aiId }, 'could not delete a stray AI model');
      }
    }
  }
}

// Registers `litellmModel` under `modelName` for `keyId`, holding the owner's
// key. If the allowlist cannot be fixed, the model just registered is deleted
// best-effort rather than left as an orphan no key can reach.
async function registerModelWithKey(
  deps: AiServiceDeps,
  input: {
    aiId: string;
    keyId: string;
    modelName: string;
    litellmModel: string;
    apiKey: string;
  },
): Promise<string> {
  const modelId = await deps.litellm.addModel({
    modelName: input.modelName,
    litellmModel: input.litellmModel,
    apiKey: input.apiKey,
    metadata: { ai_id: input.aiId },
  });

  // If the allowlist cannot be fixed, drop the model we just registered
  // rather than leave an orphan no key can reach; the next call registers
  // it again.
  try {
    await deps.litellm.updateKey({ key: input.keyId, models: [input.modelName] });
  } catch (error) {
    await deps.litellm.deleteModel(modelId).catch(() => undefined);
    throw error;
  }
  return modelId;
}

// Backfills the private LiteLLM model on an AI created before this task, and
// points an older virtual key's allowlist at it. Safe to call concurrently:
// an in-process mutex per AI plus a Postgres advisory transaction lock keyed
// by the AI id serialize callers, the model id is re-read after taking the
// lock, and a model named `ai-<id>` left behind by an earlier attempt is
// reclaimed before registering again. There is no route for it.
export async function ensureAiModel(deps: AiServiceDeps, aiId: string): Promise<void> {
  const known = await findAiForGateway(deps.db, aiId);
  if (!known) {
    throw new Error(`AI ${aiId} not found`);
  }
  if (known.litellmModelId !== null) {
    return;
  }

  return withAiEnsureLock(aiId, () =>
    runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            // Cross-process serialization. The lock is held to the end of this
            // transaction, so everything below runs exactly once per AI.
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${aiId}), ${ENSURE_MODEL_LOCK_SCOPE})`;
            // The transaction's own connection: the unit-test database shares a
            // single connection, so every read inside the lock runs inside the
            // effect/sql transaction.
            const ai = yield* findGatewayAiEffect(aiId);
            if (!ai) {
              return yield* Effect.fail(new Error(`AI ${aiId} not found`));
            }
            if (ai.litellmModelId !== null) {
              return;
            }
            if (ai.litellmKeyId === null) {
              return yield* Effect.fail(new Error(`AI ${aiId} has no virtual key`));
            }
            const keyId = ai.litellmKeyId;

            const modelName = modelNameForAi(ai.id);
            // A previous attempt may have registered `ai-<id>` without storing the
            // id (a crash between `addModel` and the row update). Reclaim the name
            // so the orphan is not left behind.
            yield* Effect.tryPromise({
              try: () => deleteModelsNamed(deps, ai.id, modelName),
              catch: (error) => error,
            });

            const providerKey = yield* decryptForGatewayUseEffect(
              deps.cipher,
              ai.providerConnectionId,
            );
            const modelId = yield* Effect.tryPromise({
              try: () =>
                registerModelWithKey(deps, {
                  aiId: ai.id,
                  keyId,
                  modelName,
                  litellmModel: litellmModelFor(ai.provider, ai.model),
                  apiKey: providerKey,
                }),
              catch: (error) => error,
            });

            yield* sql`UPDATE llm_virtual_keys SET litellm_model_id = ${modelId}
              WHERE ai_id = ${ai.id}`;
          }),
        );
      }),
    ),
  );
}

export interface ChangeAiModelInput {
  id: string;
  ownerId: string;
  model: string;
  providerConnectionId: string;
}

// Switches an AI to a new model (and optionally a new provider connection).
// The private LiteLLM model is replaced behind the same name `ai-<id>`, so
// the virtual key's allowlist and the gateway don't change. Runs under the
// same locks as `ensureAiModel` (the in-process mutex and the Postgres
// advisory lock), so it can never race a gateway `ensureAiModel`.
//
// A turn in flight during the swap may fail once with the gateway's honest
// failure text: it calls the same `ai-<id>` name while the entry behind it is
// replaced. The next turn works.
export async function changeAiModel(deps: AiServiceDeps, input: ChangeAiModelInput): Promise<void> {
  const model = input.model.trim();
  if (model === '') {
    throw new HttpError(400, 'invalid_request', 'A model is required');
  }

  return withAiEnsureLock(input.id, async () => {
    const ai = await findOwnedAi(deps.db, input.id, input.ownerId);
    if (!ai) {
      throw new HttpError(404, 'not_found', 'AI not found');
    }
    if (model === ai.model && input.providerConnectionId === ai.providerConnectionId) {
      return;
    }
    if (ai.litellmKeyId === null) {
      throw updateFailed();
    }
    // A foreign or missing connection answers the same 404 as a foreign AI,
    // so existence is never leaked; a known-but-unusable one answers the same
    // 400 `createAi` gives.
    const connection = await findOwnedConnection(
      deps.db,
      input.providerConnectionId,
      input.ownerId,
    );
    if (!connection) {
      throw new HttpError(404, 'not_found', 'AI not found');
    }
    if (connection.status !== 'active') {
      throw new HttpError(400, 'connection_inactive', 'That provider connection is not active');
    }
    if (!isLlmProvider(connection.provider)) {
      throw new HttpError(
        400,
        'connection_not_llm',
        'That provider connection is not an LLM provider',
      );
    }

    const modelName = modelNameForAi(ai.id);
    const litellmModel = litellmModelFor(connection.provider, model);
    let deletedOld = false;
    try {
      await runSql(
        deps.db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`SELECT pg_advisory_xact_lock(hashtext(${ai.id}), ${ENSURE_MODEL_LOCK_SCOPE})`;
              const fresh = yield* findGatewayAiEffect(ai.id);
              if (!fresh || fresh.owner !== input.ownerId) {
                return yield* Effect.fail(new HttpError(404, 'not_found', 'AI not found'));
              }
              if (
                fresh.model === model &&
                fresh.providerConnectionId === input.providerConnectionId &&
                fresh.litellmModelId !== null
              ) {
                return;
              }
              if (fresh.litellmKeyId === null) {
                return yield* Effect.fail(updateFailed());
              }
              const keyId = fresh.litellmKeyId;

              const providerKey = yield* decryptForGatewayUseEffect(deps.cipher, connection.id);
              const previousModelId = fresh.litellmModelId;
              if (previousModelId !== null) {
                yield* Effect.tryPromise({
                  try: () => deps.litellm.deleteModel(previousModelId),
                  catch: (error) => error,
                });
              }
              deletedOld = true;
              yield* Effect.tryPromise({
                try: () => deleteModelsNamed(deps, ai.id, modelName),
                catch: (error) => error,
              });
              const created = yield* Effect.tryPromise({
                try: () =>
                  registerModelWithKey(deps, {
                    aiId: ai.id,
                    keyId,
                    modelName,
                    litellmModel,
                    apiKey: providerKey,
                  }),
                catch: (error) => error,
              });

              yield* sql`UPDATE ais SET model = ${model},
                provider_connection_id = ${connection.id}, updated_at = ${new Date()}
                WHERE id = ${ai.id}`;
              yield* sql`UPDATE llm_virtual_keys SET litellm_model_id = ${created}
                WHERE ai_id = ${ai.id}`;
            }),
          );
        }),
      );
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      deps.logger.warn({ err: error, aiId: ai.id }, 'could not switch the AI model');
      if (deletedOld) {
        // The old model is gone but the new one isn't: leave the AI row on
        // the old model and connection, and clear the stale model id so the
        // next gateway turn re-registers the old model via `ensureAiModel`.
        // A separate locked transaction: the first one already rolled back.
        // The owner is re-checked as in the main path; a row that is gone or
        // no longer ours is left alone, and the update failure still stands.
        try {
          await runSql(
            deps.db,
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* sql.withTransaction(
                Effect.gen(function* () {
                  yield* sql`SELECT pg_advisory_xact_lock(hashtext(${ai.id}), ${ENSURE_MODEL_LOCK_SCOPE})`;
                  const [ownerRow] = yield* sql<{ owner: string }>`SELECT owner FROM ais
                    WHERE id = ${ai.id} LIMIT 1`;
                  if (!ownerRow || ownerRow.owner !== input.ownerId) {
                    return;
                  }
                  yield* sql`UPDATE llm_virtual_keys SET litellm_model_id = NULL WHERE ai_id = ${ai.id}`;
                }),
              );
            }),
          );
        } catch (clearError) {
          deps.logger.warn({ err: clearError, aiId: ai.id }, 'could not clear the AI model id');
        }
      }
      throw updateFailed();
    }
  });
}

// Second advisory-lock key, so AI-model locks never collide with other
// advisory-lock users in this database.
export const ENSURE_MODEL_LOCK_SCOPE = 730033;

// One in-process mutex per AI. The Postgres advisory lock above serializes
// across processes and hosts; this serializes the awaits inside this process,
// which is also what makes the race unit-testable (the unit-test database
// shares a single connection, on which advisory locks re-grant to the holder).
const ensureModelLocks = new Map<string, Promise<void>>();

export async function withAiEnsureLock<T>(aiId: string, work: () => Promise<T>): Promise<T> {
  const previous = ensureModelLocks.get(aiId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const turn = previous.then(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  ensureModelLocks.set(aiId, turn);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (ensureModelLocks.get(aiId) === turn) {
      ensureModelLocks.delete(aiId);
    }
  }
}
