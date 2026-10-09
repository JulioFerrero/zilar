import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchPinnedHttps,
  fetchPinnedHttpsEffect,
  isHostAllowed,
  normalizeHost,
  validateFetchRequest,
} from './host-fetch';

function bridge(overrides: Record<string, unknown> = {}) {
  return {
    allowedHosts: ['api.example.com'],
    fetchTimeoutMs: 1000,
    maxResponseBytes: 1024,
    resolver: async () => ['93.184.216.34'],
    ...overrides,
  };
}

describe('normalizeHost', () => {
  it('lowercases and strips a trailing dot', () => {
    expect(normalizeHost('API.Example.COM.')).toBe('api.example.com');
  });

  it('normalises punycode the same way', () => {
    expect(normalizeHost('münchen.de')).toBe(normalizeHost('xn--mnchen-3ya.de'));
  });
});

describe('isHostAllowed', () => {
  it('matches case-insensitively', () => {
    expect(isHostAllowed('API.EXAMPLE.COM', ['api.example.com'])).toBe(true);
  });

  it('rejects suffix matches and wildcards', () => {
    expect(isHostAllowed('sub.api.example.com', ['api.example.com'])).toBe(false);
    expect(isHostAllowed('api.example.com.evil.com', ['api.example.com'])).toBe(false);
    expect(isHostAllowed('api.example.com', ['*.example.com'])).toBe(false);
  });

  it('rejects IP literals even when listed', () => {
    expect(isHostAllowed('93.184.216.34', ['93.184.216.34'])).toBe(false);
    expect(isHostAllowed('::1', ['::1'])).toBe(false);
  });
});

