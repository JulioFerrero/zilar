// effect-plain: a small in-memory TTL cache; the Effect read it wraps stays in search/service.
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { allowedArchives, type SearchOwner } from '../search/service';

export const ARCHIVES_CACHE_TTL_MS = 15_000;
export const ARCHIVES_CACHE_MAX_ENTRIES = 5_000;

type ArchiveLoader = (
  db: ServerDatabase,
  config: ServerConfig,
  userId: string,
) => Promise<SearchOwner>;

export interface ArchivesCacheOptions {
  /** Override the TTL in tests. Defaults to `ARCHIVES_CACHE_TTL_MS`. */
  ttlMs?: number;
  /** Override the cap in tests. Defaults to `ARCHIVES_CACHE_MAX_ENTRIES`. */
  maxEntries?: number;
  /** Override the clock (ms) in tests. Defaults to the wall clock. */
  now?: () => number;
  /** Override the loader in tests; production loads `allowedArchives`. */
  load?: ArchiveLoader;
}

export interface ArchivesCache {
  allowedArchives: (
    db: ServerDatabase,
    config: ServerConfig,
    userId: string,
  ) => Promise<SearchOwner>;
  /** Drops one user's entry, for a caller that knows their scope changed. */
  invalidate: (db: ServerDatabase, userId: string) => void;
  /** The cached user count for one database, for tests. */
  size: (db: ServerDatabase) => number;
}

interface CacheEntry {
  value: SearchOwner;
  expiresAt: number;
}

// A factory rather than a bare module map so tests own their clock and
// loader; the map is keyed by database first, so two databases in one
// process never share rows.
export function createArchivesCache(options: ArchivesCacheOptions = {}): ArchivesCache {
  const ttlMs = options.ttlMs ?? ARCHIVES_CACHE_TTL_MS;
  const maxEntries = options.maxEntries ?? ARCHIVES_CACHE_MAX_ENTRIES;
  const now = options.now ?? (() => Date.now());
  const load = options.load ?? allowedArchives;
  const byDatabase = new WeakMap<ServerDatabase, Map<string, CacheEntry>>();

  function entriesFor(db: ServerDatabase): Map<string, CacheEntry> {
    let entries = byDatabase.get(db);
    if (entries === undefined) {
      entries = new Map<string, CacheEntry>();
      byDatabase.set(db, entries);
    }
    return entries;
  }

  return {
    async allowedArchives(db, config, userId) {
      const entries = entriesFor(db);
      const at = now();
      const cached = entries.get(userId);
      if (cached !== undefined && cached.expiresAt > at) {
        return cached.value;
      }
      const value = await load(db, config, userId);
      // Re-insert at the end so insertion order is eviction order: once the cap
      // is reached the oldest entry goes first.
      entries.delete(userId);
      if (entries.size >= maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) {
          entries.delete(oldest);
        }
      }
      entries.set(userId, { value, expiresAt: at + ttlMs });
      return value;
    },
    invalidate(db, userId) {
      byDatabase.get(db)?.delete(userId);
    },
    size(db) {
      return byDatabase.get(db)?.size ?? 0;
    },
  };
}

const shared = createArchivesCache();

export function cachedAllowedArchives(
  db: ServerDatabase,
  config: ServerConfig,
  userId: string,
): Promise<SearchOwner> {
  return shared.allowedArchives(db, config, userId);
}
