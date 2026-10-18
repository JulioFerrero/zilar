import { describe, expect, it } from 'vitest';
import type { ServerConfig } from '../config/load';
import type { ServerDatabase } from '../db/client';
import type { SearchOwner } from '../search/service';
import { createArchivesCache } from './archives-cache';

const db = {} as ServerDatabase;
const config = {} as ServerConfig;

function owner(marker: string): SearchOwner {
  return { ownLocalpart: marker, dmPeers: [], rooms: [], peerNames: new Map() };
}

describe('allowedArchives cache (PERF-5)', () => {
  it('serves the cached value within the TTL and refetches after it', async () => {
    let clock = 1_000;
    let calls = 0;
    const cache = createArchivesCache({
      ttlMs: 15_000,
      now: () => clock,
      load: async () => {
        calls += 1;
        return owner(`v${calls}`);
      },
    });

    expect((await cache.allowedArchives(db, config, 'u1')).ownLocalpart).toBe('v1');
    clock += 14_999;
    expect((await cache.allowedArchives(db, config, 'u1')).ownLocalpart).toBe('v1');
    expect(calls).toBe(1);

    // The entry is stale at exactly the TTL: the next read refetches.
    clock += 1;
    expect((await cache.allowedArchives(db, config, 'u1')).ownLocalpart).toBe('v2');
    expect(calls).toBe(2);
  });

  it('caches per user and evicts the oldest entry past the cap', async () => {
    let calls = 0;
    const cache = createArchivesCache({
      ttlMs: 15_000,
      maxEntries: 2,
      now: () => 0,
      load: async (_db, _config, userId) => {
        calls += 1;
        return owner(userId);
      },
    });

    await cache.allowedArchives(db, config, 'a');
    await cache.allowedArchives(db, config, 'b');
    await cache.allowedArchives(db, config, 'c');
    expect(cache.size(db)).toBe(2);
    expect(calls).toBe(3);

    // 'a' is the oldest and was evicted, so reading it again reloads.
    await cache.allowedArchives(db, config, 'b');
    expect(calls).toBe(3);
    await cache.allowedArchives(db, config, 'a');
    expect(calls).toBe(4);
  });
});
