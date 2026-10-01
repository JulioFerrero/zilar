import type { Attachment } from '@galena/protocol';
import { describe, expect, it } from 'vitest';

import {
  attachmentDataFor,
  classifyMobileFile,
  cleanFilename,
  extensionForMime,
  formatFileSize,
  isGifVideoAttachment,
  isTrustedMediaUrl,
  MAX_ATTACHMENT_BYTES,
  mimeForAsset,
  safeHttpUrl,
  sanitizeIncomingAttachment,
  trustedMediaHosts,
} from './attachments';

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    kind: 'image',
    url: 'https://upload.galena.test/x/stage.png',
    name: 'stage.png',
    size: 245_760,
    mime: 'image/png',
    width: 640,
    height: 420,
    ...overrides,
  };
}

describe('mobile attachments lib (T-0150)', () => {
  it('caps uploads at the 50 MiB server limit', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(50 * 1024 * 1024);
  });

  it('classifies images by MIME and treats SVG and unknown types as files', () => {
    expect(classifyMobileFile({ mimeType: 'image/png' })).toBe('image');
    expect(classifyMobileFile({ mimeType: 'image/jpeg' })).toBe('image');
    expect(classifyMobileFile({ mimeType: 'image/gif' })).toBe('image');
    expect(classifyMobileFile({ mimeType: 'image/webp' })).toBe('image');
    expect(classifyMobileFile({ mimeType: 'image/svg+xml' })).toBe('file');
    expect(classifyMobileFile({ mimeType: 'video/mp4' })).toBe('file');
    expect(classifyMobileFile({})).toBe('file');
    expect(classifyMobileFile({ mimeType: 'IMAGE/PNG' })).toBe('image');
  });

  it('cleans file names like the web twin', () => {
    expect(cleanFilename('/tmp/photo.jpg')).toBe('photo.jpg');
    expect(cleanFilename('C:\\Users\\a\\notes.pdf')).toBe('notes.pdf');
    expect(cleanFilename('  ')).toBe('file');
    expect(cleanFilename('a'.repeat(300))).toHaveLength(255);
    expect(cleanFilename('bad\u0000name.jpg')).toBe('badname.jpg');
  });

  it('formats sizes like the web twin', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(245_760)).toBe('240 KB');
    expect(formatFileSize(2_411_724)).toBe('2.3 MB');
    expect(formatFileSize(-1)).toBe('');
  });

  it('only follows http(s) URLs', () => {
    expect(safeHttpUrl('https://upload.galena.test/x')).toBe('https://upload.galena.test/x');
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('data:image/png;base64,xx')).toBeUndefined();
  });

  it('trusts the service host, the domain and upload.<domain>', () => {
    const hosts = trustedMediaHosts({
      service: 'wss://chat.galena.test/ws',
      domain: 'galena.test',
    });
    expect(hosts.has('chat.galena.test')).toBe(true);
    expect(hosts.has('galena.test')).toBe(true);
    expect(hosts.has('upload.galena.test')).toBe(true);
    expect(isTrustedMediaUrl('https://upload.galena.test/f/x.png', hosts)).toBe(true);
    expect(isTrustedMediaUrl('https://evil.test/x.png', hosts)).toBe(false);
    expect(isTrustedMediaUrl('javascript:alert(1)', hosts)).toBe(false);
    expect(isTrustedMediaUrl('gradient:sunset', hosts)).toBe(false);
  });

  it('builds the wire payload exactly as web does', () => {
    const data = attachmentDataFor(
      {
        uri: 'file:///x/photo.jpg',
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: 120,
        width: 4,
        height: 3,
      },
      'https://upload.galena.test/get/abc',
    );
    expect(data).toEqual({
      kind: 'image',
      url: 'https://upload.galena.test/get/abc',
      name: 'photo.jpg',
      size: 120,
      mime: 'image/jpeg',
      width: 4,
      height: 3,
    });
  });

  it('falls back to application/octet-stream and file for unknown types', () => {
    const data = attachmentDataFor({ uri: 'file:///x/blob', size: 10 }, 'https://u/get');
    expect(data.mime).toBe('application/octet-stream');
    expect(data.kind).toBe('file');
    expect(data.name).toBe('file');
  });

  it('drops out-of-range image dimensions', () => {
    const data = attachmentDataFor(
      {
        uri: 'file:///x/a.png',
        name: 'a.png',
        mimeType: 'image/png',
        size: 5,
        width: 0,
        height: 3,
      },
      'https://u/get',
    );
    expect(data.width).toBeUndefined();
    expect(data.height).toBeUndefined();
  });

  it('keeps a trusted image and downgrades an untrusted one to a file card', () => {
    const trusted = sanitizeIncomingAttachment(attachment(), {
      service: 'ws://x',
      domain: 'galena.test',
    });
    expect(trusted.kind).toBe('image');

    const untrusted = sanitizeIncomingAttachment(attachment({ url: 'https://evil.test/x.png' }), {
      service: 'ws://x',
      domain: 'galena.test',
    });
    expect(untrusted.kind).toBe('file');
    expect(untrusted.width).toBeUndefined();
  });

  it('never trusts an image without a token', () => {
    const result = sanitizeIncomingAttachment(attachment(), undefined);
    expect(result.kind).toBe('file');
  });

  it('leaves plain files alone', () => {
    const file = attachment({ kind: 'file', name: 'tickets.pdf', mime: 'application/pdf' });
    expect(sanitizeIncomingAttachment(file, undefined)).toEqual(file);
  });

  // T-0148: a GIF-origin attachment whose URL is a same-origin /api/ path
  // (web sends absolute upload URLs, but a relative API path resolves
  // against the API origin) renders inline through the API origin; the
  // request carries the session bearer. Any other host stays a file row.
  it('matches gif- videos on a same-origin /api/ path too', () => {
    const trusted = new Set(['upload.galena.test', 'galena.test']);
    const video = attachment({
      kind: 'file',
      name: 'gif-abc123.mp4',
      mime: 'video/mp4',
      url: 'https://galena.test/api/files/get/abc',
    });
    expect(isGifVideoAttachment(video, trusted)).toBe(true);
    expect(
      isGifVideoAttachment({ ...video, url: 'https://evil.test/api/files/get/abc' }, trusted),
    ).toBe(false);
  });

  it('matches gif- videos only on trusted URLs', () => {
    const trusted = new Set(['upload.galena.test']);
    const video = attachment({
      kind: 'file',
      name: 'gif-abc123.mp4',
      mime: 'video/mp4',
      url: 'https://upload.galena.test/get/abc',
    });
    expect(isGifVideoAttachment(video, trusted)).toBe(true);
    expect(isGifVideoAttachment({ ...video, url: 'https://evil.test/x.mp4' }, trusted)).toBe(false);
    expect(isGifVideoAttachment({ ...video, name: 'clip.mp4' }, trusted)).toBe(false);
    expect(isGifVideoAttachment({ ...video, mime: 'application/pdf' }, trusted)).toBe(false);
  });

  it('maps picker MIME types to file extensions', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('video/quicktime')).toBe('mov');
    expect(extensionForMime('application/pdf')).toBe('pdf');
    expect(extensionForMime(undefined)).toBe('bin');
    expect(extensionForMime('image/svg+xml')).toBe('bin');
    expect(mimeForAsset('')).toBe('application/octet-stream');
    expect(mimeForAsset('image/png')).toBe('image/png');
  });
});
