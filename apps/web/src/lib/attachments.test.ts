import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UploadSlot } from '@zilar/xmpp-core';
import type { UploadSlotRequester } from './voice';
import {
  MAX_ATTACHMENT_BYTES,
  AttachmentError,
  classify,
  cleanFilename,
  formatFileSize,
  gifBlobType,
  isTrustedMediaUrl,
  readImageSize,
  safeHttpUrl,
  trustedMediaHosts,
  uploadAttachment,
} from './attachments';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function file(name: string, type: string, bytes = 3): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('classify', () => {
  it('treats the four raster image types as images', () => {
    expect(classify(file('a.png', 'image/png'))).toBe('image');
    expect(classify(file('a.jpg', 'image/jpeg'))).toBe('image');
    expect(classify(file('a.gif', 'image/gif'))).toBe('image');
    expect(classify(file('a.webp', 'image/webp'))).toBe('image');
  });

  it('never treats an SVG as an image', () => {
    expect(classify(file('logo.svg', 'image/svg+xml'))).toBe('file');
  });

  it('treats an empty or unknown MIME as a file', () => {
    expect(classify(file('mystery', ''))).toBe('file');
    expect(classify(file('archive.zip', 'application/zip'))).toBe('file');
  });
});

describe('gifBlobType', () => {
  it('maps each proxied content type to its mime and extension', () => {
    expect(gifBlobType('image/gif', 'image')).toEqual({ mime: 'image/gif', extension: 'gif' });
    expect(gifBlobType('image/webp', 'image')).toEqual({ mime: 'image/webp', extension: 'webp' });
    expect(gifBlobType('video/mp4', 'video')).toEqual({ mime: 'video/mp4', extension: 'mp4' });
    expect(gifBlobType('video/webm', 'video')).toEqual({ mime: 'video/webm', extension: 'webm' });
  });

  it('prefers the blob type over the search result kind', () => {
    expect(gifBlobType('video/webm', 'image')).toEqual({ mime: 'video/webm', extension: 'webm' });
  });

  it('falls back to the kind for unexpected types', () => {
    expect(gifBlobType('', 'video')).toEqual({ mime: 'video/mp4', extension: 'mp4' });
    expect(gifBlobType('image/svg+xml', 'image')).toEqual({
      mime: 'image/gif',
      extension: 'gif',
    });
  });
});

describe('cleanFilename', () => {
  it('strips the directory parts on both separators', () => {
    expect(cleanFilename('/tmp/photos/a.png')).toBe('a.png');
    expect(cleanFilename('C:\\Users\\ana\\a.png')).toBe('a.png');
  });

  it('removes control characters and trims', () => {
    expect(cleanFilename('  a\u0000b\u007f.png  ')).toBe('ab.png');
  });

  it('caps the name at 255 characters', () => {
    expect(cleanFilename(`${'a'.repeat(300)}.png`)).toHaveLength(255);
  });

  it('falls back to a default for an empty name', () => {
    expect(cleanFilename('')).toBe('file');
    expect(cleanFilename('/')).toBe('file');
  });
});

describe('formatFileSize', () => {
  it('formats bytes, kilobytes and megabytes', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(2_411_724)).toBe('2.3 MB');
    expect(formatFileSize(15 * 1024 * 1024)).toBe('15 MB');
  });
});

describe('safeHttpUrl', () => {
  it('keeps http and https and drops every other scheme', () => {
    expect(safeHttpUrl('https://x.test/a.png')).toBe('https://x.test/a.png');
    expect(safeHttpUrl('http://x.test/a.png')).toBe('http://x.test/a.png');
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('data:image/png;base64,AAAA')).toBeUndefined();
    expect(safeHttpUrl('not a url')).toBeUndefined();
  });
});

function slot(): UploadSlot {
  return {
    putUrl: 'http://upload.zilar.test/put/1',
    getUrl: 'http://upload.zilar.test/get/1/photo.png',
    headers: { 'x-slot-token': 't0ken' },
  };
}

