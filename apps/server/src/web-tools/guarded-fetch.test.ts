// T-0125: SSRF and limit tests for the guarded fetch. A fake DNS
// resolver and a fake pinned fetcher stand in for the network: no
// socket is ever opened. Real refusal paths (private, loopback,
// link-local, 6to4, Teredo, unresolvable, http, explicit port, unknown
// host) run through the real guard code.
import { describe, expect, it } from 'vitest';
import {
  guardedGet,
  WEB_FETCH_TIMEOUT_MS,
  WEB_MAX_DECODE_CHARS,
  WEB_MAX_RESPONSE_BYTES,
  type DnsLookup,
  type PinnedFetcher,
} from './guarded-fetch';

const PUBLIC_IP = '93.184.215.14';

function resolverFor(addresses: Record<string, string[]>): DnsLookup {
  return async (host: string) => {
    const found = addresses[host];
    if (found === undefined) {
      throw new Error('ENOTFOUND');
    }
    return found;
  };
}

function okFetcher(
  text: string,
  contentType = 'text/html; charset=utf-8',
  status = 200,
): PinnedFetcher & { calls: { url: URL; address: string }[] } {
  const calls: { url: URL; address: string }[] = [];
  return Object.assign(
    async (url: URL, address: string) => {
      calls.push({ url, address });
      return {
        response: { status, rawContentType: contentType, location: null },
        raw: new TextEncoder().encode(text),
      };
    },
    { calls },
  );
}

