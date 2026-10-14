import { describe, expect, it } from 'vitest';
import type { DeskLimits } from '@zilar/desk';
import { DEFAULT_POLICY, GIB, clampEgress, clampLimits, parsePolicy } from './policy.ts';

const requested: DeskLimits = {
  memoryBytes: 2 * GIB,
  pids: 256,
  cpuShares: 4096,
  diskBytes: 5 * GIB,
  commandTimeoutMs: 600_000,
  taskWallClockMs: 600_000,
};

describe('clampLimits', () => {
  it('clamps a server request that is above the local ceiling', () => {
    const policy = { ...DEFAULT_POLICY, maxMemoryGb: 1, maxCpuShares: 512, maxDiskGb: 2 };
    const clamped = clampLimits(requested, policy);
    expect(clamped.memoryBytes).toBe(1 * GIB);
    expect(clamped.cpuShares).toBe(512);
    expect(clamped.diskBytes).toBe(2 * GIB);
    expect(clamped.pids).toBe(256);
  });

  it('never loosens a server request below the local ceiling', () => {
    const policy = { ...DEFAULT_POLICY, maxMemoryGb: 8, maxCpuShares: 4096, maxDiskGb: 20 };
    const small: DeskLimits = {
      ...requested,
      memoryBytes: 256 * 1024 * 1024,
      cpuShares: 128,
      diskBytes: 100 * 1024 * 1024,
    };
    const clamped = clampLimits(small, policy);
    expect(clamped.memoryBytes).toBe(small.memoryBytes);
    expect(clamped.cpuShares).toBe(128);
    expect(clamped.diskBytes).toBe(small.diskBytes);
  });

  it('caps pids at the desk package ceiling', () => {
    const clamped = clampLimits({ ...requested, pids: 4096 }, DEFAULT_POLICY);
    expect(clamped.pids).toBe(256);
  });
});

describe('clampEgress', () => {
  it('drops all egress when the owner set allowNetwork: false', () => {
    const policy = { ...DEFAULT_POLICY, allowNetwork: false };
    expect(clampEgress({ allowedHosts: ['example.com'] }, policy)).toBeUndefined();
  });

  it('keeps the server policy when the owner allows the network', () => {
    expect(clampEgress({ allowedHosts: ['example.com'] }, DEFAULT_POLICY)).toEqual({
      allowedHosts: ['example.com'],
    });
  });
});

describe('parsePolicy', () => {
  it('uses the plan defaults for a missing field', () => {
    const policy = parsePolicy('{}');
    expect(policy.allowNetwork).toBe(true);
    expect(policy.maxMemoryGb).toBe(2);
    expect(policy.maxDiskGb).toBe(5);
    expect(policy.maxRunning).toBe(2);
  });

  it('reads the fields it knows', () => {
    const policy = parsePolicy('{"allowNetwork":false,"maxMemoryGb":4,"maxRunning":1}');
    expect(policy.allowNetwork).toBe(false);
    expect(policy.maxMemoryGb).toBe(4);
    expect(policy.maxRunning).toBe(1);
  });

  it('falls back to the defaults for invalid JSON instead of loosening', () => {
    const policy = parsePolicy('not json');
    expect(policy.maxMemoryGb).toBe(DEFAULT_POLICY.maxMemoryGb);
    expect(policy.reason).not.toBe('');
  });
});
