import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CapabilitiesSchema, detectCapabilities } from './capabilities.ts';

// A local copy of the server's capability schema. The runner is its own
// source of truth and the test asserts the produced report matches this
// schema without importing server code.
const ServerCapabilitiesSchema = z.strictObject({
  os: z.string().trim().min(1).max(64),
  os_version: z.string().trim().min(1).max(64),
  arch: z.string().trim().min(1).max(64),
  cpu: z.string().trim().min(1).max(128),
  cores: z.number().int().min(1).max(1024),
  ram_gb: z.number().min(0).max(1000000),
  disk_free_gb: z.number().min(0).max(1000000),
  power: z.string().trim().min(1).max(64),
  drivers: z.array(z.string().trim().min(1).max(64)).max(32),
  tools: z
    .record(z.string().min(1).max(128), z.unknown())
    .refine((t: Record<string, unknown>) => Object.keys(t).length <= 64),
  labels: z.array(z.string().trim().min(1).max(64)).max(32),
  runner_version: z.string().trim().min(1).max(64),
});

interface FakeOs {
  platform: () => NodeJS.Platform;
  arch: () => NodeJS.Architecture;
  cpus: () => Array<{ model: string; speed: number; times: Record<string, number> }>;
  totalmem: () => number;
  release: () => string;
  homedir: () => string;
}

function fakeOs(overrides: Partial<FakeOs> = {}): FakeOs {
  return {
    platform: () => 'linux',
    arch: () => 'x64',
    cpus: () => [{ model: 'Test CPU', speed: 1000, times: {} }],
    totalmem: () => 16 * 1024 * 1024 * 1024,
    release: () => '6.0.0',
    homedir: () => '/tmp',
    ...overrides,
  };
}

function fakeStatfs(): Promise<{ bsize: number; bavail: bigint }> {
  return Promise.resolve({ bsize: 4096, bavail: BigInt(200 * 1024 * 1024 * 1024) / 4096n });
}

function failingStatfs(): Promise<{ bsize: number; bavail: bigint }> {
  return Promise.reject(new Error('statfs failed'));
}

function dockerPresent(): Promise<{ stdout: string }> {
  return Promise.resolve({ stdout: '24.0.5\n' });
}

function dockerMissing(): Promise<{ stdout: string }> {
  return Promise.reject(new Error('docker not found'));
}

describe('detectCapabilities', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'galena-runner-cap-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns a report that validates against the server schema', async () => {
    const report = await detectCapabilities({
      os: fakeOs() as unknown as typeof os,
      statfs: fakeStatfs,
      execFile: dockerPresent,
      runnerVersion: '0.1.0',
    });
    expect(ServerCapabilitiesSchema.safeParse(report).success).toBe(true);
    expect(report.os).toBe('linux');
    expect(report.arch).toBe('x64');
    expect(report.cpu).toBe('Test CPU');
    expect(report.cores).toBe(1);
    expect(report.ram_gb).toBeGreaterThan(0);
    expect(report.disk_free_gb).toBeGreaterThan(0);
    expect(report.power).toBe('unknown');
    expect(report.drivers).toEqual(['docker']);
    expect(report.runner_version).toBe('0.1.0');
  });

  it('reports macos as the os when on darwin', async () => {
    const report = await detectCapabilities({
      os: fakeOs({ platform: () => 'darwin' }) as unknown as typeof os,
      statfs: fakeStatfs,
      execFile: dockerMissing,
      runnerVersion: '0.1.0',
    });
    expect(report.os).toBe('macos');
    expect(report.power).toBe('laptop');
  });

  it('treats a failing docker probe as drivers:[]', async () => {
    const report = await detectCapabilities({
      os: fakeOs() as unknown as typeof os,
      statfs: fakeStatfs,
      execFile: dockerMissing,
      runnerVersion: '0.1.0',
    });
    expect(report.drivers).toEqual([]);
  });

  it('falls back to disk_free_gb:0 when statfs fails', async () => {
    const report = await detectCapabilities({
      os: fakeOs() as unknown as typeof os,
      statfs: failingStatfs,
      execFile: dockerMissing,
      runnerVersion: '0.1.0',
    });
    expect(report.disk_free_gb).toBe(0);
  });

  it('caps long strings and trims whitespace', async () => {
    const longString = 'x'.repeat(200);
    const report = await detectCapabilities({
      os: fakeOs({ release: () => `  ${longString}  ` }) as unknown as typeof os,
      statfs: fakeStatfs,
      execFile: dockerMissing,
      runnerVersion: longString,
    });
    expect(report.os_version.length).toBeLessThanOrEqual(64);
    expect(report.os_version).toBe(report.os_version.trim());
    expect(report.runner_version.length).toBeLessThanOrEqual(64);
  });

  it('matches its own CapabilitiesSchema for round-trip stability', async () => {
    const report = await detectCapabilities({
      os: fakeOs() as unknown as typeof os,
      statfs: fakeStatfs,
      execFile: dockerPresent,
      runnerVersion: '0.1.0',
    });
    expect(CapabilitiesSchema.safeParse(report).success).toBe(true);
  });
});
