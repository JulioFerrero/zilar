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
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`createRateLimiter needs max >= 1, got ${max}`);
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(`createRateLimiter needs windowMs > 0, got ${windowMs}`);
  }
  const attempts = new Map<string, number[]>();
  let lastPrune = Number.NEGATIVE_INFINITY;

  return {
    allow(key: string): boolean {
      const current = now();
      const cutoff = current - windowMs;
      // Prune keys whose entries all fell out of the window, so the map does
      // not grow forever with one entry per caller who ever hit the route. At
      // most once per window: entries are filtered per call anyway.
      if (current - lastPrune >= windowMs) {
        lastPrune = current;
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
      }
      const recent = (attempts.get(key) ?? []).filter((time) => time > cutoff);
      if (recent.length >= max) {
        attempts.set(key, recent);
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
