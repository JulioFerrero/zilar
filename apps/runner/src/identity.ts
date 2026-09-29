import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const IDENTITY_VERSION = 1;

export interface IdentityLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

const noopLogger: IdentityLogger = {
  info: () => undefined,
  warn: () => undefined,
};

export const IdentitySchema = z.strictObject({
  version: z.literal(IDENTITY_VERSION),
  serverUrl: z.string().url(),
  machineId: z.string().min(1).max(128),
  publicKey: z.string().min(1).max(1024),
  privateKey: z.string().min(1).max(4096),
  name: z.string().min(1).max(64),
  createdAt: z.string().min(1).max(64),
  hubUrl: z.string().url().startsWith('ws://').optional(),
});

export type RunnerIdentity = z.infer<typeof IdentitySchema>;

export interface IdentitySummary {
  machineId: string;
  name: string;
  serverUrl: string;
  fingerprint: string;
  hubUrl: string | null;
  filePath: string;
  createdAt: string;
}

export interface IdentityStorage {
  homeDir: string;
  filePath: string;
}

export function resolveHomeDir(
  homeOverride: string | undefined,
  envHome: string | undefined,
): string {
  if (typeof homeOverride === 'string' && homeOverride.length > 0) return homeOverride;
  if (typeof envHome === 'string' && envHome.length > 0) return envHome;
  return join(os.homedir(), '.galena-runner');
}

export function identityPaths(homeDir: string): IdentityStorage {
  return {
    homeDir,
    filePath: join(homeDir, 'identity.json'),
  };
}

// Matches the server's `fingerprintOfPublicKey`. The argument is always the
// public key: never pass the private key here.
export function fingerprintOfPublicKey(publicKeyBase64: string): string {
  const bytes = Buffer.from(publicKeyBase64, 'base64');
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

export function buildIdentity(input: {
  serverUrl: string;
  machineId: string;
  publicKey: string;
  privateKey: string;
  name: string;
  hubUrl?: string;
}): RunnerIdentity {
  const base: Omit<RunnerIdentity, 'hubUrl'> = {
    version: IDENTITY_VERSION,
    serverUrl: input.serverUrl,
    machineId: input.machineId,
    publicKey: input.publicKey,
    privateKey: input.privateKey,
    name: input.name,
    createdAt: new Date().toISOString(),
  };
  if (input.hubUrl !== undefined) {
    return { ...base, hubUrl: input.hubUrl };
  }
  return base;
}

export class IdentityError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'IdentityError';
    this.code = code;
  }
}

async function assertPrivateFileMode(filePath: string): Promise<void> {
  if (process.platform === 'win32') return;
  const stats = await stat(filePath);
  const mode = stats.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new IdentityError(
      `Identity file ${filePath} is readable by group or others. Run: chmod 600 ${filePath}`,
      'insecure_file_mode',
    );
  }
}

function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

// Write through a temp file in the same directory so a crash never leaves a
// half-written or world-readable key behind.
export async function saveIdentity(
  storage: IdentityStorage,
  identity: RunnerIdentity,
  options: { logger?: IdentityLogger } = {},
): Promise<void> {
  const logger = options.logger ?? noopLogger;
  await mkdir(storage.homeDir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    await chmod(storage.homeDir, 0o700);
  }
  const tempPath = `${storage.filePath}.tmp-${process.pid}-${Date.now()}`;
  const body = JSON.stringify(identity, null, 2);
  await writeFile(tempPath, body, { mode: 0o600 });
  if (process.platform !== 'win32') {
    await chmod(tempPath, 0o600);
  }
  await rename(tempPath, storage.filePath);
  if (process.platform !== 'win32') {
    await chmod(storage.filePath, 0o600);
  }
  logger.info(`Saved identity to ${storage.filePath}`);
}

export async function loadIdentity(
  storage: IdentityStorage,
  options: { logger?: IdentityLogger } = {},
): Promise<RunnerIdentity> {
  const logger = options.logger ?? noopLogger;
  let text: string;
  try {
    text = await readFile(storage.filePath, 'utf8');
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new IdentityError(
        `No identity found at ${storage.filePath}. Run 'pair' first.`,
        'not_found',
      );
    }
    throw err;
  }
  await assertPrivateFileMode(storage.filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new IdentityError(`Identity file ${storage.filePath} is not valid JSON.`, 'corrupt');
  }
  const result = IdentitySchema.safeParse(parsed);
  if (!result.success) {
    throw new IdentityError(
      `Identity file ${storage.filePath} is not a valid Galena runner identity (wrong version or shape).`,
      'corrupt',
    );
  }
  logger.info(`Loaded identity from ${storage.filePath}`);
  return result.data;
}

export async function hasIdentity(storage: IdentityStorage): Promise<boolean> {
  try {
    await stat(storage.filePath);
    return true;
  } catch {
    return false;
  }
}

export async function requireWritableIdentity(
  storage: IdentityStorage,
  force: boolean,
): Promise<void> {
  if (!(await hasIdentity(storage))) return;
  if (force) return;
  throw new IdentityError(
    `An identity already exists at ${storage.filePath}. Re-run with --force to replace it, or delete the file manually.`,
    'identity_exists',
  );
}

export async function summarizeIdentity(storage: IdentityStorage): Promise<IdentitySummary> {
  const identity = await loadIdentity(storage);
  return {
    machineId: identity.machineId,
    name: identity.name,
    serverUrl: identity.serverUrl,
    fingerprint: fingerprintOfPublicKey(identity.publicKey),
    hubUrl: identity.hubUrl ?? null,
    filePath: storage.filePath,
    createdAt: identity.createdAt,
  };
}