describe('uploadAttachment', () => {
  it('requests a slot and PUTs the bytes with the slot headers', async () => {
    const requester: UploadSlotRequester = { requestUploadSlot: vi.fn(async () => slot()) };
    const fetchFn = vi.fn(async () => new Response(null, { status: 201 }));
    const attachment = file('/tmp/holiday.png', 'image/png', 9);

    const url = await uploadAttachment(requester, attachment, fetchFn as unknown as typeof fetch);

    expect(url).toBe(slot().getUrl);
    expect(requester.requestUploadSlot).toHaveBeenCalledWith({
      filename: 'holiday.png',
      size: 9,
      contentType: 'image/png',
    });
    expect(fetchFn).toHaveBeenCalledWith(
      slot().putUrl,
      expect.objectContaining({
        method: 'PUT',
        body: attachment,
        headers: expect.objectContaining({ 'content-type': 'image/png', 'x-slot-token': 't0ken' }),
      }),
    );
  });

  it('sends an empty MIME as octet-stream', async () => {
    const requester: UploadSlotRequester = { requestUploadSlot: vi.fn(async () => slot()) };
    const fetchFn = vi.fn(async () => new Response(null, { status: 201 }));

    await uploadAttachment(requester, file('mystery', ''), fetchFn as unknown as typeof fetch);

    expect(requester.requestUploadSlot).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'application/octet-stream' }),
    );
  });

  it('refuses a file over the cap before asking for a slot', async () => {
    const requester: UploadSlotRequester = { requestUploadSlot: vi.fn(async () => slot()) };
    const oversized = { name: 'big.bin', size: MAX_ATTACHMENT_BYTES + 1, type: 'application/zip' };
    const fetchFn = vi.fn();

    const error = await uploadAttachment(
      requester,
      oversized as unknown as File,
      fetchFn as unknown as typeof fetch,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AttachmentError);
    expect((error as AttachmentError).code).toBe('too_large');
    expect(requester.requestUploadSlot).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses an empty file before asking for a slot', async () => {
    const requester: UploadSlotRequester = { requestUploadSlot: vi.fn(async () => slot()) };

    await expect(uploadAttachment(requester, file('empty', 'image/png', 0))).rejects.toMatchObject({
      code: 'empty_file',
    });
    expect(requester.requestUploadSlot).not.toHaveBeenCalled();
  });

  it('reports a refused PUT', async () => {
    const requester: UploadSlotRequester = { requestUploadSlot: vi.fn(async () => slot()) };
    const fetchFn = vi.fn(async () => new Response(null, { status: 500 }));

    await expect(
      uploadAttachment(requester, file('a.png', 'image/png'), fetchFn as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: 'upload_failed' });
  });

  it('reports an unreachable PUT', async () => {
    const requester: UploadSlotRequester = { requestUploadSlot: vi.fn(async () => slot()) };
    const fetchFn = vi.fn(async () => {
      throw new TypeError('network down');
    });

    await expect(
      uploadAttachment(requester, file('a.png', 'image/png'), fetchFn as unknown as typeof fetch),
    ).rejects.toMatchObject({ code: 'upload_failed' });
  });
});

describe('readImageSize', () => {
  it('returns the natural size and revokes the object URL', async () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:fake', revokeObjectURL: revoke });
    class LoadingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 1280;
      naturalHeight = 720;
      set src(value: string) {
        void value;
        this.onload?.();
      }
      get src(): string {
        return '';
      }
    }
    vi.stubGlobal('Image', LoadingImage);

    const size = await readImageSize(file('a.png', 'image/png'));

    expect(size).toEqual({ width: 1280, height: 720 });
    expect(revoke).toHaveBeenCalledWith('blob:fake');
  });

  it('omits the size when the image cannot be decoded', async () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:fake', revokeObjectURL: revoke });
    class BrokenImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(value: string) {
        void value;
        this.onerror?.();
      }
      get src(): string {
        return '';
      }
    }
    vi.stubGlobal('Image', BrokenImage);

    await expect(readImageSize(file('a.png', 'image/png'))).resolves.toBeUndefined();
    expect(revoke).toHaveBeenCalledWith('blob:fake');
  });

  it('omits the size when object URLs are unavailable', async () => {
    vi.stubGlobal('URL', {});

    await expect(readImageSize(file('a.png', 'image/png'))).resolves.toBeUndefined();
  });
});