describe('guardedGet SSRF and limits (T-0125)', () => {
  it('fetches a public host pinned to the validated IP', async () => {
    const fetcher = okFetcher('<p>hello</p>');
    const result = await guardedGet('https://example.com/page', {
      allowedHosts: ['example.com'],
      resolver: resolverFor({ 'example.com': [PUBLIC_IP] }),
      fetcher,
    });
    expect(result).toEqual({
      ok: true,
      body: {
        status: 200,
        contentType: 'text/html',
        location: null,
        text: '<p>hello</p>',
      },
    });
    expect(fetcher.calls).toHaveLength(1);
    expect(fetcher.calls[0]?.address).toBe(PUBLIC_IP);
    expect(fetcher.calls[0]?.url.hostname).toBe('example.com');
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['private 10/8', '10.1.2.3'],
    ['private 172.16/12', '172.16.9.9'],
    ['private 192.168/16', '192.168.0.5'],
    ['link-local', '169.254.169.254'],
    ['CGNAT', '100.64.0.1'],
    ['multicast', '224.0.0.1'],
    ['unspecified', '0.0.0.0'],
    ['IPv6 loopback', '::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 ULA', 'fc00::1'],
    ['6to4', '2002:cb00:7100::1'],
    ['Teredo', '2001::1'],
  ])('refuses a hostname that resolves to %s (%s)', async (_label, address) => {
    const fetcher = okFetcher('never');
    const result = await guardedGet('https://example.com/', {
      allowedHosts: ['example.com'],
      resolver: resolverFor({ 'example.com': [address] }),
      fetcher,
    });
    expect(result).toEqual({ ok: false, summary: 'host not allowed' });
    expect(fetcher.calls).toHaveLength(0);
  });

  it('refuses when any of several addresses is private', async () => {
    const fetcher = okFetcher('never');
    const result = await guardedGet('https://example.com/', {
      allowedHosts: ['example.com'],
      resolver: resolverFor({ 'example.com': [PUBLIC_IP, '10.0.0.1'] }),
      fetcher,
    });
    expect(result).toEqual({ ok: false, summary: 'host not allowed' });
    expect(fetcher.calls).toHaveLength(0);
  });

  it('refuses IP literals without resolving', async () => {
    let resolved = false;
    const result = await guardedGet('https://93.184.215.14/', {
      allowedHosts: ['93.184.215.14'],
      resolver: async () => {
        resolved = true;
        return [PUBLIC_IP];
      },
      fetcher: okFetcher('never'),
    });
    expect(result).toEqual({ ok: false, summary: 'host not allowed' });
    expect(resolved).toBe(false);
  });

  it('returns redirects as a result instead of following them', async () => {
    const calls: { url: URL; address: string }[] = [];
    const fetcher = (async (url: URL, address: string) => {
      calls.push({ url, address });
      return {
        response: { status: 301, rawContentType: 'text/html', location: 'https://other.example/x' },
        raw: new Uint8Array(0),
      };
    }) as PinnedFetcher;
    const result = await guardedGet('https://example.com/', {
      allowedHosts: ['example.com'],
      resolver: resolverFor({ 'example.com': [PUBLIC_IP] }),
      fetcher,
    });
    expect(result).toEqual({
      ok: false,
      summary: 'not followed: redirect to https://other.example/x',
    });
    expect(calls).toHaveLength(1);
  });

  it('reports redirect without a location plainly', async () => {
    const fetcher = (async () => ({
      response: { status: 302, rawContentType: null, location: null },
      raw: new Uint8Array(0),
    })) as PinnedFetcher;
    const result = await guardedGet('https://example.com/', {
      allowedHosts: ['example.com'],
      resolver: resolverFor({ 'example.com': [PUBLIC_IP] }),
      fetcher,
    });
    expect(result).toEqual({ ok: false, summary: 'not followed: redirect (status 302)' });
  });

  it('maps timeouts and oversize bodies to plain summaries', async () => {
    const timeout = (async () => {
      throw new Error('fetch timeout');
    }) as PinnedFetcher;
    expect(
      await guardedGet('https://example.com/', {
        allowedHosts: ['example.com'],
        resolver: resolverFor({ 'example.com': [PUBLIC_IP] }),
        fetcher: timeout,
      }),
    ).toEqual({ ok: false, summary: 'fetch timed out' });
    const tooLarge = (async () => {
      throw new Error('response too large');
    }) as PinnedFetcher;
    expect(
      await guardedGet('https://example.com/', {
        allowedHosts: ['example.com'],
        resolver: resolverFor({ 'example.com': [PUBLIC_IP] }),
        fetcher: tooLarge,
      }),
    ).toEqual({ ok: false, summary: 'response too large' });
  });

  it('reads only allow-listed content types', async () => {
    for (const contentType of [
      'application/pdf',
      'image/png',
      'application/octet-stream',
      'text/htmlevil',
    ]) {
      const result = await guardedGet('https://example.com/file', {
        allowedHosts: ['example.com'],
        resolver: resolverFor({ 'example.com': [PUBLIC_IP] }),
        fetcher: okFetcher('%PDF-1.4', contentType),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.summary).toMatch(/^unsupported content type /);
      }
    }
    for (const contentType of [
      'text/html',
      'text/plain',
      'application/json',
      'application/xml',
      'text/xml',
      'application/rss+xml',
      'application/atom+xml',
      'text/csv',
      'Text/HTML; charset=utf-8',
    ]) {
      const result = await guardedGet('https://example.com/file', {
        allowedHosts: ['example.com'],
        resolver: resolverFor({ 'example.com': [PUBLIC_IP] }),
        fetcher: okFetcher('body', contentType),
      });
      expect(result.ok).toBe(true);
    }
  });

  it('refuses http, credentials, explicit ports and unknown hosts without sending', async () => {
    const fetcher = okFetcher('never');
    const base = {
      allowedHosts: ['example.com'],
      resolver: resolverFor({ 'example.com': [PUBLIC_IP] }),
      fetcher,
    };
    // `missing.example` is absent from the fake resolver (ENOTFOUND):
    // the guard answers `host not allowed` so an observer cannot tell
    // an unresolvable host from a refused one.
    expect(await guardedGet('http://example.com/', base)).toEqual({
      ok: false,
      summary: 'only https urls are allowed',
    });
    expect(await guardedGet('https://user:pass@example.com/', base)).toEqual({
      ok: false,
      summary: 'credentials in url are not allowed',
    });
    expect(await guardedGet('https://example.com:8443/', base)).toEqual({
      ok: false,
      summary: 'explicit port is not allowed',
    });
    expect(await guardedGet('https://evil.example/', base)).toEqual({
      ok: false,
      summary: 'host not allowed',
    });
    expect(await guardedGet('https://missing.example/', base)).toEqual({
      ok: false,
      summary: 'host not allowed',
    });
    expect(await guardedGet('not a url', base)).toEqual({ ok: false, summary: 'invalid url' });
    expect(fetcher.calls).toHaveLength(0);
  });

  it('treats the 443 port as the default and matches hosts case-insensitively', async () => {
    const fetcher = okFetcher('hi', 'text/plain');
    const result = await guardedGet('https://Example.COM:443/', {
      allowedHosts: ['example.com'],
      resolver: resolverFor({ 'example.com': [PUBLIC_IP] }),
      fetcher,
    });
    expect(result.ok).toBe(true);
  });

  it('fetches with GET only: the pinned fetch never takes a body', async () => {
    const fetcher = okFetcher('hi', 'text/plain');
    await guardedGet('https://example.com/', {
      allowedHosts: ['example.com'],
      resolver: resolverFor({ 'example.com': [PUBLIC_IP] }),
      fetcher,
    });
    expect(fetcher.calls).toHaveLength(1);
  });

  it('caps body decode at 2 MiB', () => {
    expect(WEB_MAX_RESPONSE_BYTES).toBe(2 * 1024 * 1024);
    expect(WEB_MAX_DECODE_CHARS).toBe(2 * 1024 * 1024);
    expect(WEB_FETCH_TIMEOUT_MS).toBe(10_000);
  });
});
