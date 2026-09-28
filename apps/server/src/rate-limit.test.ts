import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';

describe('createRateLimiter', () => {
  it('allows up to max calls, then blocks', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => now });

    expect(limiter.allow('user-1')).toBe(true);
    expect(limiter.allow('user-1')).toBe(true);
    expect(limiter.allow('user-1')).toBe(false);
    now += 1;
    expect(limiter.allow('user-1')).toBe(false);
  });

  it('limits each key independently', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => now });

    expect(limiter.allow('user-1')).toBe(true);
    expect(limiter.allow('user-1')).toBe(false);
    expect(limiter.allow('user-2')).toBe(true);
  });

  it('allows again once the window has passed', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => now });

    expect(limiter.allow('user-1')).toBe(true);
    expect(limiter.allow('user-1')).toBe(false);
    now += 1001;
    expect(limiter.allow('user-1')).toBe(true);
    expect(limiter.allow('user-1')).toBe(false);
  });

  it('a blocked call does not extend the window', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => now });

    expect(limiter.allow('user-1')).toBe(true);
    now += 500;
    expect(limiter.allow('user-1')).toBe(false);
    now += 501;
    expect(limiter.allow('user-1')).toBe(true);
  });

  it('prunes keys whose entries all fell out of the window', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => now });

    expect(limiter.allow('user-1')).toBe(true);
    expect(limiter.allow('user-2')).toBe(true);
    expect(limiter.size).toBe(2);

    now += 2000;
    expect(limiter.allow('user-3')).toBe(true);
    expect(limiter.size).toBe(1);

    expect(limiter.allow('user-1')).toBe(true);
    expect(limiter.size).toBe(2);
  });

  it('prunes at most once per window', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 10, windowMs: 1000, now: () => now });

    expect(limiter.allow('user-1')).toBe(true);
    now += 10;
    expect(limiter.allow('user-2')).toBe(true);
    now += 990;
    expect(limiter.allow('user-3')).toBe(true);
    expect(limiter.size).toBe(2);

    // user-2's entry is expired but stays: less than a window since the prune.
    now += 500;
    expect(limiter.allow('user-4')).toBe(true);
    expect(limiter.size).toBe(3);

    now += 600;
    expect(limiter.allow('user-5')).toBe(true);
    expect(limiter.size).toBe(2);
  });

  it('rejects a non-positive max or window', () => {
    expect(() => createRateLimiter({ max: 0, windowMs: 1000 })).toThrow();
    expect(() => createRateLimiter({ max: 1, windowMs: 0 })).toThrow();
    expect(() => createRateLimiter({ max: 1, windowMs: -5 })).toThrow();
  });

  it('defaults to the real clock', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60 * 1000 });

    expect(limiter.allow('user-1')).toBe(true);
    expect(limiter.allow('user-1')).toBe(false);
  });
});
