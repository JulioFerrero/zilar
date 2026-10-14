import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { type AiServiceDeps, teardownFailed } from './persona';
import { emitAiLifecycle, findOwnedAi } from './queries';

// The localpart of an AI XMPP account: the `ai-` prefix plus a stable,
// id-derived suffix. For our random UUIDs this is `ai-<uuid>`; anything exotic
// falls back to the same hash the user provisioning uses. Always valid for the
// admin client's `[a-z0-9._-]{1,64}` rule.
export function aiLocalpart(aiId: string): string {
  return `ai-${localpartFor(aiId)}`.slice(0, 64);
}

// Tears an AI down: remove both roster items, unregister the XMPP account, drop
// any virtual-key row a pre-T-1401 AI still carries, then delete the AI rows.
// Teardown is resumable: every step skips work that is already done, so a delete
// that failed part way (ejabberd down) can be retried without failing on an
// item that is already gone.
export async function deleteAi(deps: AiServiceDeps, id: string, ownerId: string): Promise<void> {
  const ai = await findOwnedAi(deps.db, id, ownerId);
  if (!ai) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }

  const ownerLocalpart = localpartFor(ownerId);
  const ownerJid = jidFor(ownerLocalpart, deps.domain);

  // 1. The owner's roster item for the AI. Skip it when it is already gone.
  try {
    const roster = await deps.adminClient.getRoster(ownerLocalpart);
    if (hasRosterItem(roster, ai.jid)) {
      await deps.adminClient.deleteRosterItem(ownerLocalpart, ai.jid);
    }
  } catch (error) {
    deps.logger.warn({ err: error, aiId: ai.id }, 'could not remove the AI from the owner roster');
    throw teardownFailed();
  }

  // 2. The AI's own account. If it is already gone, there is nothing left on
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

  // 3. Nothing is left on the gateway side, so the AI row goes in one
  //    transaction.
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`DELETE FROM ais WHERE id = ${ai.id}`;
        }),
      );
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
  },
): Promise<void> {
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
