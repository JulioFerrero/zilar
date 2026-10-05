import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

async function statfsBytesAvailable(path: string): Promise<{ bsize: number; bavail: bigint }> {
  const stats = await statfs(path, { bigint: true });
  return { bsize: Number(stats.bsize), bavail: stats.bavail };
}

// Kept in sync with the server's capability schema
// (apps/server/src/machines/routes.ts). The runner is the source of truth
// here: anything this rejects will also be rejected by the server.
const MAX_DRIVERS = 32;
const MAX_STRING = 64;

function trimCapped(value: string, max: number): string {
  return value.trim().slice(0, max);
}

export const CapabilitiesSchema = z.strictObject({
  os: z.string().trim().min(1).max(MAX_STRING),
  os_version: z.string().trim().min(1).max(MAX_STRING),
  arch: z.string().trim().min(1).max(MAX_STRING),
  cpu: z.string().trim().min(1).max(128),
  cores: z.number().int().min(1).max(1024),
  ram_gb: z.number().min(0).max(1000000),
  disk_free_gb: z.number().min(0).max(1000000),
  power: z.string().trim().min(1).max(MAX_STRING),
  drivers: z.array(z.string().trim().min(1).max(MAX_STRING)).max(MAX_DRIVERS),
  tools: z
    .record(z.string().min(1).max(128), z.unknown())
    .refine((tools: Record<string, unknown>) => Object.keys(tools).length <= 64, {
      message: 'tools must have at most 64 entries',
    }),
  labels: z.array(z.string().trim().min(1).max(MAX_STRING)).max(32),
  runner_version: z.string().trim().min(1).max(MAX_STRING),
});

export type Capabilities = z.infer<typeof CapabilitiesSchema>;

export interface CapabilityDeps {
  os: typeof os;
  statfs: (path: string) => Promise<{ bsize: number; bavail: bigint }>;
  execFile: (
    file: string,
    args: readonly string[],
    options: { timeout: number; maxBuffer: number },
  ) => Promise<{ stdout: string }>;
  runnerVersion: string;
}

const defaultDeps: CapabilityDeps = {
  os,
  statfs: statfsBytesAvailable,
  execFile: (file, args, options) => execFileAsync(file, args, options),
  runnerVersion: '0.1.0',
};

function platformName(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  return platform;
}

function detectPower(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'laptop';
  return 'unknown';
}

// A failing probe becomes an empty list, never an error: a missing docker
// must not stop the rest of the capability report.
async function detectDrivers(deps: CapabilityDeps): Promise<string[]> {
  const drivers: string[] = [];
  try {
    const { stdout } = await deps.execFile(
      'docker',
      ['version', '--format', '{{.Server.Version}}'],
      { timeout: 3000, maxBuffer: 4096 },
    );
    const version = stdout.trim();
    if (version.length > 0 && version.length <= MAX_STRING) {
      drivers.push('docker');
    }
  } catch {
    // No docker, or it timed out.
  }
  return drivers.slice(0, MAX_DRIVERS);
}

export async function detectCapabilities(
  deps: Partial<CapabilityDeps> = {},
): Promise<Capabilities> {
  const merged: CapabilityDeps = { ...defaultDeps, ...deps };
  const platform = merged.os.platform();
  const arch = merged.os.arch();
  const cpus = merged.os.cpus();
  const cpuModel = cpus[0]?.model ?? 'unknown';
  const cores = Math.max(1, cpus.length);
  const ramGb = Math.max(0, Math.round((merged.os.totalmem() / 1024 / 1024 / 1024) * 10) / 10);

  let diskFreeGb = 0;
  try {
    const home = merged.os.homedir();
    const stats = await merged.statfs(home);
    const bytes = Number(stats.bsize) * Number(stats.bavail);
    diskFreeGb = Math.max(0, Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10);
  } catch {
    diskFreeGb = 0;
  }

  const drivers = await detectDrivers(merged);

  const report: Capabilities = {
    os: trimCapped(platformName(platform), MAX_STRING),
    os_version: trimCapped(merged.os.release(), MAX_STRING) || 'unknown',
    arch: trimCapped(arch, MAX_STRING) || 'unknown',
    cpu: trimCapped(cpuModel, 128) || 'unknown',
    cores,
    ram_gb: ramGb,
    disk_free_gb: diskFreeGb,
    power: trimCapped(detectPower(platform), MAX_STRING),
    drivers,
    tools: {},
    labels: [],
    runner_version: trimCapped(merged.runnerVersion, MAX_STRING),
  };

  return CapabilitiesSchema.parse(report);
}
