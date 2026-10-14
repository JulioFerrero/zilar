import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { isLlmProvider } from '../connections/providers';
import { findOwnedConnection } from '../connections/service';
import { ROSTER_GROUP } from '../contacts/service';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { ensureXmppAccount, jidFor, localpartFor } from '../xmpp/provisioning';
import {
  type AiServiceDeps,
  type CreateAiInput,
  type PublicAi,
  type UpdateAiInput,
  provisioningFailed,
  resolvePersona,
  updateFailed,
} from './persona';
import { aiLocalpart, compensateCreate } from './provisioning-xmpp';
import { emitAiLifecycle, findOwnedAi, toPublicAi } from './queries';

// Creates an AI: rows, XMPP account and both roster items. The provider key is
// not read here: the AI's turn decrypts the owner's connection per call. All
// remote failures roll the account back and answer 502. The AI is inserted
// `disabled` and only switched to `active` once every step has succeeded, so a
// crash can never leave a usable-looking half AI.
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
// chat-service failure leaves the stored AI unchanged.
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

  // T-1423: `runner` and `auto` run on the AI's assigned machine, so a mode
  // change to either without one is refused the same way an unknown field is.
  if ((input.computerMode === 'runner' || input.computerMode === 'auto') && ai.machineId === null) {
    throw new HttpError(400, 'invalid_request', 'Runner and auto modes need an assigned machine');
  }

  // The model swap goes first: a failure there leaves the name, persona and
  // limits untouched too.
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
            input.acceptsDelegation !== undefined ||
            input.computerMode !== undefined
          ) {
            // Every column here is NOT NULL, so a null means "keep the current
            // value": COALESCE gives a partial update.
            yield* sql`UPDATE ais SET
              name = COALESCE(${input.name ?? null}, name),
              persona = COALESCE(${input.persona ?? null}, persona),
              can_delegate = COALESCE(${input.canDelegate ?? null}, can_delegate),
              accepts_delegation = COALESCE(${input.acceptsDelegation ?? null}, accepts_delegation),
              computer_mode = COALESCE(${input.computerMode ?? null}, computer_mode),
              updated_at = ${new Date()}
              WHERE id = ${ai.id}`;
          }
          if (input.limits !== undefined) {
            yield* sql`UPDATE ai_limits SET
              per_day_usd = ${usd(input.limits.perDayUsd)},
              per_month_usd = ${usd(input.limits.perMonthUsd)},
              updated_at = ${new Date()}
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

export interface ChangeAiModelInput {
  id: string;
  ownerId: string;
  model: string;
  providerConnectionId: string;
}

// Switches an AI to a new model (and optionally a new provider connection).
// Nothing is registered remotely: the AI row's `model` and
// `provider_connection_id` are the only state, and each turn reads the owner's
// connection and decrypts the key itself. The connection is validated exactly
// as `createAi` does (owned, active, an LLM provider), and the read and the
// update share one transaction so a concurrent change is never overwritten.
export async function changeAiModel(deps: AiServiceDeps, input: ChangeAiModelInput): Promise<void> {
  const model = input.model.trim();
  if (model === '') {
    throw new HttpError(400, 'invalid_request', 'A model is required');
  }

  const ai = await findOwnedAi(deps.db, input.id, input.ownerId);
  if (!ai) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }
  if (model === ai.model && input.providerConnectionId === ai.providerConnectionId) {
    return;
  }
  // A foreign or missing connection answers the same 404 as a foreign AI, so
  // existence is never leaked; a known-but-unusable one answers the same 400
  // `createAi` gives.
  const connection = await findOwnedConnection(deps.db, input.providerConnectionId, input.ownerId);
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

  try {
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            // The state is diffed inside the transaction, so the row the update
            // lands on is the one just read.
            const [fresh] = yield* sql<{
              owner: string;
              model: string;
              providerConnectionId: string;
            }>`SELECT owner, model, provider_connection_id FROM ais
              WHERE id = ${input.id} LIMIT 1`;
            if (!fresh || fresh.owner !== input.ownerId) {
              return yield* Effect.fail(new HttpError(404, 'not_found', 'AI not found'));
            }
            if (fresh.model === model && fresh.providerConnectionId === connection.id) {
              return;
            }
            yield* sql`UPDATE ais SET model = ${model},
              provider_connection_id = ${connection.id}, updated_at = ${new Date()}
              WHERE id = ${input.id}`;
          }),
        );
      }),
    );
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    deps.logger.warn({ err: error, aiId: input.id }, 'could not switch the AI model');
    throw updateFailed();
  }
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
// the schema stores. A `null` bound means "no limit" and is stored as NULL.
// Comparisons (perDayUsd <= perMonthUsd, the monthly cap) already happened on
// the numbers at the route boundary.
function usd(value: number | null): string | null {
  return value === null ? null : value.toFixed(2);
}
