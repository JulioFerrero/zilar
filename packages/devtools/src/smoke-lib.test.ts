import { describe, expect, it } from 'vitest';
import {
  basicAuthHeader,
  buildOpenFrame,
  parseOpenFrame,
  XMPP_FRAMING_NAMESPACE,
} from './smoke-lib';

describe('buildOpenFrame', () => {
  it('builds the RFC 7395 open frame for a domain', () => {
    const frame = buildOpenFrame('galena.localhost');
    expect(frame).toContain(XMPP_FRAMING_NAMESPACE);
    expect(frame).toContain("to='galena.localhost'");
    expect(frame.startsWith('<open')).toBe(true);
  });

  it('rejects an empty domain', () => {
    expect(() => buildOpenFrame('  ')).toThrow('domain must not be empty');
  });
});

describe('parseOpenFrame', () => {
  it('parses the server reply and its from attribute', () => {
    const reply = parseOpenFrame(
      "<open xmlns='urn:ietf:params:xml:ns:xmpp-framing' from='galena.localhost' id='abc' version='1.0'/>",
    );
    expect(reply).toEqual({ from: 'galena.localhost' });
  });

  it('parses double-quoted attributes and tolerates surrounding whitespace', () => {
    const reply = parseOpenFrame(
      '\n  <open xmlns="urn:ietf:params:xml:ns:xmpp-framing" from="galena.localhost">\n',
    );
    expect(reply).toEqual({ from: 'galena.localhost' });
  });

  it('returns a null from when the reply has no from attribute', () => {
    const reply = parseOpenFrame(
      "<open xmlns='urn:ietf:params:xml:ns:xmpp-framing' version='1.0'/>",
    );
    expect(reply).toEqual({ from: null });
  });

  it('returns null for a close frame', () => {
    expect(parseOpenFrame("<close xmlns='urn:ietf:params:xml:ns:xmpp-framing'/>")).toBeNull();
  });

  it('returns null when the framing namespace is missing', () => {
    expect(parseOpenFrame('<open to="galena.localhost"/>')).toBeNull();
  });

  it('returns null for a raw stream header or garbage', () => {
    expect(
      parseOpenFrame('<stream:stream xmlns:stream="http://etherx.jabber.org/streams">'),
    ).toBeNull();
    expect(parseOpenFrame('')).toBeNull();
  });
});

describe('basicAuthHeader', () => {
  it('encodes the JID and password as HTTP Basic credentials', () => {
    expect(basicAuthHeader('admin@galena.localhost', 'secret')).toBe(
      `Basic ${Buffer.from('admin@galena.localhost:secret', 'utf8').toString('base64')}`,
    );
    expect(basicAuthHeader('admin@galena.localhost', 'secret')).toMatch(/^Basic [A-Za-z0-9+/=]+$/);
  });
});
