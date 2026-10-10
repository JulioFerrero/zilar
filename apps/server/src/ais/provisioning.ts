import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { decryptForGatewayUse, findOwnedConnection } from '../connections/service';
import { ROSTER_GROUP } from '../contacts/service';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { modelNameForAi } from '../ai/model-entry';
import { ensureXmppAccount, jidFor, localpartFor } from '../xmpp/provisioning';
import { isLlmProvider, litellmModelFor } from './litellm-model';
import {
  type AiServiceDeps,
  type CreateAiInput,
  type PublicAi,
  type UpdateAiInput,
  provisioningFailed,
  resolvePersona,
  updateFailed,
} from './persona';
import { VIRTUAL_KEY_BUDGET_DURATION, changeAiModel, virtualKeyAlias } from './provisioning-keys';
import { aiLocalpart, compensateCreate } from './provisioning-xmpp';
import { emitAiLifecycle, findOwnedAi, toPublicAi } from './queries';

// Creates an AI: rows, XMPP account, both roster items, a private LiteLLM model
// for the owner's key, then a capped virtual key that may call only it.
// All-or-nothing: any external failure rolls everything back and answers 502.
// The AI is inserted `disabled` and only switched to `active` once every step
// has succeeded, so a crash can never leave a usable-looking half AI.
export async function createAi(deps: AiServiceDeps, input: CreateAiInput): Promise<PublicAi> {
  const connection = await findOwnedConnection(deps.db, input.providerConnectionId, input.ownerId);
  if (!connection) {
    throw new HttpError(400, 'invalid_connection', 'That provider connection is not yours');
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

  const persona = resolvePersona(input.template, input.persona);
  const id = randomUUID();
  const localpart = aiLocalpart(id);
  const jid = jidFor(localpart, deps.domain);
  const ownerLocalpart = localpartFor(input.ownerId);
  const ownerJid = jidFor(ownerLocalpart, deps.domain);

  // The owner needs an XMPP account before the AI can be in their roster. A
  // failure here is an external failure like any other, but no AI rows exist
  // yet, so there is nothing to compensate.
  let ownerName: string;
  try {
    await ensureXmppAccount(deps.db, deps.adminClient, input.ownerId, deps.domain);
    ownerName = await findUserName(deps.db, input.ownerId);
  } catch (error) {
    deps.logger.warn({ err: error, ownerId: input.ownerId }, 'could not provision the AI owner');
    throw provisioningFailed();
  }

  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status)
        VALUES (${id}, ${input.ownerId}, ${input.name}, ${input.template}, ${persona}, ${input.providerConnectionId}, ${input.model}, ${localpart}, ${jid}, 'disabled')`;
    }),
  );
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO ai_limits (ai_id, per_day_usd, per_month_usd)
        VALUES (${id}, ${usd(input.limits.perDayUsd)}, ${usd(input.limits.perMonthUsd)})`;
    }),
  );

  let registered = false;
  let keyId: string | undefined;
  let modelId: string | undefined;
  try {
    await deps.adminClient.registerUser(localpart);
    registered = true;
    await deps.adminClient.addRosterItem(ownerLocalpart, jid, {
      nick: input.name,
      groups: [ROSTER_GROUP],
      subs: 'both',
    });
    await deps.adminClient.addRosterItem(localpart, ownerJid, {
      nick: ownerName,
      groups: [ROSTER_GROUP],
      subs: 'both',
    });

    // The provider key is decrypted once, in memory, and handed to LiteLLM as
    // its own private model for this AI. It is never stored or returned here;
    // LiteLLM keeps its own encrypted copy (`store_model_in_db`).
    const modelName = modelNameForAi(id);
    const providerKey = await decryptForGatewayUse(deps.db, deps.cipher, connection.id);
    modelId = await deps.litellm.addModel({
      modelName,
      litellmModel: litellmModelFor(connection.provider, input.model),
      apiKey: providerKey,
      metadata: { ai_id: id },
    });

    const issued = await deps.litellm.generateKey({
      models: [modelName],
      maxBudget: input.limits.perMonthUsd,
      budgetDuration: VIRTUAL_KEY_BUDGET_DURATION,
      keyAlias: virtualKeyAlias(id),
      metadata: { ai_id: id },
    });
    keyId = issued.id;
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO llm_virtual_keys (ai_id, litellm_key_id, litellm_model_id, encrypted_key, budget_usd, budget_duration)
          VALUES (${id}, ${issued.id}, ${modelId}, ${deps.cipher.encrypt(issued.key)}, ${usd(input.limits.perMonthUsd)}, ${VIRTUAL_KEY_BUDGET_DURATION})`;
      }),
    );

    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE ais SET status = 'active', updated_at = ${new Date()} WHERE id = ${id}`;
      }),
    );
  } catch (error) {
    deps.logger.warn({ err: error, aiId: id }, 'AI provisioning failed; rolling back');
    await compensateCreate(deps, {
      id,
      localpart,
      jid,
      ownerLocalpart,
      ownerJid,
      registered,
      keyId,
      modelId,
    });
    throw provisioningFailed();
  }

  const created = await findOwnedAi(deps.db, id, input.ownerId);
  if (!created) {
    throw provisioningFailed();
  }
  emitAiLifecycle({ type: 'created', aiId: id });
  return toPublicAi(created);
}

