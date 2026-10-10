import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { modelNameForAi } from '../ai/model-entry';
import { type AiServiceDeps, teardownFailed } from './persona';
import { ENSURE_MODEL_LOCK_SCOPE, deleteModelsNamed, withAiEnsureLock } from './provisioning-keys';
import { emitAiLifecycle, findOwnedAi } from './queries';

// The localpart of an AI XMPP account: the `ai-` prefix plus a stable,
// id-derived suffix. For our random UUIDs this is `ai-<uuid>`; anything exotic
// falls back to the same hash the user provisioning uses. Always valid for the
// admin client's `[a-z0-9._-]{1,64}` rule.
export function aiLocalpart(aiId: string): string {
  return `ai-${localpartFor(aiId)}`.slice(0, 64);
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
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${ai.id}), ${ENSURE_MODEL_LOCK_SCOPE})`;
            const [keyRow] = yield* sql<{ litellmKeyId: string | null }>`SELECT litellm_key_id
              FROM llm_virtual_keys WHERE ai_id = ${ai.id} LIMIT 1`;
            if (!keyRow || keyRow.litellmKeyId === null) {
              return;
            }
            const keyId = keyRow.litellmKeyId;
            yield* Effect.tryPromise({
              try: () => deps.litellm.revokeKey(keyId),
              catch: (error) => {
                deps.logger.warn(
                  { err: error, aiId: ai.id },
                  'could not revoke the AI virtual key',
                );
                return teardownFailed();
              },
            });
            yield* sql`UPDATE llm_virtual_keys SET litellm_key_id = NULL WHERE ai_id = ${ai.id}`;
          }),
        );
      }),
    );

    // 2. Delete the private model currently registered for this AI, re-read
    //    under the lock (a model switch may have replaced it after step 0),
    //    plus any stray `ai-<id>` entries. `deleteModel` treats an
    //    already-gone model as success; an AI with no model id is skipped.
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${ai.id}), ${ENSURE_MODEL_LOCK_SCOPE})`;
            const [keyRow] = yield* sql<{ litellmModelId: string | null }>`SELECT litellm_model_id
              FROM llm_virtual_keys WHERE ai_id = ${ai.id} LIMIT 1`;
            const modelId = keyRow?.litellmModelId ?? null;
            if (modelId !== null) {
              yield* Effect.tryPromise({
                try: () => deps.litellm.deleteModel(modelId),
                catch: (error) => {
                  deps.logger.warn(
                    { err: error, aiId: ai.id },
                    'could not delete the AI private model',
                  );
                  return teardownFailed();
                },
              });
            }
            yield* Effect.promise(() => deleteModelsNamed(deps, ai.id, modelNameForAi(ai.id)));

            // 3. Nothing is left to revoke or delete on the gateway side, so the key
            //    row goes.
            yield* sql`DELETE FROM llm_virtual_keys WHERE ai_id = ${ai.id}`;
          }),
        );
      }),
    );
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

  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM ais WHERE id = ${ai.id}`;
    }),
  );
  emitAiLifecycle({ type: 'deleted', aiId: ai.id });
}

export async function compensateCreate(
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
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM ais WHERE id = ${context.id}`;
      }),
    );
  } catch (error) {
    deps.logger.warn({ err: error, aiId: context.id }, 'rollback could not delete the AI rows');
  }
}

// Whether a roster already holds an item for `jid`, so teardown can skip a
// delete that a previous attempt already performed.
function hasRosterItem(entries: ReadonlyArray<{ jid: string }>, jid: string): boolean {
  return entries.some((entry) => entry.jid === jid);
}
