// T-1396: the two checks on a user-supplied base URL. The shape check is
// synchronous; the DNS check runs per request and must refuse a host that
// answers with any private address.
import { describe, expect, it } from 'vitest';
import { resolvePublic, validateBaseUrl } from './base-url';

describe('validateBaseUrl', () => {
  it('accepts a public https URL and normalizes it', () => {
    expect(validateBaseUrl('https://api.groq.com/openai/v1')).toBe(
      'https://api.groq.com/openai/v1',
    );
    expect(validateBaseUrl('https://api.groq.com/')).toBe('https://api.groq.com/v1');
    expect(validateBaseUrl('https://api.groq.com/v1/')).toBe('https://api.groq.com/v1');
    expect(validateBaseUrl('  https://api.groq.com/openai/v1  ')).toBe(
      'https://api.groq.com/openai/v1',
    );
  });

  it.each([
    ['http', 'http://api.groq.com/v1'],
    ['credentials', 'https://user:pass@api.groq.com/v1'],
    ['a query', 'https://api.groq.com/v1?key=1'],
    ['a fragment', 'https://api.groq.com/v1#x'],
    ['a non-443 port', 'https://api.groq.com:8443/v1'],
    ['localhost', 'https://localhost/v1'],
    ['a private literal', 'https://10.0.0.1/v1'],
    ['a loopback literal', 'https://127.0.0.1/v1'],
    ['a link-local literal', 'https://169.254.169.254/v1'],
    ['an IPv6 loopback literal', 'https://[::1]/v1'],
  ])('rejects %s', (_name, raw) => {
    expect(() => validateBaseUrl(raw)).toThrow();
  });
});

describe('resolvePublic', () => {
  it('refuses an IP literal without resolving', async () => {
    await expect(resolvePublic('169.254.169.254')).rejects.toThrow();
    await expect(resolvePublic('127.0.0.1')).rejects.toThrow();
  });

  it('refuses a host that resolves to one public and one private address', async () => {
    await expect(
      resolvePublic('rebind.example', async () => ['93.184.216.34', '10.0.0.1']),
    ).rejects.toThrow();
  });

  it('refuses loopback and link-local answers', async () => {
    await expect(resolvePublic('x.example', async () => ['127.0.0.1'])).rejects.toThrow();
    await expect(resolvePublic('x.example', async () => ['169.254.169.254'])).rejects.toThrow();
    await expect(resolvePublic('x.example', async () => ['::1'])).rejects.toThrow();
  });

  it('refuses a host that does not resolve', async () => {
    await expect(
      resolvePublic('gone.example', async () => {
        throw new Error('ENOTFOUND');
      }),
    ).rejects.toThrow();
    await expect(resolvePublic('empty.example', async () => [])).rejects.toThrow();
  });

  it('returns the pinned address for a public host', async () => {
    await expect(resolvePublic('api.groq.com', async () => ['93.184.216.34'])).resolves.toBe(
      '93.184.216.34',
    );
  });
});
