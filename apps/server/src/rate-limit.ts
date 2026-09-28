export interface RateLimiterOptions {
  max: number;
  windowMs: number;
  now?: () => number;
}

export interface RateLimiter {
  allow: (key: string) => boolean;
  /** Number of keys currently tracked. Exposed so tests can observe pruning. */
  readonly size: number;
}

// Simple in-memory limiter keyed by an arbitrary string (usually a user id).
// It is per process: with several server processes a caller could get the
// limit per process, which is acceptable for short-lived, low-stakes caps.
export function createRateLimiter({
  max,
  windowMs,
  now = Date.now,
}: RateLimiterOptions): RateLimiter {
  const attempts = new Map<string, number[]>();

  return {
    allow(key: string): boolean {
      const current = now();
      const cutoff = current - windowMs;
      // Prune keys whose entries all fell out of the window, so the map does
      // not grow forever with one entry per caller who ever hit the route.
      for (const [other, times] of attempts) {
        if (other === key) {
          continue;
        }
        const fresh = times.filter((time) => time > cutoff);
        if (fresh.length === 0) {
          attempts.delete(other);
        } else if (fresh.length !== times.length) {
          attempts.set(other, fresh);
        }
      }
      const recent = (attempts.get(key) ?? []).filter((time) => time > cutoff);
      if (recent.length >= max) {
        if (recent.length === 0) {
          attempts.delete(key);
        } else {
          attempts.set(key, recent);
        }
        return false;
      }
      recent.push(current);
      attempts.set(key, recent);
      return true;
    },
    get size(): number {
      return attempts.size;
    },
  };
}
