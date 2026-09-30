import { isSameOriginStickerUrl } from './stickers';
import { describe, expect, it } from 'vitest';

describe('isSameOriginStickerUrl', () => {
  it('allows the same-origin file URL', () => {
    expect(isSameOriginStickerUrl('/api/stickers/abc/file')).toBe(true);
  });

  it('refuses a hostile third-party URL', () => {
    expect(isSameOriginStickerUrl('https://evil.example.com/track.png')).toBe(false);
  });

  it('refuses data: and javascript: URLs', () => {
    expect(isSameOriginStickerUrl('data:image/png;base64,AAA')).toBe(false);
    expect(isSameOriginStickerUrl('javascript:alert(1)')).toBe(false);
  });

  it('refuses garbage', () => {
    expect(isSameOriginStickerUrl('')).toBe(false);
    expect(isSameOriginStickerUrl('::::')).toBe(false);
  });
});
