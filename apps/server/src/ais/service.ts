import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { KeyCipher } from '../connections/crypto';
import { decryptForGatewayUse, findOwnedConnection } from '../connections/service';
import { ROSTER_GROUP } from '../contacts/service';
import type { ServerDatabase } from '../db/client';
import { aiLimits, ais, llmVirtualKeys, providerConnections, user } from '../db/schema';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { ensureXmppAccount, jidFor, localpartFor } from '../xmpp/provisioning';
import type { LitellmAdminClient } from '../ai/litellm-client';
import { modelNameForAi } from '../ai/model-entry';
import { isLlmProvider, litellmModelFor } from './litellm-model';
import { defaultPersonaFor, type AiTemplate } from './templates';

// The server ceiling on an AI's monthly budget. The plan's example is EUR 20 a
// month; the cap is a product safety limit (a client can never widen it) and a
// comment here so changing it is a deliberate act, not a magic number.
export const MAX_MONTHLY_USD = 200;

// LiteLLM's budget window for every AI key. `per_day_usd` is stored for the
// daily ledger a later task builds; the gateway does not enforce a daily cap.
export const VIRTUAL_KEY_BUDGET_DURATION = '30d';

export interface AiLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface AiLimits {
  perDayUsd: number;
  perMonthUsd: number;
}

export interface PublicAi {
  id: string;
  name: string;
  template: AiTemplate;
  persona: string;
  model: string;
  jid: string;
  status: 'active' | 'disabled';
  providerConnectionId: string;
  limits: AiLimits;
  createdAt: Date;
}

export interface AiServiceDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  litellm: LitellmAdminClient;
  cipher: KeyCipher;
  logger: AiLogger;
  domain: string;
}

export interface CreateAiInput {
  ownerId: string;
  name: string;
  template: AiTemplate;
  persona?: string;
  providerConnectionId: string;
  model: string;
  limits: AiLimits;
}

export interface UpdateAiInput {
  id: string;
  ownerId: string;
  name?: string;
  persona?: string;
  limits?: AiLimits;
  model?: string;
  providerConnectionId?: string;
}

// The localpart of an AI XMPP account: the `ai-` prefix plus a stable,
// id-derived suffix. For our random UUIDs this is `ai-<uuid>`; anything exotic
// falls back to the same hash the user provisioning uses. Always valid for the
// admin client's `[a-z0-9._-]{1,64}` rule.
export function aiLocalpart(aiId: string): string {
  return `ai-${localpartFor(aiId)}`.slice(0, 64);
}

// The LiteLLM key alias and metadata both name the AI id, so a human reading
// LiteLLM's dashboard can tell which AI a key belongs to without our database.
export function virtualKeyAlias(aiId: string): string {
  return `galena-ai-${aiId}`;
}

export async function listAis(db: ServerDatabase, ownerId: string): Promise<PublicAi[]> {
  const rows = await db
    .select(publicAiColumns)
    .from(ais)
    .innerJoin(aiLimits, eq(aiLimits.aiId, ais.id))
    .where(eq(ais.owner, ownerId))
    .orderBy(asc(ais.createdAt));
  return rows.map(toPublicAi);
}

// Every active AI, for the agent gateway (T-0034). The gateway resolves the
// AI id itself from this listing and never from message content.
export interface ActiveAiForGateway {
  id: string;
  jid: string;
  localpart: string;
  owner: string;
  name: string;
  persona: string;
}

export async function listActiveAisForGateway(db: ServerDatabase): Promise<ActiveAiForGateway[]> {
  return db
    .select({
      id: ais.id,
      jid: ais.jid,
      localpart: ais.localpart,
      owner: ais.owner,
      name: ais.name,
      persona: ais.persona,
    })
    .from(ais)
    .where(eq(ais.status, 'active'))
    .orderBy(asc(ais.createdAt));
}

// In-process notifier so the gateway learns about created and deleted AIs
// without polling. The gateway also reconciles periodically as a safety net,
// so a missed event only delays a connect, never loses it.
export type AiLifecycleEvent = { type: 'created' | 'deleted'; aiId: string };

const aiLifecycleListeners = new Set<(event: AiLifecycleEvent) => void>();

