import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { AiServiceDeps, PublicAi } from './persona';
import { emitAiLifecycle, findOwnedAi, toPublicAi } from './queries';

// Stops an AI (T-0080): owner-only. It needs only the database, so the kill
// switch keeps working when LiteLLM, the key cipher or XMPP are down. Accepts only `active`, answers the same
// 404 as `getOwnedAi` for a foreign or missing id (so existence is never
// leaked). Idempotent on `stopped` (returns the AI unchanged). `disabled` —
// provisioning still in flight — answers 409 `not_active` so a resume can
// never accidentally flip a half-built AI to `active`. The conditional update
// (`WHERE status = 'active'`) keeps a resume racing a delete from
// resurrecting anything: a delete wins because the row is gone, and a second
// stop wins because the row already left `active`.
export async function stopAi(
  deps: Pick<AiServiceDeps, 'db'>,
  id: string,
  ownerId: string,
): Promise<PublicAi> {
  const ai = await findOwnedAi(deps.db, id, ownerId);
  if (!ai) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }
  if (ai.status === 'stopped') {
    return toPublicAi(ai);
  }
  if (ai.status === 'disabled') {
    throw new HttpError(409, 'not_active', 'AI is not active');
  }
  const updated = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`UPDATE ais
        SET status = 'stopped', updated_at = ${new Date()}
        WHERE id = ${ai.id} AND status = 'active'
        RETURNING id`;
    }),
  );
  if (updated.length === 0) {
    // A concurrent stop/resume/delete raced between the read and the update.
    // Re-read under the owner's view: if the row is now `stopped`, return it
    // (idempotent success); otherwise surface the same 409 as above.
    const fresh = await findOwnedAi(deps.db, ai.id, ownerId);
    if (fresh === null) {
      throw new HttpError(404, 'not_found', 'AI not found');
    }
    if (fresh.status === 'stopped') {
      return toPublicAi(fresh);
    }
    throw new HttpError(409, 'not_active', 'AI is not active');
  }
  emitAiLifecycle({ type: 'stopped', aiId: ai.id });
  const reloaded = await findOwnedAi(deps.db, ai.id, ownerId);
  if (reloaded === null) {
    // The row was deleted between the update and the read; the lifecycle
    // event already went out, and the caller gets a 404-shape answer.
    throw new HttpError(404, 'not_found', 'AI not found');
  }
  return toPublicAi(reloaded);
}

// Resumes an AI (T-0080): owner-only, mirror of `stopAi`. Accepts only
// `stopped`, idempotent on `active`, 409 on `disabled`. The conditional update
// makes a resume racing a stop or delete a no-op: the row either is `stopped`
// still (stop won) or no longer exists (delete won).
export async function resumeAi(
  deps: Pick<AiServiceDeps, 'db'>,
  id: string,
  ownerId: string,
): Promise<PublicAi> {
  const ai = await findOwnedAi(deps.db, id, ownerId);
  if (!ai) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }
  if (ai.status === 'active') {
    return toPublicAi(ai);
  }
  if (ai.status === 'disabled') {
    throw new HttpError(409, 'not_active', 'AI is not active');
  }
  const updated = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`UPDATE ais
        SET status = 'active', updated_at = ${new Date()}
        WHERE id = ${ai.id} AND status = 'stopped'
        RETURNING id`;
    }),
  );
  if (updated.length === 0) {
    const fresh = await findOwnedAi(deps.db, ai.id, ownerId);
    if (fresh === null) {
      throw new HttpError(404, 'not_found', 'AI not found');
    }
    if (fresh.status === 'active') {
      return toPublicAi(fresh);
    }
    throw new HttpError(409, 'not_active', 'AI is not active');
  }
  emitAiLifecycle({ type: 'resumed', aiId: ai.id });
  const reloaded = await findOwnedAi(deps.db, ai.id, ownerId);
  if (reloaded === null) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }
  return toPublicAi(reloaded);
}

export interface AssignMachineInput {
  aiId: string;
  ownerId: string;
  machineId: string | null;
}

// T-0091: assign an AI to one of the owner's approved machines (or clear
// it back to the platform). Owner-only: a foreign AI answers the same 404
// the other AI routes give. A machine that is missing, foreign, or not
// `approved` (pending or revoked) answers 404 `machine_not_found`, so the
// caller cannot tell which case they hit. Setting the same value is a
// no-op (200, no change) — the route skips the audit write on its end.
// Only `status` independent of whether the AI is `active`, `stopped` or
// `disabled`: the home machine is just a pointer the UI reads.
export async function assignMachine(
  deps: Pick<AiServiceDeps, 'db'>,
  input: AssignMachineInput,
): Promise<PublicAi> {
  const ai = await findOwnedAi(deps.db, input.aiId, input.ownerId);
  if (!ai) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }
  if (input.machineId === null) {
    if (ai.machineId === null) {
      return toPublicAi(ai);
    }
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE ais SET machine_id = NULL, updated_at = ${new Date()} WHERE id = ${ai.id}`;
      }),
    );
  } else {
    const machineId = input.machineId;
    const [machine] = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ status: string }>`SELECT status
          FROM machines
          WHERE id = ${machineId} AND owner_user_id = ${input.ownerId}
          LIMIT 1`;
      }),
    );
    if (!machine || machine.status !== 'approved') {
      throw new HttpError(404, 'machine_not_found', 'Machine not found');
    }
    if (ai.machineId === machineId) {
      return toPublicAi(ai);
    }
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE ais SET machine_id = ${machineId}, updated_at = ${new Date()} WHERE id = ${ai.id}`;
      }),
    );
  }
  const reloaded = await findOwnedAi(deps.db, ai.id, input.ownerId);
  if (reloaded === null) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }
  return toPublicAi(reloaded);
}
