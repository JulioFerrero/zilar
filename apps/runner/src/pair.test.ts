import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createPublicKey, verify } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateRunnerKeypair } from '@galena/runner-tunnel';
import { fingerprintOfPublicKey, hasIdentity, identityPaths } from './identity.ts';
import { normalizePairingCode, pairRunner, PairError } from './pair.ts';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function tempHome(): { homeDir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'galena-runner-pair-'));
  return {
    homeDir: dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

interface FakeServerState {
  url: string;
  seen: { body: unknown; publicKey: string | null };
  nextStatus: number;
  nextBody: unknown;
  nextDelayMs: number;
  port: number;
  close: () => Promise<void>;
}

interface FakeServerOptions {
  validCode: string;
  onPair?: (body: { code: string; publicKey: string; signature: string; name: string }) => void;
  nextStatus?: number;
  nextBody?: unknown;
  nextDelayMs?: number;
}

async function startFakeServer(options: FakeServerOptions): Promise<FakeServerState> {
  const state: FakeServerState = {
    url: '',
    seen: { body: null, publicKey: null },
    nextStatus: options.nextStatus ?? 201,
    nextBody: options.nextBody ?? { machineId: 'machine-xyz', status: 'pending' },
    nextDelayMs: options.nextDelayMs ?? 0,
    port: 0,
    close: () => Promise.resolve(),
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST' || (req.url ?? '') !== '/api/runner/pair') {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    let body: unknown = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      body = null;
    }
    const typed = body as {
      code?: string;
      publicKey?: string;
      signature?: string;
      name?: string;
    } | null;
    state.seen.body = typed;
    state.seen.publicKey = typed?.publicKey ?? null;
    options.onPair?.(typed as { code: string; publicKey: string; signature: string; name: string });

    if (state.nextDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, state.nextDelayMs));
    }

    // Validate the signature against the body the server "saw".
    const code = typed?.code ?? '';
    const publicKey = typed?.publicKey ?? '';
    const signature = typed?.signature ?? '';
    const normalized = normalizePairingCode(code);
    let signatureOk = false;
    if (normalized !== null && publicKey.length > 0 && signature.length > 0) {
      try {
        const key = createPublicKey({
          key: Buffer.from(publicKey, 'base64'),
          format: 'der',
          type: 'spki',
        });
        signatureOk = verify(
          null,
          Buffer.from(`galena-pair:v1:${normalized}`, 'ascii'),
          key,
          Buffer.from(signature, 'base64'),
        );
      } catch {
        signatureOk = false;
      }
    }

    const validPair = normalized !== null && normalized === options.validCode && signatureOk;

    if (state.nextStatus !== 201) {
      res.writeHead(state.nextStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify(state.nextBody));
      return;
    }

    if (!validPair) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'invalid_code', message: 'Invalid or expired pairing code' }));
      return;
    }

    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify(state.nextBody));
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address() as AddressInfo;
      state.port = address.port;
      state.url = `http://127.0.0.1:${state.port}`;
      resolve();
    });
  });

  return Object.assign(state, {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  }) as FakeServerState;
}

