import { describe, expect, it } from 'vitest';
import { checkTarget, type ResolveHost } from './proxy';

const resolvesTo =
  (...addresses: string[]): ResolveHost =>
  () =>
    Promise.resolve(addresses);

const publicResolver = resolvesTo('93.184.216.34');

describe('checkTarget', () => {
  it('allows a public host on 443', async () => {
    const decision = await checkTarget(
      { host: 'example.com', port: 443, allowedHosts: null },
      { resolver: publicResolver },
    );
    expect(decision).toEqual({ allow: true, address: '93.184.216.34' });
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['RFC 1918 10/8', '10.0.0.5'],
    ['RFC 1918 172.16/12', '172.16.4.4'],
    ['RFC 1918 192.168/16', '192.168.1.1'],
    ['link-local', '169.254.169.254'],
    ['IPv6 loopback', '::1'],
    ['IPv6 ULA', 'fd00::1'],
    ['Teredo', '2001::1'],
    ['6to4', '2002:7f00:1::1'],
  ])('denies %s', async (_label, address) => {
    const decision = await checkTarget(
      { host: 'rebind.example', port: 443, allowedHosts: null },
      { resolver: resolvesTo(address) },
    );
    expect(decision).toEqual({ allow: false, reason: 'blocked-address' });
  });

  it('denies an IP-literal host before resolving', async () => {
    let called = false;
    const decision = await checkTarget(
      { host: '127.0.0.1', port: 443, allowedHosts: null },
      {
        resolver: () => {
          called = true;
          return Promise.resolve(['127.0.0.1']);
        },
      },
    );
    expect(decision).toEqual({ allow: false, reason: 'ip-literal' });
    expect(called).toBe(false);
  });

  it('denies a host that resolves to one public and one private address', async () => {
    const decision = await checkTarget(
      { host: 'rebind.example', port: 443, allowedHosts: null },
      { resolver: resolvesTo('93.184.216.34', '10.0.0.9') },
    );
    expect(decision).toEqual({ allow: false, reason: 'blocked-address' });
  });

  it('denies a host outside the allowlist when one is set', async () => {
    const decision = await checkTarget(
      { host: 'evil.example', port: 443, allowedHosts: ['example.com'] },
      { resolver: publicResolver },
    );
    expect(decision).toEqual({ allow: false, reason: 'host-not-allowed' });
  });

  it('allows an allowlisted host case-insensitively', async () => {
    const decision = await checkTarget(
      { host: 'Example.com', port: 443, allowedHosts: ['example.com'] },
      { resolver: publicResolver },
    );
    expect(decision).toEqual({ allow: true, address: '93.184.216.34' });
  });

  it('denies every host when the allowlist is present but empty', async () => {
    const decision = await checkTarget(
      { host: 'example.com', port: 443, allowedHosts: [] },
      { resolver: publicResolver },
    );
    expect(decision).toEqual({ allow: false, reason: 'host-not-allowed' });
  });

  it('denies port 22', async () => {
    const decision = await checkTarget(
      { host: 'example.com', port: 22, allowedHosts: null },
      { resolver: publicResolver },
    );
    expect(decision).toEqual({ allow: false, reason: 'port' });
  });

  it('denies a host that does not resolve', async () => {
    const decision = await checkTarget(
      { host: 'missing.example', port: 443, allowedHosts: null },
      {
        resolver: () => Promise.reject(new Error('ENOTFOUND')),
      },
    );
    expect(decision).toEqual({ allow: false, reason: 'resolve-failed' });
  });
});
