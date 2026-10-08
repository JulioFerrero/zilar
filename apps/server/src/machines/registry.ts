// The durable machine lookup, on `effect/sql` (see `../effect/sql`). The
// runtime for `db` is resolved at call time from `sqlRuntimeFor`, never when
// the registry is built: `index.ts` creates the registry before `createApp`
// registers the runtime.

import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { sqlRuntimeFor } from '../effect/sql';

export type RevokeListener = (machineId: string) => void;
export type ApproveListener = (machineId: string, publicKey: string) => void;

// The durable lookup the tunnel hub uses to trust connecting machines. Only
// `approved` machines expose their key: pending and revoked machines (and
// unknown ids) resolve to null, so the hub cannot authenticate them.
export interface DbMachineRegistry {
  getApprovedPublicKey(machineId: string): Promise<string | null>;
  touchLastSeen(machineId: string, at: Date): Promise<void>;
  onRevoke(listener: RevokeListener): () => void;
  // Called by the machines routes after a revoke commits. Runs this
  // process's listeners synchronously, so the hub can close live
  // connections. Cross-process fan-out is out of scope for this task.
  notifyRevoked(machineId: string): void;
  onApprove(listener: ApproveListener): () => void;
  // Called by the machines routes after an approve commits, so the hub can
  // trust a freshly-approved machine without waiting for its 30 s refresh.
  notifyApproved(machineId: string, publicKey: string): void;
}

function runSql<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

export function createDbMachineRegistry(db: ServerDatabase): DbMachineRegistry {
  const revokeListeners = new Set<RevokeListener>();
  const approveListeners = new Set<ApproveListener>();

  return {
    async getApprovedPublicKey(machineId: string): Promise<string | null> {
      const [row] = await runSql(
        db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ publicKey: string }>`SELECT public_key FROM machines
            WHERE id = ${machineId} AND status = 'approved' LIMIT 1`;
        }),
      );
      return row?.publicKey ?? null;
    },

    // The hub writes this when a machine connects. A missing id is a no-op:
    // the row may have been deleted between the lookup and the write.
    async touchLastSeen(machineId: string, at: Date): Promise<void> {
      await runSql(
        db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE machines SET last_seen_at = ${at.toISOString()}
            WHERE id = ${machineId}`;
        }),
      );
    },

    onRevoke(listener: RevokeListener): () => void {
      revokeListeners.add(listener);
      return () => {
        revokeListeners.delete(listener);
      };
    },

    notifyRevoked(machineId: string): void {
      for (const listener of revokeListeners) {
        listener(machineId);
      }
    },

    onApprove(listener: ApproveListener): () => void {
      approveListeners.add(listener);
      return () => {
        approveListeners.delete(listener);
      };
    },

    notifyApproved(machineId: string, publicKey: string): void {
      for (const listener of approveListeners) {
        listener(machineId, publicKey);
      }
    },
  };
}