export function onAiLifecycle(listener: (event: AiLifecycleEvent) => void): () => void {
  aiLifecycleListeners.add(listener);
  return () => {
    aiLifecycleListeners.delete(listener);
  };
}

function emitAiLifecycle(event: AiLifecycleEvent): void {
  // Deleting from a Set while iterating it is safe: a listener that
  // unsubscribes mid-emit is simply not visited again.
  for (const listener of aiLifecycleListeners) {
    try {
      listener(event);
    } catch {
      // A gateway listener must never break AI management.
    }
  }
}

// One AI owned by `ownerId`, or null for a missing id and a foreign one alike,
// so existence is never leaked. The internal shape carries the gateway key id
// and identity the public shape deliberately omits.
export async function findOwnedAi(
  db: ServerDatabase,
  id: string,
  ownerId: string,
): Promise<AiRecord | null> {
  const [row] = await db
    .select(aiColumns)
    .from(ais)
    .innerJoin(aiLimits, eq(aiLimits.aiId, ais.id))
    .leftJoin(llmVirtualKeys, eq(llmVirtualKeys.aiId, ais.id))
    .where(and(eq(ais.id, id), eq(ais.owner, ownerId)))
    .limit(1);
  return row ?? null;
}

// One AI by id, with its connection's provider, for the gateway-only paths
// (`ensureAiModel`) that have no owner in hand. Not exported: no route may use
// it.
async function findAiForGateway(db: ServerDatabase, aiId: string): Promise<GatewayAiRecord | null> {
  const [row] = await db
    .select({ ...aiColumns, provider: providerConnections.provider, owner: ais.owner })
    .from(ais)
    .innerJoin(aiLimits, eq(aiLimits.aiId, ais.id))
    .leftJoin(llmVirtualKeys, eq(llmVirtualKeys.aiId, ais.id))
    .innerJoin(providerConnections, eq(providerConnections.id, ais.providerConnectionId))
    .where(eq(ais.id, aiId))
    .limit(1);
  return row ?? null;
}

// The public form of one owned AI, shaped for the API and the wizard.
export async function getOwnedAi(
  db: ServerDatabase,
  id: string,
  ownerId: string,
): Promise<PublicAi | null> {
  const row = await findOwnedAi(db, id, ownerId);
  return row ? toPublicAi(row) : null;
}

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

  await deps.db.insert(ais).values({
    id,
    owner: input.ownerId,
    name: input.name,
    template: input.template,
    persona,
    providerConnectionId: input.providerConnectionId,
    model: input.model,
    localpart,
    jid,
    status: 'disabled',
  });
  await deps.db.insert(aiLimits).values({
    aiId: id,
    perDayUsd: usd(input.limits.perDayUsd),
    perMonthUsd: usd(input.limits.perMonthUsd),
  });

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
    await deps.db.insert(llmVirtualKeys).values({
      aiId: id,
      litellmKeyId: issued.id,
      litellmModelId: modelId,
      encryptedKey: deps.cipher.encrypt(issued.key),
      budgetUsd: usd(input.limits.perMonthUsd),
      budgetDuration: VIRTUAL_KEY_BUDGET_DURATION,
    });

    await deps.db
      .update(ais)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(ais.id, id));
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

  await deps.db.transaction(async (tx) => {
    if (input.name !== undefined || input.persona !== undefined) {
      await tx
        .update(ais)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.persona === undefined ? {} : { persona: input.persona }),
          updatedAt: new Date(),
        })
        .where(eq(ais.id, ai.id));
    }
    if (input.limits !== undefined) {
      await tx
        .update(aiLimits)
        .set({
          perDayUsd: usd(input.limits.perDayUsd),
          perMonthUsd: usd(input.limits.perMonthUsd),
          updatedAt: new Date(),
        })
        .where(eq(aiLimits.aiId, ai.id));
      // Keep the key row's stored budget in step with the cap pushed to
      // LiteLLM above, in the same transaction.
      await tx
        .update(llmVirtualKeys)
        .set({ budgetUsd: usd(input.limits.perMonthUsd) })
        .where(eq(llmVirtualKeys.aiId, ai.id));
    }
  });

  const updated = await findOwnedAi(deps.db, ai.id, input.ownerId);
  if (!updated) {
    throw updateFailed();
  }
  return toPublicAi(updated);
}

