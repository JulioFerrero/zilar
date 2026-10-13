import type { Attachment } from '@zilar/protocol';
import {
  isTrustedMediaUrl,
  parseUrl,
  sanitizeIncomingAttachment,
  trustedMediaHosts,
} from '@zilar/chat-core';
import { afterEach, describe, expect, it } from 'vitest';

// The live-shaped XMPP token (deploy/coolify/docker-compose.app.yml: both the
// WS service and the XMPP domain are `chat.zilar.app`).
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

/**
 * The message pipeline's media trust on the runtime the phone runs. React
 * Native ships only a partial `URL` (its accessors match `http(s)://` alone),
 * and a runtime without a usable `URL` used to make `parseUrl` return
 * `undefined` for every URL: `trustedMediaHosts` then dropped the service host
 * and `isTrustedMediaUrl` read every URL as untrusted, so a history image was
 * downgraded to the "Not loaded: untrusted address" file card. `parseUrl` must
 * not depend on the global `URL`.
 */
describe('media trust on a runtime without a usable URL', () => {
  const originalUrl = globalThis.URL;
  afterEach(() => {
    globalThis.URL = originalUrl;
  });

  it('keeps a history photo an image with the live-shaped token', () => {
    // Emulate the phone: no usable `URL`, so `new URL(...)` throws.
    (globalThis as { URL?: unknown }).URL = undefined;

    expect(parseUrl(TOKEN.service)?.hostname).toBe('chat.zilar.app');
    expect(trustedMediaHosts(TOKEN).has('chat.zilar.app')).toBe(true);
    expect(isTrustedMediaUrl(PHOTO.url, trustedMediaHosts(TOKEN))).toBe(true);
    expect(sanitizeIncomingAttachment(PHOTO, TOKEN).kind).toBe('image');
  });
});
