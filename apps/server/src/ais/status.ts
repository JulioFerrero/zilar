import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { AiServiceDeps, PublicAi } from './persona';
import { emitAiLifecycle, findOwnedAi, toPublicAi } from './queries';

// Owner-only and DB-only, so the kill switch works when the cipher or XMPP are
// down. A foreign id answers the same 404; idempotent on `stopped`; `disabled`
// answers 409 so a resume cannot flip a half-built AI. The conditional update
// loses to a racing delete or second stop.
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
    // A concurrent stop/resume/delete raced the update: re-read under the owner's
    // view.
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
    // Deleted between the update and the read; the caller gets a 404.
    throw new HttpError(404, 'not_found', 'AI not found');
  }
  return toPublicAi(reloaded);
}

// Mirror of `stopAi`: accepts only `stopped`, idempotent on `active`, 409 on
// `disabled`. The conditional update makes a racing stop or delete win.
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

// Owner-only. A machine that is missing, foreign or not `approved` answers the
// same 404, so the caller cannot tell which. The AI's own status does not
// matter: the home machine is only a pointer.
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