// The persona ceiling the API enforces (`CreateAiSchema`), repeated here so a
// chat-driven change can never store more than the routes accept.
export const CHAT_PERSONA_MAX_LENGTH = 4000;

// Shapes an AI's persona from its DM, for the gateway only. The AI id always
// comes from the gateway's own session, never from the model's arguments, and
// only `persona`/`previous_persona` change: the model, limits, keys and name
// are untouched. In one transaction the current persona is kept as
// `previous_persona` and the new one stored. Returns the stored persona.
export async function setPersonaFromChat(
  db: ServerDatabase,
  aiId: string,
  persona: string,
): Promise<string> {
  const trimmed = persona.trim().slice(0, CHAT_PERSONA_MAX_LENGTH);
  if (trimmed === '') {
    throw new Error('persona must not be empty');
  }
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ persona: ais.persona })
      .from(ais)
      .where(eq(ais.id, aiId))
      .limit(1);
    if (!row) {
      throw new Error(`AI ${aiId} not found`);
    }
    await tx
      .update(ais)
      .set({ previousPersona: row.persona, persona: trimmed, updatedAt: new Date() })
      .where(eq(ais.id, aiId));
  });
  return trimmed;
}

// Undoes the latest chat-driven persona change, for the gateway only. When
// there is nothing to undo it returns `"nothing to undo"` and stores nothing.
// Otherwise it swaps the two, so a second undo re-applies the change (a
// toggle, one level deep).
export async function revertPersonaFromChat(
  db: ServerDatabase,
  aiId: string,
): Promise<'restored' | 'nothing to undo'> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ persona: ais.persona, previousPersona: ais.previousPersona })
      .from(ais)
      .where(eq(ais.id, aiId))
      .limit(1);
    if (!row) {
      throw new Error(`AI ${aiId} not found`);
    }
    if (row.previousPersona === null) {
      return 'nothing to undo';
    }
    await tx
      .update(ais)
      .set({ persona: row.previousPersona, previousPersona: row.persona, updatedAt: new Date() })
      .where(eq(ais.id, aiId));
    return 'restored';
  });
}

