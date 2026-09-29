import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateRunnerKeypair } from '@galena/runner-tunnel';
import {
  buildIdentity,
  fingerprintOfPublicKey,
  hasIdentity,
  IdentityError,
  identityPaths,
  loadIdentity,
  requireWritableIdentity,
  resolveHomeDir,
  saveIdentity,
  summarizeIdentity,
} from './identity.ts';

function tempHome(): { homeDir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'galena-runner-id-'));
  return {
    homeDir: dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe('identity storage', () => {
  let home: string;
  let cleanup: () => void;

  beforeEach(() => {
    const t = tempHome();
    home = t.homeDir;
    cleanup = t.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it('saves and loads a round-trip identity', async () => {
    const storage = identityPaths(home);
    const keypair = generateRunnerKeypair();
    const identity = buildIdentity({
      serverUrl: 'http://127.0.0.1:3000',
      machineId: 'machine-123',
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
      name: 'test-machine',
    });
    await saveIdentity(storage, identity);
    const loaded = await loadIdentity(storage);
    expect(loaded.machineId).toBe('machine-123');
    expect(loaded.publicKey).toBe(keypair.publicKey);
    expect(loaded.privateKey).toBe(keypair.privateKey);
  });

  it('creates the home directory with 0700 and the file with 0600 on POSIX', async () => {
    if (process.platform === 'win32') return;
    const storage = identityPaths(home);
    const keypair = generateRunnerKeypair();
    const identity = buildIdentity({
      serverUrl: 'http://127.0.0.1:3000',
      machineId: 'machine-1',
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
      name: 'test',
    });
    await saveIdentity(storage, identity);
    const dirStats = await stat(storage.homeDir);
    expect(dirStats.mode & 0o777).toBe(0o700);
    const fileStats = await stat(storage.filePath);
    expect(fileStats.mode & 0o777).toBe(0o600);
  });

  it('refuses to load an identity that is readable by group or others', async () => {
    if (process.platform === 'win32') return;
    const storage = identityPaths(home);
    const keypair = generateRunnerKeypair();
    const identity = buildIdentity({
      serverUrl: 'http://127.0.0.1:3000',
      machineId: 'machine-1',
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
      name: 'test',
    });
    await saveIdentity(storage, identity);
    await chmod(storage.filePath, 0o644);
    await expect(loadIdentity(storage)).rejects.toBeInstanceOf(IdentityError);
    try {
      await loadIdentity(storage);
    } catch (err) {
      expect(String(err)).toContain('chmod 600');
      expect((err as IdentityError).code).toBe('insecure_file_mode');
    }
  });

  it('refuses to overwrite an existing identity without --force', async () => {
    const storage = identityPaths(home);
    const keypair = generateRunnerKeypair();
    await saveIdentity(
      storage,
      buildIdentity({
        serverUrl: 'http://127.0.0.1:3000',
        machineId: 'm1',
        publicKey: keypair.publicKey,
        privateKey: keypair.privateKey,
        name: 'first',
      }),
    );
    await expect(requireWritableIdentity(storage, false)).rejects.toBeInstanceOf(IdentityError);
    await expect(requireWritableIdentity(storage, true)).resolves.toBeUndefined();
  });

  it('returns a clear error for a corrupt file', async () => {
    const storage = identityPaths(home);
    await mkdir(storage.homeDir, { recursive: true, mode: 0o700 });
    await writeFile(storage.filePath, 'not-json', { mode: 0o600 });
    await expect(loadIdentity(storage)).rejects.toThrow(/not valid JSON/);
  });

  it('returns a clear error for a wrong-version file', async () => {
    const storage = identityPaths(home);
    await mkdir(storage.homeDir, { recursive: true, mode: 0o700 });
    const keypair = generateRunnerKeypair();
    await writeFile(
      storage.filePath,
      JSON.stringify({
        version: 99,
        serverUrl: 'http://127.0.0.1:3000',
        machineId: 'm1',
        publicKey: keypair.publicKey,
        privateKey: keypair.privateKey,
        name: 'x',
        createdAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    await expect(loadIdentity(storage)).rejects.toThrow(/not a valid Galena runner identity/);
  });

  it('never includes the private key in any thrown error message', async () => {
    const storage = identityPaths(home);
    const keypair = generateRunnerKeypair();
    const identity = buildIdentity({
      serverUrl: 'http://127.0.0.1:3000',
      machineId: 'machine-1',
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
      name: 'test',
    });
    await saveIdentity(storage, identity);
    if (process.platform !== 'win32') {
      await chmod(storage.filePath, 0o644);
    }
    const seen = new Set<string>();
    try {
      await loadIdentity(storage);
    } catch (err) {
      const stringified = String(err);
      expect(stringified.includes(keypair.privateKey)).toBe(false);
      expect(stringified.includes(keypair.publicKey)).toBe(false);
      seen.add((err as IdentityError).code);
    }
    expect(seen.has('insecure_file_mode') || seen.has('not_found')).toBe(true);
  });

  it('summarizes the identity without exposing the key', async () => {
    const storage = identityPaths(home);
    const keypair = generateRunnerKeypair();
    await saveIdentity(
      storage,
      buildIdentity({
        serverUrl: 'http://127.0.0.1:3000',
        machineId: 'm1',
        publicKey: keypair.publicKey,
        privateKey: keypair.privateKey,
        name: 'my-machine',
      }),
    );
    const summary = await summarizeIdentity(storage);
    expect(summary.machineId).toBe('m1');
    expect(summary.name).toBe('my-machine');
    expect(summary.fingerprint).toBe(fingerprintOfPublicKey(keypair.publicKey));
    expect(Object.keys(summary)).not.toContain('privateKey');
  });

  it('hasIdentity reports true after save and false before', async () => {
    const storage = identityPaths(home);
    expect(await hasIdentity(storage)).toBe(false);
    const keypair = generateRunnerKeypair();
    await saveIdentity(
      storage,
      buildIdentity({
        serverUrl: 'http://127.0.0.1:3000',
        machineId: 'm1',
        publicKey: keypair.publicKey,
        privateKey: keypair.privateKey,
        name: 'x',
      }),
    );
    expect(await hasIdentity(storage)).toBe(true);
  });

  it('resolves the home dir with overrides and env in priority order', () => {
    expect(resolveHomeDir('/from/flag', '/from/env')).toBe('/from/flag');
    expect(resolveHomeDir(undefined, '/from/env')).toBe('/from/env');
    expect(resolveHomeDir(undefined, undefined)).toMatch(/\.galena-runner$/);
    expect(resolveHomeDir('', '')).toMatch(/\.galena-runner$/);
  });

  it('accepts a wss:// hubUrl and round-trips it through the identity file', async () => {
    const storage = identityPaths(home);
    const keypair = generateRunnerKeypair();
    await saveIdentity(
      storage,
      buildIdentity({
        serverUrl: 'https://galena.example.com',
        machineId: 'machine-wss',
        publicKey: keypair.publicKey,
        privateKey: keypair.privateKey,
        name: 'tls-machine',
        hubUrl: 'wss://galena.example.com:3189/tunnel',
      }),
    );
    const loaded = await loadIdentity(storage);
    expect(loaded.hubUrl).toBe('wss://galena.example.com:3189/tunnel');
  });

  it('rejects an http:// hubUrl in the identity file', async () => {
    const { IdentitySchema } = await import('./identity.ts');
    const keypair = generateRunnerKeypair();
    const parsed = IdentitySchema.safeParse({
      version: 1,
      serverUrl: 'https://galena.example.com',
      machineId: 'm1',
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
      name: 'x',
      createdAt: new Date().toISOString(),
      hubUrl: 'http://galena.example.com:3189/tunnel',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const text = JSON.stringify(parsed.error.issues);
      expect(text).toMatch(/ws:\/\/ or wss:\/\//);
    }
  });
});
