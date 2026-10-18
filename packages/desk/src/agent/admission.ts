// effect-plain: the single serialiser of the running cap and the memory pool;
// state is a synchronous decision plus one file read, no Effect runtime.
import { readFile } from 'node:fs/promises';

/**
 * Admission control (plan §4.3): a jail starts only while fewer than `maxRunning`
 * run and the shared memory pool is under `memoryRatioLimit`. Waiting requests are
 * queued FIFO within an owner and round-robin across owners, so one owner's burst
 * cannot starve another; this object is the queue's only serialiser.
 */

export interface PoolMemory {
  readonly currentBytes: number;
  readonly maxBytes: number;
}

export type PoolReader = () => Promise<PoolMemory | null>;

export interface AdmissionOptions {
  readonly maxRunning: number;
  readonly memoryRatioLimit: number;
  readonly pool?: PoolReader;
}

export interface AdmissionResult {
  readonly granted: boolean;
  /** When queued: how many desks are ahead in the fair order. */
  readonly position: number;
}

export async function readCgroupMemory(cgroupPath: string | null): Promise<PoolMemory | null> {
  if (cgroupPath === null) {
    return null;
  }
  try {
    const [current, max] = await Promise.all([
      readFile(`${cgroupPath}/memory.current`, 'utf8'),
      readFile(`${cgroupPath}/memory.max`, 'utf8'),
    ]);
    const maxBytes = max.trim() === 'max' ? null : Number(max.trim());
    const currentBytes = Number(current.trim());
    if (
      maxBytes === null ||
      !Number.isFinite(maxBytes) ||
      maxBytes <= 0 ||
      !Number.isFinite(currentBytes)
    ) {
      return null;
    }
    return { currentBytes, maxBytes };
  } catch {
    return null;
  }
}

/** FIFO within each owner, then one id per owner per round, owners in first-queued order. */
function fairOrder(queues: Map<string, string[]>): string[] {
  const lists = [...queues.values()].map((queue) => [...queue]);
  const order: string[] = [];
  let moved = true;
  while (moved) {
    moved = false;
    for (const list of lists) {
      const next = list.shift();
      if (next !== undefined) {
        order.push(next);
        moved = true;
      }
    }
  }
  return order;
}

export class Admission {
  private readonly maxRunning: number;
  private readonly memoryRatioLimit: number;
  private readonly pool: PoolReader;
  private readonly admitted = new Set<string>();
  private readonly queues = new Map<string, string[]>();

  constructor(options: AdmissionOptions) {
    this.maxRunning = options.maxRunning;
    this.memoryRatioLimit = options.memoryRatioLimit;
    this.pool = options.pool ?? (() => Promise.resolve(null));
  }

  get running(): number {
    return this.admitted.size;
  }

  get queued(): number {
    return fairOrder(this.queues).length;
  }

  private unqueue(id: string): void {
    for (const [owner, queue] of this.queues) {
      const index = queue.indexOf(id);
      if (index !== -1) {
        queue.splice(index, 1);
      }
      if (queue.length === 0) {
        this.queues.delete(owner);
      }
    }
  }

  private admit(id: string): void {
    this.unqueue(id);
    this.admitted.add(id);
  }

  /**
   * Idempotent per id. The pool is read once, then all checks and changes are
   * synchronous, so two overlapping calls cannot both take the last slot.
   */
  async tryAcquire(ownerUserId: string, id: string): Promise<AdmissionResult> {
    if (this.admitted.has(id)) {
      return { granted: true, position: 0 };
    }
    const pool = await this.pool();
    const overMemory = pool !== null && pool.currentBytes / pool.maxBytes >= this.memoryRatioLimit;
    const capacity = this.admitted.size < this.maxRunning && !overMemory;
    const isQueued = fairOrder(this.queues).includes(id);
    if (isQueued) {
      const order = fairOrder(this.queues);
      if (capacity && order[0] === id) {
        this.admit(id);
        return { granted: true, position: 0 };
      }
      return { granted: false, position: order.indexOf(id) };
    }
    if (capacity && this.queues.size === 0) {
      this.admit(id);
      return { granted: true, position: 0 };
    }
    const queue = this.queues.get(ownerUserId) ?? [];
    queue.push(id);
    this.queues.set(ownerUserId, queue);
    return { granted: false, position: fairOrder(this.queues).indexOf(id) };
  }

  release(id: string): void {
    this.admitted.delete(id);
    this.unqueue(id);
  }

  clear(): void {
    this.admitted.clear();
    this.queues.clear();
  }
}
