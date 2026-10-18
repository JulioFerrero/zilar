export interface RateLimiterOptions {
  max: number;
  windowMs: number;
  now?: () => number;
}

export interface RateLimiter {
  allow: (key: string) => boolean;
  readonly size: number;
}

// In-memory and per process: with several server processes a caller gets the limit per
// process, which is acceptable for short-lived, low-stakes caps.
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
      // Prune expired keys so the map does not grow with every caller who ever hit
      // the route; at most once per window, since entries are filtered per call anyway.
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
