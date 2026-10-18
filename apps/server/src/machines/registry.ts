// The runtime for `db` is resolved at call time, because `index.ts` creates the
// registry before `createApp` registers the runtime.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';

export type RevokeListener = (machineId: string) => void;
export type ApproveListener = (machineId: string, publicKey: string) => void;

// Only `approved` machines expose their key: pending, revoked and unknown ids
// resolve to null, so the hub cannot authenticate them.
export interface DbMachineRegistry {
  getApprovedPublicKey(machineId: string): Promise<string | null>;
  touchLastSeen(machineId: string, at: Date): Promise<void>;
  onRevoke(listener: RevokeListener): () => void;
  // Runs this process's listeners synchronously after a revoke commits, so the
  // hub closes live connections. Cross-process fan-out is out of scope.
  notifyRevoked(machineId: string): void;
  onApprove(listener: ApproveListener): () => void;
  // So the hub trusts a fresh approval without waiting for its 30 s refresh.
  notifyApproved(machineId: string, publicKey: string): void;
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

    // A missing id is a no-op: the row may be deleted between lookup and write.
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