describe('pairRunner', () => {
  let home: string;
  let cleanup: () => void;
  beforeEach(() => {
    const t = tempHome();
    home = t.homeDir;
    cleanup = t.cleanup;
  });
  afterEach(() => cleanup());

  it('rejects a bad code without hitting the network', async () => {
    const server = await startFakeServer({ validCode: 'AAAA1111' });
    try {
      await expect(
        pairRunner({
          code: 'not-a-code',
          serverUrl: server.url,
          storage: identityPaths(home),
        }),
      ).rejects.toMatchObject({ code: 'invalid_code_format' });
      expect(server.seen.body).toBeNull();
    } finally {
      await server.close();
    }
  });

  it('saves an identity and returns the fingerprint on success', async () => {
    const validCode = `${ALPHABET[0]}${ALPHABET[1]}${ALPHABET[2]}${ALPHABET[3]}${ALPHABET[4]}${ALPHABET[5]}${ALPHABET[6]}${ALPHABET[7]}`;
    const server = await startFakeServer({
      validCode,
      nextBody: { machineId: 'machine-abc', status: 'pending' },
    });
    try {
      const result = await pairRunner({
        code: `${validCode.slice(0, 4)}-${validCode.slice(4)}`,
        serverUrl: server.url,
        storage: identityPaths(home),
        name: 'julio-mbp',
      });
      expect(result.machineId).toBe('machine-abc');
      expect(result.fingerprint).toMatch(/^[0-9a-f]{16}$/);
      const body = server.seen.body as { code: string; publicKey: string; signature: string };
      expect(body.code).toBe(validCode);
      expect(body.publicKey.length).toBeGreaterThan(0);
      expect(body.signature.length).toBeGreaterThan(0);
      // The fingerprint matches what the server computes.
      expect(result.fingerprint).toBe(fingerprintOfPublicKey(body.publicKey));
      expect(await hasIdentity(identityPaths(home))).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('maps 400 invalid_code to a friendly message', async () => {
    const validCode = `${ALPHABET[0]}${ALPHABET[1]}${ALPHABET[2]}${ALPHABET[3]}${ALPHABET[4]}${ALPHABET[5]}${ALPHABET[6]}${ALPHABET[7]}`;
    const server = await startFakeServer({
      validCode,
      nextStatus: 400,
      nextBody: { code: 'invalid_code' },
    });
    try {
      await expect(
        pairRunner({
          code: validCode,
          serverUrl: server.url,
          storage: identityPaths(home),
        }),
      ).rejects.toMatchObject({ code: 'invalid_code' });
      // A failed pair leaves no identity behind.
      expect(await hasIdentity(identityPaths(home))).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('maps 409 key_in_use to a friendly message', async () => {
    const validCode = `${ALPHABET[0]}${ALPHABET[1]}${ALPHABET[2]}${ALPHABET[3]}${ALPHABET[4]}${ALPHABET[5]}${ALPHABET[6]}${ALPHABET[7]}`;
    const server = await startFakeServer({
      validCode,
      nextStatus: 409,
      nextBody: { code: 'key_in_use', message: 'duplicate' },
    });
    try {
      await expect(
        pairRunner({
          code: validCode,
          serverUrl: server.url,
          storage: identityPaths(home),
        }),
      ).rejects.toMatchObject({ code: 'key_in_use' });
    } finally {
      await server.close();
    }
  });

  it('maps known 409 codes (machine_limit, pending_limit, pairing_code_limit) to fixed sentences', async () => {
    const validCode = `${ALPHABET[0]}${ALPHABET[1]}${ALPHABET[2]}${ALPHABET[3]}${ALPHABET[4]}${ALPHABET[5]}${ALPHABET[6]}${ALPHABET[7]}`;
    const cases = [
      { code: 'machine_limit', message: 'hostile <script>alert(1)</script>' },
      { code: 'pending_limit', message: 'too many pendings <dangerous>' },
      { code: 'pairing_code_limit', message: 'codes > limit' },
    ] as const;
    for (const body of cases) {
      const server = await startFakeServer({
        validCode,
        nextStatus: 409,
        nextBody: { code: body.code, message: body.message },
      });
      try {
        let caught: unknown;
        try {
          await pairRunner({
            code: validCode,
            serverUrl: server.url,
            storage: identityPaths(home),
          });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(PairError);
        const message = (caught as PairError).message;
        // The server's hostile `message` text must never reach the CLI.
        expect(message).not.toContain('hostile');
        expect(message).not.toContain('script');
        expect(message).not.toContain('alert(1)');
        expect(message).not.toContain('dangerous');
        // The fixed sentence should be present.
        expect(message.length).toBeGreaterThan(0);
      } finally {
        await server.close();
      }
    }
  });

  it('uses a single generic sentence for a 409 with an unknown or hostile body', async () => {
    const validCode = `${ALPHABET[0]}${ALPHABET[1]}${ALPHABET[2]}${ALPHABET[3]}${ALPHABET[4]}${ALPHABET[5]}${ALPHABET[6]}${ALPHABET[7]}`;
    const hostileBodies: unknown[] = [
      { code: 'mystery_code', message: 'dangerous <script>alert("x")</script>' },
      { code: 'mystery_code', message: '送你一份恶意终端提示: rm -rf /' },
      { code: 'mystery_code', message: '' },
      { code: 12345, message: 'numbers' },
      'plain string hostile',
      null,
    ];
    for (const body of hostileBodies) {
      const server = await startFakeServer({
        validCode,
        nextStatus: 409,
        nextBody: body,
      });
      try {
        let caught: unknown;
        try {
          await pairRunner({
            code: validCode,
            serverUrl: server.url,
            storage: identityPaths(home),
          });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(PairError);
        const message = (caught as PairError).message;
        // None of the hostile fragments should ever be present.
        expect(message).not.toContain('dangerous');
        expect(message).not.toContain('<script>');
        expect(message).not.toContain('alert(');
        expect(message).not.toContain('rm -rf');
        expect(message).not.toContain('恶意');
        expect(message).not.toMatch(/numbers/);
      } finally {
        await server.close();
      }
    }
  });

  it('falls back to a fixed sentence when the 409 body is not parseable', async () => {
    const validCode = `${ALPHABET[0]}${ALPHABET[1]}${ALPHABET[2]}${ALPHABET[3]}${ALPHABET[4]}${ALPHABET[5]}${ALPHABET[6]}${ALPHABET[7]}`;
    const server = await startFakeServer({
      validCode,
      nextStatus: 409,
      nextBody: {},
    });
    let caught: unknown;
    try {
      // Replace fetch with one that returns plain text, so the JSON parse
      // fails and the runner hits its "no body" branch.
      const runnerFetch: typeof fetch = async () =>
        new Response('not-json-text <dangerous>', {
          status: 409,
          headers: { 'content-type': 'text/plain' },
        });
      try {
        await pairRunner({
          code: validCode,
          serverUrl: server.url,
          storage: identityPaths(home),
          fetchImpl: runnerFetch,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(PairError);
      const message = (caught as PairError).message;
      expect(message).toBe('The server refused this machine.');
      expect(message).not.toContain('dangerous');
    } finally {
      await server.close();
    }
  });

  it('maps 429 to a friendly message', async () => {
    const validCode = `${ALPHABET[0]}${ALPHABET[1]}${ALPHABET[2]}${ALPHABET[3]}${ALPHABET[4]}${ALPHABET[5]}${ALPHABET[6]}${ALPHABET[7]}`;
    const server = await startFakeServer({
      validCode,
      nextStatus: 429,
      nextBody: { code: 'rate_limited' },
    });
    try {
      await expect(
        pairRunner({
          code: validCode,
          serverUrl: server.url,
          storage: identityPaths(home),
        }),
      ).rejects.toMatchObject({ code: 'rate_limited' });
    } finally {
      await server.close();
    }
  });

  it('maps a timeout to a network error', async () => {
    const validCode = `${ALPHABET[0]}${ALPHABET[1]}${ALPHABET[2]}${ALPHABET[3]}${ALPHABET[4]}${ALPHABET[5]}${ALPHABET[6]}${ALPHABET[7]}`;
    const server = await startFakeServer({ validCode });
    server.nextDelayMs = 500;
    try {
      await expect(
        pairRunner({
          code: validCode,
          serverUrl: server.url,
          storage: identityPaths(home),
          timeoutMs: 50,
        }),
      ).rejects.toMatchObject({ code: 'timeout' });
    } finally {
      await server.close();
    }
  });

  it('maps a dead port to a network error', async () => {
    const validCode = `${ALPHABET[0]}${ALPHABET[1]}${ALPHABET[2]}${ALPHABET[3]}${ALPHABET[4]}${ALPHABET[5]}${ALPHABET[6]}${ALPHABET[7]}`;
    await expect(
      pairRunner({
        code: validCode,
        serverUrl: 'http://127.0.0.1:1',
        storage: identityPaths(home),
      }),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('refuses to overwrite an existing identity', async () => {
    const validCode = `${ALPHABET[0]}${ALPHABET[1]}${ALPHABET[2]}${ALPHABET[3]}${ALPHABET[4]}${ALPHABET[5]}${ALPHABET[6]}${ALPHABET[7]}`;
    const storage = identityPaths(home);
    const keypair = generateRunnerKeypair();
    const { saveIdentity, buildIdentity } = await import('./identity.ts');
    await saveIdentity(
      storage,
      buildIdentity({
        serverUrl: 'http://127.0.0.1:3000',
        machineId: 'existing',
        publicKey: keypair.publicKey,
        privateKey: keypair.privateKey,
        name: 'first',
      }),
    );
    const server = await startFakeServer({ validCode });
    try {
      await expect(
        pairRunner({
          code: validCode,
          serverUrl: server.url,
          storage,
        }),
      ).rejects.toMatchObject({ code: 'identity_exists' });
      expect(await hasIdentity(storage)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('overwrites an existing identity when force is true', async () => {
    const validCode = `${ALPHABET[0]}${ALPHABET[1]}${ALPHABET[2]}${ALPHABET[3]}${ALPHABET[4]}${ALPHABET[5]}${ALPHABET[6]}${ALPHABET[7]}`;
    const storage = identityPaths(home);
    const keypair = generateRunnerKeypair();
    const { saveIdentity, buildIdentity, loadIdentity } = await import('./identity.ts');
    await saveIdentity(
      storage,
      buildIdentity({
        serverUrl: 'http://127.0.0.1:3000',
        machineId: 'old',
        publicKey: keypair.publicKey,
        privateKey: keypair.privateKey,
        name: 'first',
      }),
    );
    const server = await startFakeServer({
      validCode,
      nextBody: { machineId: 'new-machine', status: 'pending' },
    });
    try {
      const result = await pairRunner({
        code: validCode,
        serverUrl: server.url,
        storage,
        force: true,
      });
      expect(result.machineId).toBe('new-machine');
      const loaded = await loadIdentity(storage);
      expect(loaded.machineId).toBe('new-machine');
    } finally {
      await server.close();
    }
  });

  it('never sends the private key in the request body or in errors', async () => {
    const validCode = `${ALPHABET[0]}${ALPHABET[1]}${ALPHABET[2]}${ALPHABET[3]}${ALPHABET[4]}${ALPHABET[5]}${ALPHABET[6]}${ALPHABET[7]}`;
    const server = await startFakeServer({
      validCode,
      nextStatus: 500,
      nextBody: { code: 'oops', message: 'broken' },
    });
    let leakedKey: string | null = null;
    try {
      const result = await pairRunner({
        code: validCode,
        serverUrl: server.url,
        storage: identityPaths(home),
        generateKeypair: () => {
          const pair = generateRunnerKeypair();
          leakedKey = pair.privateKey;
          return pair;
        },
      }).catch((err: unknown) => err);
      expect(result).toBeInstanceOf(PairError);
      expect(leakedKey).not.toBeNull();
      const seen = server.seen.body as { publicKey?: string };
      expect(JSON.stringify(server.seen.body).includes(leakedKey ?? '')).toBe(false);
      expect(JSON.stringify(server.seen.body).includes(seen.publicKey ?? '')).toBe(true);
    } finally {
      await server.close();
    }
  });
});

describe('normalizePairingCode', () => {
  it('uppercases and strips dashes and spaces', () => {
    expect(normalizePairingCode('k7qx-m2pa')).toBe('K7QXM2PA');
    expect(normalizePairingCode('  K7QX M2PA ')).toBe('K7QXM2PA');
    expect(normalizePairingCode('K7QXM2PA')).toBe('K7QXM2PA');
  });

  it('returns null for codes that contain ambiguous characters', () => {
    expect(normalizePairingCode('1111-1111')).toBeNull();
    expect(normalizePairingCode('IIII-IIII')).toBeNull();
    expect(normalizePairingCode('K7QX-M2P')).toBeNull();
  });
});
