import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import { Schema } from 'effect';

const execFileAsync = promisify(execFile);

async function statfsBytesAvailable(path: string): Promise<{ bsize: number; bavail: bigint }> {
  const stats = await statfs(path, { bigint: true });
  return { bsize: Number(stats.bsize), bavail: stats.bavail };
}

// Kept in sync with the server's capability schema
// (apps/server/src/machines/api.ts). The runner is the source of truth
// here: anything this rejects will also be rejected by the server.
const MAX_DRIVERS = 32;
const MAX_LABELS = 32;
const MAX_STRING = 64;
const MAX_TOOLS = 64;
const MAX_TOOL_KEY = 128;

function trimCapped(value: string, max: number): string {
  return value.trim().slice(0, max);
}

// `Schema.Trim` trims on decode like zod's `.trim()`, then the length checks
// run against the trimmed value.
function trimmedString(max: number) {
  return Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(max));
}

// Effect's `Schema.Record` does not run checks on its key schema, so the
// key bounds that zod's `z.record(z.string().min(1).max(128), ...)` enforced
// are checked here alongside the entry cap.
const toolsFilter = Schema.makeFilter((tools: Readonly<Record<string, unknown>>) => {
  const keys = Object.keys(tools);
  if (keys.length > MAX_TOOLS) return 'tools must have at most 64 entries';
  for (const key of keys) {
    if (key.length < 1 || key.length > MAX_TOOL_KEY) {
      return `tools keys must be between 1 and ${MAX_TOOL_KEY} characters`;
    }
  }
  return true;
});

export const CapabilitiesSchema = Schema.Struct({
  os: trimmedString(MAX_STRING),
  os_version: trimmedString(MAX_STRING),
  arch: trimmedString(MAX_STRING),
  cpu: trimmedString(128),
  cores: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(1024),
  ),
  ram_gb: Schema.Number.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(1000000),
  ),
  disk_free_gb: Schema.Number.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(1000000),
  ),
  power: trimmedString(MAX_STRING),
  drivers: Schema.Array(trimmedString(MAX_STRING)).check(Schema.isMaxLength(MAX_DRIVERS)),
  tools: Schema.Record(Schema.String, Schema.Unknown).check(toolsFilter),
  labels: Schema.Array(trimmedString(MAX_STRING)).check(Schema.isMaxLength(MAX_LABELS)),
  runner_version: trimmedString(MAX_STRING),
});

export type Capabilities = typeof CapabilitiesSchema.Type;

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

  return Schema.decodeUnknownSync(CapabilitiesSchema, { onExcessProperty: 'error' })(report);
}
