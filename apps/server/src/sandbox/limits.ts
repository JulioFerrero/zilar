// Worker-safe sandbox limits: this module must not import a schema library
// (no Effect, no zod), because the worker thread loads it on every spawn.

export const MAX_SOURCE_BYTES = 64 * 1024;

export const DEFAULT_LIMITS = {
  wallMs: 10_000,
  cpuMs: 2_000,
  memoryBytes: 32 * 1024 * 1024,
  stackBytes: 512 * 1024,
  maxFetches: 5,
  fetchTimeoutMs: 5_000,
  maxResponseBytes: 1024 * 1024,
  maxOutputBytes: 16 * 1024,
  maxLogBytes: 4 * 1024,
} as const;

export const HARD_MAX_LIMITS = {
  wallMs: 30_000,
  cpuMs: 30_000,
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 8 * 1024 * 1024,
  maxFetches: 10,
  fetchTimeoutMs: 30_000,
  maxResponseBytes: 4 * 1024 * 1024,
  maxOutputBytes: 64 * 1024,
  maxLogBytes: 64 * 1024,
} as const;

export type SandboxLimits = {
  wallMs: number;
  cpuMs: number;
  memoryBytes: number;
  stackBytes: number;
  maxFetches: number;
  fetchTimeoutMs: number;
  maxResponseBytes: number;
  maxOutputBytes: number;
  maxLogBytes: number;
};

const LIMIT_KEYS = Object.keys(DEFAULT_LIMITS) as (keyof SandboxLimits)[];

// Every limit is a positive integer, except maxFetches, which may be zero.
function isValidLimits(value: SandboxLimits): boolean {
  return LIMIT_KEYS.every((key) => {
    const field = value[key];
    if (!Number.isInteger(field)) {
      return false;
    }
    return key === 'maxFetches' ? field >= 0 : field > 0;
  });
}

export function resolveLimits(input: Partial<SandboxLimits> | undefined): SandboxLimits {
  const merged: SandboxLimits = { ...DEFAULT_LIMITS, ...input };
  const base: SandboxLimits = { ...DEFAULT_LIMITS };
  if (isValidLimits(merged)) {
    LIMIT_KEYS.forEach((key) => {
      base[key] = merged[key];
    });
  }
  LIMIT_KEYS.forEach((key) => {
    const hard = HARD_MAX_LIMITS[key];
    if (base[key] > hard) {
      base[key] = hard;
    }
  });
  if (base.wallMs < base.cpuMs) {
    base.cpuMs = base.wallMs;
  }
  return base;
}

export const FETCH_DENIED_PREFIX = 'fetch_denied: ';

// Prefixes a fetch failure message exactly once: callers may pass a message
// that already carries the marker (worker rejections), so strip it first.
export function withFetchPrefix(message: string): string {
  const stripped = message.replace(/^fetch_denied:\s*/i, '');
  return `${FETCH_DENIED_PREFIX}${stripped}`;
}
