import { chmod, stat, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateRunnerKeypair } from '@galena/runner-tunnel';
import { buildIdentity, saveIdentity, identityPaths } from './identity.ts';
import { runCli, type CliIo } from './cli.ts';

function tempHome(): { homeDir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'galena-runner-cli-'));
  return {
    homeDir: dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function captureIo(): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      env: {},
    },
    stdout,
    stderr,
  };
}

describe('runCli', () => {
  let home: string;
  let cleanup: () => void;

  beforeEach(() => {
    const t = tempHome();
    home = t.homeDir;
    cleanup = t.cleanup;
  });

  afterEach(() => cleanup());

  it('prints help on `help`', async () => {
    const { io, stdout } = captureIo();
    const result = await runCli(['help'], io);
    expect(result.exitCode).toBe(0);
    expect(stdout.join('\n')).toContain('Usage: galena-runner');
  });

  it('prints help with no args', async () => {
    const { io, stdout } = captureIo();
    const result = await runCli([], io);
    expect(result.exitCode).toBe(0);
    expect(stdout.join('\n')).toContain('Usage: galena-runner');
  });

  it('returns exit code 2 for an unknown command', async () => {
    const { io, stderr } = captureIo();
    const result = await runCli(['bogus'], io);
    expect(result.exitCode).toBe(2);
    expect(stderr.join('\n')).toContain('Unknown command');
  });

  it('returns exit code 2 when `pair` is missing --server', async () => {
    const { io, stderr } = captureIo();
    const result = await runCli(['pair', 'K7QXM2PA'], io);
    expect(result.exitCode).toBe(2);
    expect(stderr.join('\n')).toContain('--server');
  });

  it('returns exit code 2 for an unparseable code', async () => {
    const { io, stderr } = captureIo();
    const result = await runCli(['pair', 'not-a-code', '--server', 'http://127.0.0.1:3000'], io);
    expect(result.exitCode).toBe(2);
    expect(stderr.join('\n')).toMatch(/pairing code/);
  });

  it('reports a clear error when `status` has no identity', async () => {
    const { io, stderr } = captureIo();
    const result = await runCli(['status', '--home', home], io);
    expect(result.exitCode).toBe(1);
    expect(stderr.join('\n')).toMatch(/identity/i);
  });

  it('prints identity summary without exposing the private key', async () => {
    const storage = identityPaths(home);
    const keypair = generateRunnerKeypair();
    await saveIdentity(
      storage,
      buildIdentity({
        serverUrl: 'http://127.0.0.1:3000',
        machineId: 'machine-1',
        publicKey: keypair.publicKey,
        privateKey: keypair.privateKey,
        name: 'julio-mbp',
      }),
    );
    const { io, stdout } = captureIo();
    const result = await runCli(['status', '--home', home], io);
    expect(result.exitCode).toBe(0);
    const text = stdout.join('\n');
    expect(text).toContain('machine-1');
    expect(text).toContain('julio-mbp');
    expect(text).toContain('fingerprint');
    expect(text.includes(keypair.privateKey)).toBe(false);
  });

  it('prints a clean error when the identity file has bad permissions', async () => {
    if (process.platform === 'win32') return;
    const storage = identityPaths(home);
    const keypair = generateRunnerKeypair();
    await saveIdentity(
      storage,
      buildIdentity({
        serverUrl: 'http://127.0.0.1:3000',
        machineId: 'machine-2',
        publicKey: keypair.publicKey,
        privateKey: keypair.privateKey,
        name: 'julio-mbp',
      }),
    );
    await chmod(storage.filePath, 0o644);
    const { io, stderr } = captureIo();
    const result = await runCli(['status', '--home', home], io);
    expect(result.exitCode).toBe(1);
    expect(stderr.join('\n')).toMatch(/chmod 600/);
  });

  it('refuses `run` without --hub on the first call', async () => {
    const storage = identityPaths(home);
    const keypair = generateRunnerKeypair();
    await saveIdentity(
      storage,
      buildIdentity({
        serverUrl: 'http://127.0.0.1:3000',
        machineId: 'machine-3',
        publicKey: keypair.publicKey,
        privateKey: keypair.privateKey,
        name: 'test',
      }),
    );
    const { io, stderr } = captureIo();
    const result = await runCli(['run', '--home', home], io);
    expect(result.exitCode).toBe(2);
    expect(stderr.join('\n')).toMatch(/--hub/);
  });

  it('refuses `run` when the identity file is unreadable', async () => {
    const { io, stderr } = captureIo();
    const result = await runCli(['run', '--hub', 'ws://127.0.0.1:3189/tunnel', '--home', home], io);
    expect(result.exitCode).toBe(1);
    expect(stderr.join('\n')).toMatch(/identity/i);
  });

  it('saves an identity file with 0600', async () => {
    if (process.platform === 'win32') return;
    const storage = identityPaths(home);
    const keypair = generateRunnerKeypair();
    await saveIdentity(
      storage,
      buildIdentity({
        serverUrl: 'http://127.0.0.1:3000',
        machineId: 'machine-4',
        publicKey: keypair.publicKey,
        privateKey: keypair.privateKey,
        name: 'test',
      }),
    );
    const stats = await stat(storage.filePath);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it('treats the private key as redacted across all output', async () => {
    const storage = identityPaths(home);
    const keypair = generateRunnerKeypair();
    await saveIdentity(
      storage,
      buildIdentity({
        serverUrl: 'http://127.0.0.1:3000',
        machineId: 'machine-5',
        publicKey: keypair.publicKey,
        privateKey: keypair.privateKey,
        name: 'test',
      }),
    );
    const { io, stdout } = captureIo();
    await runCli(['status', '--home', home], io);
    expect(stdout.join('\n').includes(keypair.privateKey)).toBe(false);
  });

  it('keeps a corrupt identity file out of the output', async () => {
    const storage = identityPaths(home);
    const { io, stderr } = captureIo();
    const { mkdir } = await import('node:fs/promises');
    await mkdir(storage.homeDir, { recursive: true, mode: 0o700 });
    await writeFile(storage.filePath, 'not-json', { mode: 0o600 });
    const result = await runCli(['status', '--home', home], io);
    expect(result.exitCode).toBe(1);
    expect(stderr.join('\n')).toMatch(/not valid JSON/);
  });
});
