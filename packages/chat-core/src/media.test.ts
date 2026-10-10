import { describe, expect, it } from 'vitest';
import { cleanFilename, formatFileSize, gifBlobType, sanitizeIncomingAttachment } from './media';
import { commonPrefixLength, safeCut } from './smooth-text';
import { fitStickerSize } from './stickers';

const token = { service: 'wss://xmpp.example.com/ws', domain: 'example.com' };

describe('media helpers', () => {
  it('cleans file names and formats sizes', () => {
    expect(cleanFilename('a/b\\c\u0001.png ')).toBe('c.png');
    expect(cleanFilename('  ')).toBe('file');
    expect(formatFileSize(2.4 * 1024 * 1024)).toBe('2.4 MB');
    expect(formatFileSize(-1)).toBe('');
  });

  it('falls back by kind for an unknown GIF blob type', () => {
    expect(gifBlobType('video/webm', 'image')).toEqual({ mime: 'video/webm', extension: 'webm' });
    expect(gifBlobType('text/plain', 'video')).toEqual({ mime: 'video/mp4', extension: 'mp4' });
  });

  it('downgrades an image on an untrusted host and keeps a trusted one', () => {
    const image = {
      kind: 'image' as const,
      url: 'https://evil.test/x.png',
      name: 'gif-x.gif',
      size: 1,
      mime: 'image/gif',
      width: 1,
      height: 1,
    };
    expect(sanitizeIncomingAttachment(image, token)).toEqual({
      kind: 'file',
      url: image.url,
      name: 'x.gif',
      size: 1,
      mime: 'image/gif',
    });
    const trusted = { ...image, url: 'https://upload.example.com/x.png' };
    expect(sanitizeIncomingAttachment(trusted, token)).toBe(trusted);
  });
});

describe('smooth text and sticker helpers', () => {
  it('finds prefixes and avoids splitting a surrogate pair', () => {
    expect(commonPrefixLength('abcd', 'abxy')).toBe(2);
    expect(safeCut('a👋', 2)).toBe(3);
  });

  it('fits a sticker inside 512', () => {
    expect(fitStickerSize(1024, 512)).toEqual({ width: 512, height: 256 });
    expect(fitStickerSize(100, 50)).toEqual({ width: 100, height: 50 });
  });
});
