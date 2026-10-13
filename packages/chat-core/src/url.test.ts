import { describe, expect, it } from 'vitest';
import { parseUrl, safeDecode } from './url';

describe('parseUrl', () => {
  it('reads scheme, host, origin and path of an https URL', () => {
    expect(parseUrl('https://chat.zilar.app/upload/abc/20.png')).toEqual({
      protocol: 'https:',
      hostname: 'chat.zilar.app',
      origin: 'https://chat.zilar.app',
      pathname: '/upload/abc/20.png',
      toString: expect.any(Function),
    });
  });

  it('reads the host of the wss service URL the XMPP token carries', () => {
    expect(parseUrl('wss://chat.zilar.app/xmpp-ws/ws')?.hostname).toBe('chat.zilar.app');
    expect(parseUrl('wss://chat.zilar.app/xmpp-ws/ws')?.protocol).toBe('wss:');
  });

  it('lowercases the host and drops a default port from the origin', () => {
    const parsed = parseUrl('HTTPS://Chat.Zilar.App:443/upload/x');
    expect(parsed?.hostname).toBe('chat.zilar.app');
    expect(parsed?.origin).toBe('https://chat.zilar.app');
  });

  it('keeps a non-default port', () => {
    const parsed = parseUrl('http://ejabberd.test:5280/ws');
    expect(parsed?.hostname).toBe('ejabberd.test');
    expect(parsed?.origin).toBe('http://ejabberd.test:5280');
  });

  it('strips userinfo and reads an IPv6 host', () => {
    expect(parseUrl('https://user:pass@host.test/p')?.hostname).toBe('host.test');
    expect(parseUrl('http://[::1]:8080/x')?.hostname).toBe('[::1]');
  });

  it('defaults the path to "/" for an authority URL', () => {
    expect(parseUrl('https://chat.zilar.app')?.pathname).toBe('/');
    expect(parseUrl('https://chat.zilar.app?q=1')?.pathname).toBe('/');
  });

  it('parses a non-authority scheme for the protocol check', () => {
    expect(parseUrl('mailto:ana@zilar.app')?.protocol).toBe('mailto:');
    expect(parseUrl('javascript:alert(1)')?.protocol).toBe('javascript:');
  });

  it('rejects relative, hostless and malformed input', () => {
    expect(parseUrl('/upload/abc')).toBeUndefined();
    expect(parseUrl('not a url')).toBeUndefined();
    expect(parseUrl('https://')).toBeUndefined();
    expect(parseUrl('https:')).toBeUndefined();
  });

  it('rejects a backslash in an authority-scheme URL', () => {
    // Fetch layers treat `\` as `/` for special schemes, so the URL would
    // resolve to `evil.test` while the regex reads the host after `@` as
    // `chat.zilar.app`; fail closed rather than trust the wrong host.
    expect(parseUrl('https://evil.test\\@chat.zilar.app/x')).toBeUndefined();
    expect(parseUrl('https://chat.zilar.app\\evil.test/x')).toBeUndefined();
    expect(parseUrl('wss://chat.zilar.app\\xmpp-ws/ws')).toBeUndefined();
  });

  it('round-trips the original text through toString', () => {
    const text = 'https://chat.zilar.app/upload/abc/20.png';
    expect(parseUrl(text)?.toString()).toBe(text);
  });
});

describe('safeDecode', () => {
  it('decodes valid percent-encoding and keeps invalid input', () => {
    expect(safeDecode('a%20b')).toBe('a b');
    expect(safeDecode('%')).toBe('%');
  });
});
