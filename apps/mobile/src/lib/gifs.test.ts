import { describe, expect, it } from 'vitest';

import {
  GIF_ATTRIBUTION,
  gifBlobType,
  gifFileName,
  gifsAvailability,
  isGifMediaType,
  isLoadableGifPreviewUrl,
  resetGifsAvailability,
  setGifsAvailability,
} from './gifs';

describe('gif helpers (T-0148)', () => {
  it('maps the four proxied content types to mime and extension', () => {
    expect(gifBlobType('image/gif', 'image')).toEqual({ mime: 'image/gif', extension: 'gif' });
    expect(gifBlobType('image/webp', 'image')).toEqual({ mime: 'image/webp', extension: 'webp' });
    expect(gifBlobType('video/mp4', 'video')).toEqual({ mime: 'video/mp4', extension: 'mp4' });
    expect(gifBlobType('video/webm', 'video')).toEqual({ mime: 'video/webm', extension: 'webm' });
  });

  it('falls back to the result kind for unexpected types (mock art)', () => {
    expect(gifBlobType('image/svg+xml', 'image')).toEqual({
      mime: 'image/gif',
      extension: 'gif',
    });
    expect(gifBlobType('', 'video')).toEqual({ mime: 'video/mp4', extension: 'mp4' });
  });

  it('accepts only the four proxy content types', () => {
    for (const type of ['image/gif', 'image/webp', 'video/mp4', 'video/webm']) {
      expect(isGifMediaType(type)).toBe(true);
    }
    for (const type of ['', 'image/svg+xml', 'image/png', 'application/pdf', 'text/html']) {
      expect(isGifMediaType(type)).toBe(false);
    }
  });

  it('names sent files in the gif-<id>.<ext> shape the renderer matches', () => {
    expect(gifFileName('mock-gif-1', 'gif')).toBe('gif-mock-gif-1.gif');
    expect(gifFileName('0123456789abcdef-extra', 'mp4')).toBe('gif-0123456789abcdef.mp4');
  });

  it('caches the availability probe answer until reset', () => {
    resetGifsAvailability();
    expect(gifsAvailability()).toBeUndefined();
    setGifsAvailability(false);
    expect(gifsAvailability()).toBe(false);
    setGifsAvailability(true);
    expect(gifsAvailability()).toBe(true);
    resetGifsAvailability();
    expect(gifsAvailability()).toBeUndefined();
  });

  it('auto-loads only same-origin proxy paths, never provider or data URLs', () => {
    expect(isLoadableGifPreviewUrl('/api/gifs/media/abc123', 'http://127.0.0.1:3188')).toBe(true);
    expect(
      isLoadableGifPreviewUrl(
        'http://127.0.0.1:3188/api/gifs/media/abc123',
        'http://127.0.0.1:3188',
      ),
    ).toBe(true);
    expect(
      isLoadableGifPreviewUrl('https://evil.test/api/gifs/media/abc123', 'http://127.0.0.1:3188'),
    ).toBe(false);
    expect(
      isLoadableGifPreviewUrl('https://media.giphy.com/media/x/giphy.gif', 'http://127.0.0.1:3188'),
    ).toBe(false);
    expect(isLoadableGifPreviewUrl('data:image/svg+xml,abc', 'http://127.0.0.1:3188')).toBe(false);
    expect(isLoadableGifPreviewUrl('', 'http://127.0.0.1:3188')).toBe(false);
    expect(isLoadableGifPreviewUrl('javascript:alert(1)', 'http://127.0.0.1:3188')).toBe(false);
  });

  it('carries the provider attribution', () => {
    expect(GIF_ATTRIBUTION).toBe('Powered by Giphy');
  });
});
