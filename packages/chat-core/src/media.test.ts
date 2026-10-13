import type { Attachment } from '@zilar/protocol';
import { describe, expect, it } from 'vitest';
import { isTrustedMediaUrl, sanitizeIncomingAttachment, trustedMediaHosts } from './media';

// The live-shaped XMPP token (deploy/coolify/docker-compose.app.yml): the WS
// service and the XMPP domain are both `chat.zilar.app`, and uploads answer at
// `https://chat.zilar.app/upload/...`.
const TOKEN = { service: 'wss://chat.zilar.app/xmpp-ws/ws', domain: 'chat.zilar.app' };

const PHOTO: Attachment = {
  kind: 'image',
  url: 'https://chat.zilar.app/upload/abc/20.png',
  name: '20.png',
  size: 1234,
  mime: 'image/png',
  width: 10,
  height: 10,
};

describe('trustedMediaHosts', () => {
  it('trusts the service host, the domain and upload.<domain>', () => {
    const hosts = trustedMediaHosts(TOKEN);
    expect(hosts.has('chat.zilar.app')).toBe(true);
    expect(hosts.has('upload.chat.zilar.app')).toBe(true);
  });
});

describe('isTrustedMediaUrl', () => {
  it('trusts an upload URL on a trusted host and rejects another host or scheme', () => {
    const hosts = trustedMediaHosts(TOKEN);
    expect(isTrustedMediaUrl(PHOTO.url, hosts)).toBe(true);
    expect(isTrustedMediaUrl('https://evil.test/upload/20.png', hosts)).toBe(false);
    expect(isTrustedMediaUrl('javascript:alert(1)', hosts)).toBe(false);
    expect(isTrustedMediaUrl('/upload/20.png', hosts)).toBe(false);
  });
  it('rejects a backslash in the authority (fetch layers treat it as "/")', () => {
    // A peer's `https://evil.test\@chat.zilar.app/x` resolves to `evil.test`
    // via fetch, so the `@chat.zilar.app` suffix must not make it trusted.
    const hosts = trustedMediaHosts(TOKEN);
    expect(isTrustedMediaUrl('https://evil.test\\@chat.zilar.app/x', hosts)).toBe(false);
  });
});

describe('sanitizeIncomingAttachment', () => {
  it('keeps an image on a trusted host', () => {
    expect(sanitizeIncomingAttachment(PHOTO, TOKEN)).toEqual(PHOTO);
  });

  it('downgrades a backslash host-confusion image to a file card', () => {
    const downgraded = sanitizeIncomingAttachment(
      { ...PHOTO, url: 'https://evil.test\\@chat.zilar.app/x' },
      TOKEN,
    );
    expect(downgraded.kind).toBe('file');
    expect(downgraded.width).toBeUndefined();
    expect(downgraded.height).toBeUndefined();
  });

  it('downgrades an image on an untrusted host to a file card', () => {
    const downgraded = sanitizeIncomingAttachment(
      { ...PHOTO, url: 'https://evil.test/20.png' },
      TOKEN,
    );
    expect(downgraded.kind).toBe('file');
    expect(downgraded.width).toBeUndefined();
    expect(downgraded.height).toBeUndefined();
  });

  it('leaves a plain file attachment alone', () => {
    const file: Attachment = {
      kind: 'file',
      url: 'https://evil.test/report.pdf',
      name: 'report.pdf',
      size: 3,
      mime: 'application/pdf',
    };
    expect(sanitizeIncomingAttachment(file, TOKEN)).toEqual(file);
  });
});
