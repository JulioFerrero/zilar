import { and, eq } from 'drizzle-orm';
import type { ServerDatabase } from '../db/client';
import { machines } from '../db/schema';

export type RevokeListener = (machineId: string) => void;

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
}

export function createDbMachineRegistry(db: ServerDatabase): DbMachineRegistry {
  const revokeListeners = new Set<RevokeListener>();

  return {
    async getApprovedPublicKey(machineId: string): Promise<string | null> {
      const [row] = await db
        .select({ publicKey: machines.publicKey })
        .from(machines)
        .where(and(eq(machines.id, machineId), eq(machines.status, 'approved')))
        .limit(1);
      return row?.publicKey ?? null;
    },

    // The hub writes this when a machine connects. A missing id is a no-op:
    // the row may have been deleted between the lookup and the write.
    async touchLastSeen(machineId: string, at: Date): Promise<void> {
      await db.update(machines).set({ lastSeenAt: at }).where(eq(machines.id, machineId));
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
  };
}
