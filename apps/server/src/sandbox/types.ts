import { z } from 'zod';

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

const limitsSchema = z.object({
  wallMs: z.number().int().positive(),
  cpuMs: z.number().int().positive(),
  memoryBytes: z.number().int().positive(),
  stackBytes: z.number().int().positive(),
  maxFetches: z.number().int().min(0),
  fetchTimeoutMs: z.number().int().positive(),
  maxResponseBytes: z.number().int().positive(),
  maxOutputBytes: z.number().int().positive(),
  maxLogBytes: z.number().int().positive(),
});

export function resolveLimits(input: Partial<SandboxLimits> | undefined): SandboxLimits {
  const merged: SandboxLimits = { ...DEFAULT_LIMITS, ...input };
  const parsed = limitsSchema.safeParse(merged);
  const base: SandboxLimits = parsed.success ? parsed.data : { ...DEFAULT_LIMITS };
  (Object.keys(DEFAULT_LIMITS) as (keyof SandboxLimits)[]).forEach((key) => {
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

export type SandboxErrorKind =
  | 'invalid_source'
  | 'syntax'
  | 'runtime'
  | 'timeout'
  | 'memory'
  | 'output_too_large'
  | 'invalid_output'
  | 'fetch_denied'
  | 'sandbox_failure';

export const FETCH_DENIED_PREFIX = 'fetch_denied: ';

// Prefixes a fetch failure message exactly once: callers may pass a message
// that already carries the marker (worker rejections), so strip it first.
export function withFetchPrefix(message: string): string {
  const stripped = message.replace(/^fetch_denied:\s*/i, '');
  return `${FETCH_DENIED_PREFIX}${stripped}`;
}

export interface ToolOutput {
  text: string;
  data?: unknown;
}

export type RunToolResult =
  | {
      ok: true;
      output: ToolOutput;
      logs: string;
      durationMs: number;
      fetchCount: number;
    }
  | {
      ok: false;
      error: { kind: SandboxErrorKind; message: string };
      logs: string;
      durationMs: number;
      fetchCount: number;
    };

const toolOutputSchema = z.object({
  text: z.string(),
  data: z.unknown().optional(),
});

export function parseToolOutput(value: unknown, maxBytes: number): ToolOutput | null {
  const parsed = toolOutputSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  if (parsed.data.text.length > maxBytes) {
    return null;
  }
  return parsed.data.data === undefined
    ? { text: parsed.data.text }
    : { text: parsed.data.text, data: parsed.data.data };
}