// Tears an AI down in reverse order: revoke the gateway key, delete the private
// model it registered, remove both roster items, unregister the XMPP account,
// then delete the rows. Teardown is resumable: every step skips work that is
// already done, so a delete that failed part way (ejabberd or LiteLLM down) can
// be retried without revoking a key twice, re-deleting a model or failing on an
// item that is already gone. The key row goes only once both are gone.
//
// The gateway steps run under the same locks as `ensureAiModel` and
// `changeAiModel` (the in-process mutex and the Postgres advisory lock): a
// delete racing a model switch re-reads the current model id instead of
// deleting a stale one, so no `ai-<id>` model is ever orphaned with no key row
// and no AI row behind it.
export async function deleteAi(deps: AiServiceDeps, id: string, ownerId: string): Promise<void> {
  const ai = await findOwnedAi(deps.db, id, ownerId);
  if (!ai) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }

  await withAiEnsureLock(ai.id, async () => {
    // 1. Revoke the gateway key and clear its id in place, in a locked
    //    transaction. A retry then sees `litellmKeyId === null` and never
    //    calls revoke again, while the row (and the model id it carries)
    //    survives until the model is gone too.
    await deps.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${ai.id}), ${ENSURE_MODEL_LOCK_SCOPE})`,
      );
      const [keyRow] = await tx
        .select({ litellmKeyId: llmVirtualKeys.litellmKeyId })
        .from(llmVirtualKeys)
        .where(eq(llmVirtualKeys.aiId, ai.id))
        .limit(1);
      if (!keyRow || keyRow.litellmKeyId === null) {
        return;
      }
      try {
        await deps.litellm.revokeKey(keyRow.litellmKeyId);
      } catch (error) {
        deps.logger.warn({ err: error, aiId: ai.id }, 'could not revoke the AI virtual key');
        throw teardownFailed();
      }
      await tx
        .update(llmVirtualKeys)
        .set({ litellmKeyId: null })
        .where(eq(llmVirtualKeys.aiId, ai.id));
    });

    // 2. Delete the private model currently registered for this AI, re-read
    //    under the lock (a model switch may have replaced it after step 0),
    //    plus any stray `ai-<id>` entries. `deleteModel` treats an
    //    already-gone model as success; an AI with no model id is skipped.
    await deps.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${ai.id}), ${ENSURE_MODEL_LOCK_SCOPE})`,
      );
      const [keyRow] = await tx
        .select({ litellmModelId: llmVirtualKeys.litellmModelId })
        .from(llmVirtualKeys)
        .where(eq(llmVirtualKeys.aiId, ai.id))
        .limit(1);
      if (keyRow?.litellmModelId != null) {
        try {
          await deps.litellm.deleteModel(keyRow.litellmModelId);
        } catch (error) {
          deps.logger.warn({ err: error, aiId: ai.id }, 'could not delete the AI private model');
          throw teardownFailed();
        }
      }
      await deleteModelsNamed(deps, ai.id, modelNameForAi(ai.id));

      // 3. Nothing is left to revoke or delete on the gateway side, so the key
      //    row goes.
      await tx.delete(llmVirtualKeys).where(eq(llmVirtualKeys.aiId, ai.id));
    });
  });

  const ownerLocalpart = localpartFor(ownerId);
  const ownerJid = jidFor(ownerLocalpart, deps.domain);

  // 4. The owner's roster item for the AI. Skip it when it is already gone.
  try {
    const roster = await deps.adminClient.getRoster(ownerLocalpart);
    if (hasRosterItem(roster, ai.jid)) {
      await deps.adminClient.deleteRosterItem(ownerLocalpart, ai.jid);
    }
  } catch (error) {
    deps.logger.warn({ err: error, aiId: ai.id }, 'could not remove the AI from the owner roster');
    throw teardownFailed();
  }

  // 5. The AI's own account. If it is already gone, there is nothing left on
  //    that side; otherwise remove the owner's item from its roster first, then
  //    unregister.
  try {
    if (await deps.adminClient.userExists(ai.localpart)) {
      const roster = await deps.adminClient.getRoster(ai.localpart);
      if (hasRosterItem(roster, ownerJid)) {
        await deps.adminClient.deleteRosterItem(ai.localpart, ownerJid);
      }
      await deps.adminClient.unregisterUser(ai.localpart);
    }
  } catch (error) {
    deps.logger.warn({ err: error, aiId: ai.id }, 'could not tear down the AI XMPP account');
    throw teardownFailed();
  }

  await deps.db.delete(ais).where(eq(ais.id, ai.id));
  emitAiLifecycle({ type: 'deleted', aiId: ai.id });
}