describe('trustedMediaHosts', () => {
  it('includes the service hostname, the domain, and the upload subdomain', () => {
    const hosts = trustedMediaHosts({ service: 'ws://xmpp.zilar.test/ws', domain: 'zilar.test' });
    expect([...hosts].sort()).toEqual(['zilar.test', 'upload.zilar.test', 'xmpp.zilar.test']);
  });

  it('drops a malformed service URL but still trusts the domain', () => {
    const hosts = trustedMediaHosts({ service: 'not a url', domain: 'zilar.test' });
    expect([...hosts].sort()).toEqual(['zilar.test', 'upload.zilar.test']);
  });

  it('lowercases the hostnames', () => {
    const hosts = trustedMediaHosts({
      service: 'wss://XMPP.Zilar.Test/ws',
      domain: 'Zilar.Test',
    });
    expect(hosts.has('xmpp.zilar.test')).toBe(true);
    expect(hosts.has('zilar.test')).toBe(true);
    expect(hosts.has('upload.zilar.test')).toBe(true);
  });
});

describe('isTrustedMediaUrl', () => {
  const trusted = trustedMediaHosts({
    service: 'wss://xmpp.zilar.test/ws',
    domain: 'zilar.test',
  });

  it('accepts the service hostname on any port, with either http scheme', () => {
    expect(isTrustedMediaUrl('https://xmpp.zilar.test/upload/abc.png', trusted)).toBe(true);
    expect(isTrustedMediaUrl('http://xmpp.zilar.test:5280/upload/abc.png', trusted)).toBe(true);
  });

  it('does not accept the service hostname on a non-http scheme', () => {
    expect(isTrustedMediaUrl('wss://xmpp.zilar.test:443/path', trusted)).toBe(false);
  });

  it('accepts the domain and the upload subdomain', () => {
    expect(isTrustedMediaUrl('https://zilar.test/upload/abc.png', trusted)).toBe(true);
    expect(isTrustedMediaUrl('https://upload.zilar.test/upload/abc.png', trusted)).toBe(true);
  });

  it('rejects unrelated hosts', () => {
    expect(isTrustedMediaUrl('https://tracker.example.com/pixel.png', trusted)).toBe(false);
  });

  it('rejects look-alike hosts that share a suffix or prefix', () => {
    expect(isTrustedMediaUrl('https://zilar.test.evil.example/pixel.png', trusted)).toBe(false);
    expect(isTrustedMediaUrl('https://evil-zilar.test/pixel.png', trusted)).toBe(false);
    expect(isTrustedMediaUrl('https://evilzilar.test/pixel.png', trusted)).toBe(false);
  });

  it('rejects URLs that put the trusted host into userinfo', () => {
    expect(isTrustedMediaUrl('http://zilar.test@evil.example/x.png', trusted)).toBe(false);
    expect(isTrustedMediaUrl('http://xmpp.zilar.test:80@evil.example/x.png', trusted)).toBe(false);
  });

  it('rejects javascript:, data:, and other non-http schemes', () => {
    expect(isTrustedMediaUrl('javascript:alert(1)', trusted)).toBe(false);
    expect(isTrustedMediaUrl('data:image/png;base64,AAAA', trusted)).toBe(false);
    expect(isTrustedMediaUrl('ws://xmpp.zilar.test/path', trusted)).toBe(false);
  });

  it('rejects relative URLs and garbage', () => {
    expect(isTrustedMediaUrl('/upload/abc.png', trusted)).toBe(false);
    expect(isTrustedMediaUrl('not a url', trusted)).toBe(false);
    expect(isTrustedMediaUrl('', trusted)).toBe(false);
  });

  it('is case-insensitive on the hostname', () => {
    expect(isTrustedMediaUrl('https://Zilar.Test/upload/abc.png', trusted)).toBe(true);
    expect(isTrustedMediaUrl('HTTPS://UPLOAD.ZILAR.TEST/abc.png', trusted)).toBe(true);
  });
});