// Updates an AI's name, persona or limits. The external steps come first, so a
// gateway or chat-service failure leaves the stored AI unchanged.
export async function updateAi(deps: AiServiceDeps, input: UpdateAiInput): Promise<PublicAi> {
  const ai = await findOwnedAi(deps.db, input.id, input.ownerId);
  if (!ai) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }

  if (input.providerConnectionId !== undefined && input.model === undefined) {
    throw new HttpError(
      400,
      'invalid_request',
      'A new provider connection needs an explicit model',
    );
  }

  // The model swap goes first: it is the only step that touches LiteLLM, and
  // a failure there leaves the name, persona and limits untouched too.
  const newModel = input.model ?? ai.model;
  const newConnectionId = input.providerConnectionId ?? ai.providerConnectionId;
  if (newModel !== ai.model || newConnectionId !== ai.providerConnectionId) {
    await changeAiModel(deps, {
      id: ai.id,
      ownerId: input.ownerId,
      model: newModel,
      providerConnectionId: newConnectionId,
    });
  }

  if (input.name !== undefined && input.name !== ai.name) {
    try {
      await deps.adminClient.addRosterItem(localpartFor(input.ownerId), ai.jid, {
        nick: input.name,
        groups: [ROSTER_GROUP],
        subs: 'both',
      });
    } catch (error) {
      deps.logger.warn({ err: error, aiId: ai.id }, 'could not rename the AI in the owner roster');
      throw updateFailed();
    }
  }

  if (input.limits !== undefined) {
    if (ai.litellmKeyId === null) {
      throw updateFailed();
    }
    try {
      await deps.litellm.updateKey({ key: ai.litellmKeyId, maxBudget: input.limits.perMonthUsd });
    } catch (error) {
      deps.logger.warn({ err: error, aiId: ai.id }, 'could not update the AI virtual key cap');
      throw updateFailed();
    }
  }

  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          if (
            input.name !== undefined ||
            input.persona !== undefined ||
            input.canDelegate !== undefined ||
            input.acceptsDelegation !== undefined
          ) {
            // Every column here is NOT NULL, so a null means "keep the current
            // value": COALESCE gives a partial update.
            yield* sql`UPDATE ais SET
              name = COALESCE(${input.name ?? null}, name),
              persona = COALESCE(${input.persona ?? null}, persona),
              can_delegate = COALESCE(${input.canDelegate ?? null}, can_delegate),
              accepts_delegation = COALESCE(${input.acceptsDelegation ?? null}, accepts_delegation),
              updated_at = ${new Date()}
              WHERE id = ${ai.id}`;
          }
          if (input.limits !== undefined) {
            yield* sql`UPDATE ai_limits SET
              per_day_usd = ${usd(input.limits.perDayUsd)},
              per_month_usd = ${usd(input.limits.perMonthUsd)},
              updated_at = ${new Date()}
              WHERE ai_id = ${ai.id}`;
            // Keep the key row's stored budget in step with the cap pushed to
            // LiteLLM above, in the same transaction.
            yield* sql`UPDATE llm_virtual_keys SET budget_usd = ${usd(input.limits.perMonthUsd)}
              WHERE ai_id = ${ai.id}`;
          }
        }),
      );
    }),
  );

  const updated = await findOwnedAi(deps.db, ai.id, input.ownerId);
  if (!updated) {
    throw updateFailed();
  }
  return toPublicAi(updated);
}

async function findUserName(db: ServerDatabase, userId: string): Promise<string> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ name: string }>`SELECT name FROM "user" WHERE id = ${userId} LIMIT 1`;
    }),
  );
  return row?.name ?? '';
}

// `numeric` columns are strings; two decimal places is the currency precision
// the schema stores. Comparisons (perDayUsd <= perMonthUsd, the monthly cap)
// already happened on the numbers at the route boundary.
function usd(value: number): string {
  return value.toFixed(2);
}
