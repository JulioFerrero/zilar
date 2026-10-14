import { describe, expect, it } from 'vitest';
import { Admission, type PoolMemory } from './admission';

const noPool = (): Promise<PoolMemory | null> => Promise.resolve(null);

function poolOf(currentBytes: number, maxBytes: number) {
  return (): Promise<PoolMemory | null> => Promise.resolve({ currentBytes, maxBytes });
}

describe('Admission', () => {
  it('admits up to maxRunning and queues the rest with a position', async () => {
    const admission = new Admission({ maxRunning: 2, memoryRatioLimit: 0.75, pool: noPool });
    expect(await admission.tryAcquire('owner-a', 'a')).toEqual({ granted: true, position: 0 });
    expect(await admission.tryAcquire('owner-a', 'b')).toEqual({ granted: true, position: 0 });
    expect(await admission.tryAcquire('owner-b', 'c')).toEqual({ granted: false, position: 0 });
    expect(admission.running).toBe(2);
    expect(admission.queued).toBe(1);

    admission.release('a');
    expect(await admission.tryAcquire('owner-b', 'c')).toEqual({ granted: true, position: 0 });
  });

  it('stops admitting once the pool is at 75% of its max', async () => {
    const full = new Admission({
      maxRunning: 12,
      memoryRatioLimit: 0.75,
      pool: poolOf(3_200_000_000, 4_000_000_000),
    });
    expect(await full.tryAcquire('owner-a', 'a')).toEqual({ granted: false, position: 0 });

    const roomy = new Admission({
      maxRunning: 12,
      memoryRatioLimit: 0.75,
      pool: poolOf(2_000_000_000, 4_000_000_000),
    });
    expect(await roomy.tryAcquire('owner-a', 'a')).toEqual({ granted: true, position: 0 });
  });

  it('falls back to the count when the pool is unreadable', async () => {
    const admission = new Admission({ maxRunning: 1, memoryRatioLimit: 0.75, pool: noPool });
    expect(await admission.tryAcquire('owner-a', 'a')).toEqual({ granted: true, position: 0 });
    expect(await admission.tryAcquire('owner-a', 'b')).toEqual({ granted: false, position: 0 });
  });

  it('is idempotent per id', async () => {
    const admission = new Admission({ maxRunning: 1, memoryRatioLimit: 0.75, pool: noPool });
    expect(await admission.tryAcquire('owner-a', 'a')).toEqual({ granted: true, position: 0 });
    expect(await admission.tryAcquire('owner-a', 'a')).toEqual({ granted: true, position: 0 });
    expect(admission.running).toBe(1);
  });

  it('alternates between two owners', async () => {
    const admission = new Admission({ maxRunning: 1, memoryRatioLimit: 0.75, pool: noPool });
    expect(await admission.tryAcquire('owner-a', 'a1')).toEqual({ granted: true, position: 0 });
    // owner-b queued, then owner-a's second request lands behind it (round-robin).
    expect(await admission.tryAcquire('owner-b', 'b1')).toEqual({ granted: false, position: 0 });
    expect(await admission.tryAcquire('owner-a', 'a2')).toEqual({ granted: false, position: 1 });

    admission.release('a1');
    expect(await admission.tryAcquire('owner-b', 'b1')).toEqual({ granted: true, position: 0 });
    expect(await admission.tryAcquire('owner-a', 'a2')).toEqual({ granted: false, position: 0 });

    admission.release('b1');
    expect(await admission.tryAcquire('owner-a', 'a2')).toEqual({ granted: true, position: 0 });
  });

  it('makes a newcomer wait behind an already-queued request', async () => {
    const admission = new Admission({ maxRunning: 1, memoryRatioLimit: 0.75, pool: noPool });
    expect(await admission.tryAcquire('owner-a', 'a')).toEqual({ granted: true, position: 0 });
    expect(await admission.tryAcquire('owner-b', 'b')).toEqual({ granted: false, position: 0 });

    // A slot is free, but 'b' is ahead in the queue: 'c' must not jump it.
    admission.release('a');
    expect(await admission.tryAcquire('owner-c', 'c')).toEqual({ granted: false, position: 1 });

    expect(await admission.tryAcquire('owner-b', 'b')).toEqual({ granted: true, position: 0 });
    expect(await admission.tryAcquire('owner-c', 'c')).toEqual({ granted: false, position: 0 });

    admission.release('b');
    expect(await admission.tryAcquire('owner-c', 'c')).toEqual({ granted: true, position: 0 });
  });

  it('clear frees every slot and queue', async () => {
    const admission = new Admission({ maxRunning: 1, memoryRatioLimit: 0.75, pool: noPool });
    await admission.tryAcquire('owner-a', 'a');
    await admission.tryAcquire('owner-b', 'b');
    admission.clear();
    expect(admission.running).toBe(0);
    expect(admission.queued).toBe(0);
  });
});
