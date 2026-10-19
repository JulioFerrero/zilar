import { readFile } from 'node:fs/promises';
import { Exit, Schema } from 'effect';
import type { DeskEgressPolicy, DeskLimits } from '@zilar/desk';

/**
 * The owner's local policy (plan §6.4). It can only tighten the server's request:
 * every field is `min(server, local)`, and `allowNetwork: false` refuses networking.
 * A missing or corrupt file means the defaults, never something looser.
 */

export interface LocalPolicy {
  readonly allowNetwork: boolean;
  readonly maxMemoryGb: number;
  readonly maxCpuShares: number;
  readonly maxDiskGb: number;
  readonly maxRunning: number;
  /** Why the defaults were used instead of a file, for logs; empty otherwise. */
  readonly reason: string;
}

export const GIB = 1024 * 1024 * 1024;

export const DEFAULT_POLICY: LocalPolicy = {
  allowNetwork: true,
  maxMemoryGb: 2,
  maxCpuShares: 512,
  maxDiskGb: 5,
  maxRunning: 2,
  reason: '',
};

/** The desk package's pids ceiling; the policy file has no field for it. */
export const MAX_PIDS_CEILING = 256;

const positive = Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(1000000));

const PolicyFileSchema = Schema.Struct({
  allowNetwork: Schema.optional(Schema.Boolean),
  maxMemoryGb: Schema.optional(positive),
  maxCpuShares: Schema.optional(positive),
  maxDiskGb: Schema.optional(positive),
  maxRunning: Schema.optional(positive),
});

export function parsePolicy(text: string): LocalPolicy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...DEFAULT_POLICY, reason: 'policy file is not JSON' };
  }
  const decoded = Schema.decodeUnknownExit(PolicyFileSchema, { onExcessProperty: 'error' })(parsed);
  if (!Exit.isSuccess(decoded)) {
    return { ...DEFAULT_POLICY, reason: 'policy file is invalid' };
  }
  const file = decoded.value;
  return {
    allowNetwork: file.allowNetwork ?? DEFAULT_POLICY.allowNetwork,
    maxMemoryGb: file.maxMemoryGb ?? DEFAULT_POLICY.maxMemoryGb,
    maxCpuShares: file.maxCpuShares ?? DEFAULT_POLICY.maxCpuShares,
    maxDiskGb: file.maxDiskGb ?? DEFAULT_POLICY.maxDiskGb,
    maxRunning: file.maxRunning ?? DEFAULT_POLICY.maxRunning,
    reason: '',
  };
}

export async function loadPolicy(policyPath: string): Promise<LocalPolicy> {
  try {
    return parsePolicy(await readFile(policyPath, 'utf8'));
  } catch {
    return DEFAULT_POLICY;
  }
}

/** `min(server request, local)` per field; timeouts have no local ceiling and pass through. */
export function clampLimits(
  requested: DeskLimits,
  policy: LocalPolicy,
  log?: (message: string) => void,
): DeskLimits {
  const effective: DeskLimits = {
    memoryBytes: Math.min(requested.memoryBytes, policy.maxMemoryGb * GIB),
    pids: Math.min(requested.pids, MAX_PIDS_CEILING),
    cpuShares: Math.min(requested.cpuShares, policy.maxCpuShares),
    diskBytes: Math.min(requested.diskBytes, policy.maxDiskGb * GIB),
    commandTimeoutMs: requested.commandTimeoutMs,
    taskWallClockMs: requested.taskWallClockMs,
  };
  if (log !== undefined && !sameLimits(requested, effective)) {
    log(
      `desk limits clamped by local policy: memory_bytes ${requested.memoryBytes}->${effective.memoryBytes}, ` +
        `pids ${requested.pids}->${effective.pids}, cpu_shares ${requested.cpuShares}->${effective.cpuShares}, ` +
        `disk_bytes ${requested.diskBytes}->${effective.diskBytes}`,
    );
  }
  return effective;
}

function sameLimits(a: DeskLimits, b: DeskLimits): boolean {
  return (
    a.memoryBytes === b.memoryBytes &&
    a.pids === b.pids &&
    a.cpuShares === b.cpuShares &&
    a.diskBytes === b.diskBytes
  );
}

/** `allowNetwork: false` drops all egress; otherwise the server's policy stands. */
export function clampEgress(
  egress: DeskEgressPolicy | undefined,
  policy: LocalPolicy,
): DeskEgressPolicy | undefined {
  if (!policy.allowNetwork) {
    return undefined;
  }
  return egress;
}