describe('validateFetchRequest', () => {
  it('accepts a valid request and pins the first resolved address', async () => {
    const check = await validateFetchRequest(
      { url: 'https://api.example.com/x', method: 'GET', headers: {}, bodyPresent: false },
      bridge({ resolver: async () => ['93.184.216.34', '1.1.1.1'] }),
    );
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.request.address).toBe('93.184.216.34');
      expect(check.request.url.hostname).toBe('api.example.com');
    }
  });

  it('rejects plain http', async () => {
    const check = await validateFetchRequest(
      { url: 'http://api.example.com/x', method: 'GET', headers: {}, bodyPresent: false },
      bridge(),
    );
    expect(check).toMatchObject({ ok: false, message: 'only https is allowed' });
  });

  it('rejects credentials in the URL', async () => {
    const check = await validateFetchRequest(
      {
        url: 'https://user:pass@api.example.com/x',
        method: 'GET',
        headers: {},
        bodyPresent: false,
      },
      bridge(),
    );
    expect(check).toMatchObject({ ok: false, message: 'credentials in url are not allowed' });
  });

  it('rejects an explicit non-443 port', async () => {
    const check = await validateFetchRequest(
      { url: 'https://api.example.com:8443/x', method: 'GET', headers: {}, bodyPresent: false },
      bridge(),
    );
    expect(check).toMatchObject({ ok: false, message: 'explicit port is not allowed' });
  });

  it('rejects a host outside the allowlist', async () => {
    const resolver = vi.fn(async () => ['93.184.216.34']);
    const check = await validateFetchRequest(
      { url: 'https://evil.com/x', method: 'GET', headers: {}, bodyPresent: false },
      bridge({ resolver }),
    );
    expect(check).toMatchObject({ ok: false, message: 'host not allowed: evil.com' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each(['127.0.0.1', '10.0.0.5', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1'])(
    'rejects a listed host resolving to %s',
    async (address) => {
      const check = await validateFetchRequest(
        { url: 'https://api.example.com/x', method: 'GET', headers: {}, bodyPresent: false },
        bridge({ resolver: async () => [address] }),
      );
      expect(check).toMatchObject({ ok: false, message: 'host not allowed: api.example.com' });
    },
  );

  it('rejects when one of several addresses is private', async () => {
    const check = await validateFetchRequest(
      { url: 'https://api.example.com/x', method: 'GET', headers: {}, bodyPresent: false },
      bridge({ resolver: async () => ['93.184.216.34', '10.0.0.5'] }),
    );
    expect(check.ok).toBe(false);
  });

  it('rejects IP-literal URLs', async () => {
    const check = await validateFetchRequest(
      { url: 'https://93.184.216.34/x', method: 'GET', headers: {}, bodyPresent: false },
      bridge({ allowedHosts: ['93.184.216.34'] }),
    );
    expect(check.ok).toBe(false);
  });

  it('rejects POST, PUT and bodies', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const check = await validateFetchRequest(
        { url: 'https://api.example.com/x', method, headers: {}, bodyPresent: false },
        bridge(),
      );
      expect(check).toMatchObject({ ok: false, message: 'method not allowed' });
    }
    const withBody = await validateFetchRequest(
      { url: 'https://api.example.com/x', method: 'GET', headers: {}, bodyPresent: true },
      bridge(),
    );
    expect(withBody).toMatchObject({ ok: false, message: 'request body not allowed' });
  });

  it('rejects unparsable URLs', async () => {
    const check = await validateFetchRequest(
      { url: 'https://', method: 'GET', headers: {}, bodyPresent: false },
      bridge(),
    );
    expect(check).toMatchObject({ ok: false, message: 'invalid url' });
  });

  it('rejects when DNS fails', async () => {
    const check = await validateFetchRequest(
      { url: 'https://api.example.com/x', method: 'GET', headers: {}, bodyPresent: false },
      bridge({
        resolver: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    );
    expect(check.ok).toBe(false);
  });

  it('performs a real pinned TLS request against a local server (SNI + Host stay the hostname)', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createServer } = await import('node:https');
    const { fetchPinnedHttps } = await import('./host-fetch');
    const dir = mkdtempSync(join(tmpdir(), 'zilar-tls-'));
    try {
      execFileSync('openssl', [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-keyout',
        join(dir, 'k.pem'),
        '-out',
        join(dir, 'c.pem'),
        '-days',
        '1',
        '-nodes',
        '-subj',
        '/CN=tooltest.local',
      ]);
      const seen: Array<{ sni: string | undefined; host: string | undefined }> = [];
      const server = createServer(
        { key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) },
        (req, res) => {
          seen.push({
            sni: (req.socket as { servername?: string }).servername,
            host: Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host,
          });
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('real-bytes');
        },
      );
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      try {
        const response = await fetchPinnedHttps(new URL('https://tooltest.local/hi'), '127.0.0.1', {
          fetchTimeoutMs: 5000,
          maxResponseBytes: 65536,
          port,
        });
        expect(response.status).toBe(200);
        expect(Buffer.from(response.body).toString()).toBe('real-bytes');
        expect(seen).toEqual([{ sni: 'tooltest.local', host: 'tooltest.local' }]);
      } finally {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = undefined;
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores tool-supplied headers: the real request carries only accept and the fixed user-agent', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createServer } = await import('node:https');
    const { fetchPinnedHttps } = await import('./host-fetch');
    const dir = mkdtempSync(join(tmpdir(), 'zilar-hdr-'));
    try {
      execFileSync('openssl', [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-keyout',
        join(dir, 'k.pem'),
        '-out',
        join(dir, 'c.pem'),
        '-days',
        '1',
        '-nodes',
        '-subj',
        '/CN=tooltest.local',
      ]);
      const seen: Array<{ accept: unknown; userAgent: unknown; authorization: unknown }> = [];
      const server = createServer(
        { key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) },
        (req, res) => {
          seen.push({
            accept: req.headers.accept,
            userAgent: req.headers['user-agent'],
            authorization: req.headers.authorization,
          });
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('ok');
        },
      );
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      try {
        // fetchPinnedHttps takes no headers argument at all: whatever the
        // tool passed is dropped at validation, so the wire always shows
        // exactly these two headers and nothing else.
        const response = await fetchPinnedHttps(new URL('https://tooltest.local/x'), '127.0.0.1', {
          fetchTimeoutMs: 5000,
          maxResponseBytes: 65536,
          port,
        });
        expect(response.status).toBe(200);
        expect(seen).toEqual([
          { accept: '*/*', userAgent: 'ZilarTool/1', authorization: undefined },
        ]);
      } finally {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = undefined;
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fetchPinnedHttpsEffect', () => {
  type Handler = (req: IncomingMessage, res: ServerResponse) => void;

  // Runs `body` against a local TLS server (self-signed cert, no outbound
  // network) and tears everything down afterwards.
  async function withTlsServer(
    handler: Handler,
    body: (port: number) => Promise<void>,
  ): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'zilar-eff-'));
    try {
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-keyout',
          join(dir, 'k.pem'),
          '-out',
          join(dir, 'c.pem'),
          '-days',
          '1',
          '-nodes',
          '-subj',
          '/CN=tooltest.local',
        ],
        { stdio: 'ignore' },
      );
      const server = createTlsServer(
        { key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) },
        handler,
      );
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      try {
        await body(port);
      } finally {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('destroys the request when the fiber is interrupted', async () => {
    let closed: () => void = () => undefined;
    const connectionClosed = new Promise<void>((resolve) => {
      closed = resolve;
    });
    let received: () => void = () => undefined;
    const requestReceived = new Promise<void>((resolve) => {
      received = resolve;
    });
    await withTlsServer(
      // The server never answers, so only the client can end the connection.
      (req) => {
        req.socket.on('close', closed);
        received();
      },
      async (port) => {
        const controller = new AbortController();
        const outcome = Effect.runPromise(
          fetchPinnedHttpsEffect(new URL('https://tooltest.local/slow'), '127.0.0.1', {
            fetchTimeoutMs: 60_000,
            maxResponseBytes: 65536,
            port,
          }),
          { signal: controller.signal },
        );
        await requestReceived;
        controller.abort();
        await expect(outcome).rejects.toBeDefined();
        // Without the interruption finalizer the socket would stay open for
        // the whole 60 s timeout and this would never resolve.
        await connectionClosed;
      },
    );
  });

  it('keeps the timeout text', async () => {
    await withTlsServer(
      () => undefined,
      async (port) => {
        await expect(
          fetchPinnedHttps(new URL('https://tooltest.local/slow'), '127.0.0.1', {
            fetchTimeoutMs: 50,
            maxResponseBytes: 65536,
            port,
          }),
        ).rejects.toThrow('fetch timeout');
      },
    );
  });

  it('keeps the size cap text', async () => {
    await withTlsServer(
      (_req, res) => {
        // Two chunks with the end held back, so the cap trips mid-stream.
        res.writeHead(200);
        res.write(Buffer.alloc(600, 1));
        setTimeout(() => res.write(Buffer.alloc(600, 1)), 50);
      },
      async (port) => {
        await expect(
          fetchPinnedHttps(new URL('https://tooltest.local/big'), '127.0.0.1', {
            fetchTimeoutMs: 5000,
            maxResponseBytes: 1024,
            port,
          }),
        ).rejects.toThrow('response too large');
      },
    );
  });

  it('returns an empty body for a redirect without following it', async () => {
    await withTlsServer(
      (_req, res) => {
        res.writeHead(302, { location: 'https://elsewhere.example/' });
        res.end();
      },
      async (port) => {
        const response = await fetchPinnedHttps(new URL('https://tooltest.local/r'), '127.0.0.1', {
          fetchTimeoutMs: 5000,
          maxResponseBytes: 1024,
          port,
        });
        expect(response.status).toBe(302);
        expect(response.body.length).toBe(0);
      },
    );
  });
});