// Deletes every LiteLLM model registered under `modelName`: the live id and
// any stray an earlier attempt left behind (a crash between `addModel` and the
// row update). A stray that cannot be deleted is logged, never thrown: the
// caller decides what a failed delete means.
async function deleteModelsNamed(
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

// Reads one AI with its connection's provider inside a transaction. The
// gateway-only paths share it so the row is always fresh under the lock.
async function findGatewayAiIn(
  txDb: ServerDatabase,
  aiId: string,
): Promise<GatewayAiRecord | null> {
  const [ai] = await txDb
    .select({ ...aiColumns, provider: providerConnections.provider, owner: ais.owner })
    .from(ais)
    .innerJoin(aiLimits, eq(aiLimits.aiId, ais.id))
    .leftJoin(llmVirtualKeys, eq(llmVirtualKeys.aiId, ais.id))
    .innerJoin(providerConnections, eq(providerConnections.id, ais.providerConnectionId))
    .where(eq(ais.id, aiId))
    .limit(1);
  return ai ?? null;
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
    deps.db.transaction(async (tx) => {
      // Cross-process serialization. The lock is held to the end of this
      // transaction, so everything below runs exactly once per AI.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${aiId}), ${ENSURE_MODEL_LOCK_SCOPE})`,
      );
      // The transaction's own connection: the unit-test database shares a
      // single connection, so every read inside the lock must ride `tx`.
      const txDb = tx as unknown as ServerDatabase;
      const ai = await findGatewayAiIn(txDb, aiId);
      if (!ai) {
        throw new Error(`AI ${aiId} not found`);
      }
      if (ai.litellmModelId !== null) {
        return;
      }
      if (ai.litellmKeyId === null) {
        throw new Error(`AI ${aiId} has no virtual key`);
      }

      const modelName = modelNameForAi(ai.id);
      // A previous attempt may have registered `ai-<id>` without storing the
      // id (a crash between `addModel` and the row update). Reclaim the name
      // so the orphan is not left behind.
      await deleteModelsNamed(deps, ai.id, modelName);

      const providerKey = await decryptForGatewayUse(txDb, deps.cipher, ai.providerConnectionId);
      const modelId = await registerModelWithKey(deps, {
        aiId: ai.id,
        keyId: ai.litellmKeyId,
        modelName,
        litellmModel: litellmModelFor(ai.provider, ai.model),
        apiKey: providerKey,
      });

      await tx
        .update(llmVirtualKeys)
        .set({ litellmModelId: modelId })
        .where(eq(llmVirtualKeys.aiId, ai.id));
    }),
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
      await deps.db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${ai.id}), ${ENSURE_MODEL_LOCK_SCOPE})`,
        );
        const txDb = tx as unknown as ServerDatabase;
        const fresh = await findGatewayAiIn(txDb, ai.id);
        if (!fresh || fresh.owner !== input.ownerId) {
          throw new HttpError(404, 'not_found', 'AI not found');
        }
        if (
          fresh.model === model &&
          fresh.providerConnectionId === input.providerConnectionId &&
          fresh.litellmModelId !== null
        ) {
          return;
        }
        if (fresh.litellmKeyId === null) {
          throw updateFailed();
        }

        const providerKey = await decryptForGatewayUse(txDb, deps.cipher, connection.id);
        if (fresh.litellmModelId !== null) {
          await deps.litellm.deleteModel(fresh.litellmModelId);
        }
        deletedOld = true;
        await deleteModelsNamed(deps, ai.id, modelName);
        const created = await registerModelWithKey(deps, {
          aiId: ai.id,
          keyId: fresh.litellmKeyId,
          modelName,
          litellmModel,
          apiKey: providerKey,
        });

        await tx
          .update(ais)
          .set({ model, providerConnectionId: connection.id, updatedAt: new Date() })
          .where(eq(ais.id, ai.id));
        await tx
          .update(llmVirtualKeys)
          .set({ litellmModelId: created })
          .where(eq(llmVirtualKeys.aiId, ai.id));
      });
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
          await deps.db.transaction(async (tx) => {
            await tx.execute(
              sql`SELECT pg_advisory_xact_lock(hashtext(${ai.id}), ${ENSURE_MODEL_LOCK_SCOPE})`,
            );
            const [ownerRow] = await tx
              .select({ owner: ais.owner })
              .from(ais)
              .where(eq(ais.id, ai.id))
              .limit(1);
            if (!ownerRow || ownerRow.owner !== input.ownerId) {
              return;
            }
            await tx
              .update(llmVirtualKeys)
              .set({ litellmModelId: null })
              .where(eq(llmVirtualKeys.aiId, ai.id));
          });
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
const ENSURE_MODEL_LOCK_SCOPE = 730033;

// One in-process mutex per AI. The Postgres advisory lock above serializes
// across processes and hosts; this serializes the awaits inside this process,
// which is also what makes the race unit-testable (the unit-test database
// shares a single connection, on which advisory locks re-grant to the holder).
const ensureModelLocks = new Map<string, Promise<void>>();

async function withAiEnsureLock<T>(aiId: string, work: () => Promise<T>): Promise<T> {
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

// The internal row: the public columns plus the identity and gateway handles
// the routes must never answer with.
interface AiRecord {
  id: string;
  name: string;
  template: AiTemplate;
  persona: string;
  model: string;
  jid: string;
  localpart: string;
  status: 'active' | 'disabled';
  providerConnectionId: string;
  createdAt: Date;
  perDayUsd: string;
  perMonthUsd: string;
  litellmKeyId: string | null;
  litellmModelId: string | null;
}

// The AI row plus its connection's provider, for the gateway-only paths that
// need to build the provider-qualified model name.
interface GatewayAiRecord extends AiRecord {
  provider: string;
  owner: string;
}

const publicAiColumns = {
  id: ais.id,
  name: ais.name,
  template: ais.template,
  persona: ais.persona,
  model: ais.model,
  jid: ais.jid,
  status: ais.status,
  providerConnectionId: ais.providerConnectionId,
  createdAt: ais.createdAt,
  perDayUsd: aiLimits.perDayUsd,
  perMonthUsd: aiLimits.perMonthUsd,
};

const aiColumns = {
  ...publicAiColumns,
  localpart: ais.localpart,
  litellmKeyId: llmVirtualKeys.litellmKeyId,
  litellmModelId: llmVirtualKeys.litellmModelId,
};

type PublicAiRow = Omit<AiRecord, 'localpart' | 'litellmKeyId' | 'litellmModelId'>;

function toPublicAi(row: PublicAiRow): PublicAi {
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    persona: row.persona,
    model: row.model,
    jid: row.jid,
    status: row.status,
    providerConnectionId: row.providerConnectionId,
    limits: {
      perDayUsd: Number(row.perDayUsd),
      perMonthUsd: Number(row.perMonthUsd),
    },
    createdAt: row.createdAt,
  };
}

function resolvePersona(template: AiTemplate, persona: string | undefined): string {
  const trimmed = persona?.trim() ?? '';
  if (trimmed !== '') {
    return trimmed;
  }
  if (template === 'custom') {
    throw new HttpError(400, 'invalid_request', 'A custom AI needs a persona');
  }
  return defaultPersonaFor(template);
}

// Whether a roster already holds an item for `jid`, so teardown can skip a
// delete that a previous attempt already performed.
function hasRosterItem(entries: ReadonlyArray<{ jid: string }>, jid: string): boolean {
  return entries.some((entry) => entry.jid === jid);
}

async function findUserName(db: ServerDatabase, userId: string): Promise<string> {
  const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return row?.name ?? '';
}

// `numeric` columns are strings; two decimal places is the currency precision
// the schema stores. Comparisons (perDayUsd <= perMonthUsd, the monthly cap)
// already happened on the numbers at the route boundary.
function usd(value: number): string {
  return value.toFixed(2);
}

async function compensateCreate(
  deps: AiServiceDeps,
  context: {
    id: string;
    localpart: string;
    jid: string;
    ownerLocalpart: string;
    ownerJid: string;
    registered: boolean;
    keyId: string | undefined;
    modelId: string | undefined;
  },
): Promise<void> {
  if (context.keyId !== undefined) {
    try {
      await deps.litellm.revokeKey(context.keyId);
    } catch (error) {
      deps.logger.warn(
        { err: error, aiId: context.id },
        'rollback could not revoke the AI virtual key',
      );
    }
  }
  if (context.modelId !== undefined) {
    try {
      await deps.litellm.deleteModel(context.modelId);
    } catch (error) {
      deps.logger.warn(
        { err: error, aiId: context.id },
        'rollback could not delete the AI private model',
      );
    }
  }
  if (context.registered) {
    try {
      await deps.adminClient.deleteRosterItem(context.ownerLocalpart, context.jid);
    } catch (error) {
      deps.logger.warn({ err: error, aiId: context.id }, 'rollback could not remove a roster item');
    }
    try {
      await deps.adminClient.deleteRosterItem(context.localpart, context.ownerJid);
    } catch (error) {
      deps.logger.warn({ err: error, aiId: context.id }, 'rollback could not remove a roster item');
    }
    try {
      await deps.adminClient.unregisterUser(context.localpart);
    } catch (error) {
      deps.logger.warn(
        { err: error, aiId: context.id },
        'rollback could not unregister the AI XMPP account',
      );
    }
  }
  try {
    await deps.db.delete(ais).where(eq(ais.id, context.id));
  } catch (error) {
    deps.logger.warn({ err: error, aiId: context.id }, 'rollback could not delete the AI rows');
  }
}

// Fixed messages: no gateway or chat-service detail (which could echo a key)
// ever reaches the client.
function provisioningFailed(): HttpError {
  return new HttpError(502, 'ai_provisioning_failed', 'The AI could not be provisioned');
}

function updateFailed(): HttpError {
  return new HttpError(502, 'ai_update_failed', 'The AI could not be updated');
}

function teardownFailed(): HttpError {
  return new HttpError(502, 'ai_teardown_failed', 'The AI could not be deleted; try again');
}
