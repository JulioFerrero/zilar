import { describe, expect, it, vi } from 'vitest';

import { stickerOf } from './payload-card';

vi.mock('react-native', () => ({
  View: 'View',
}));

vi.mock('@/components/chat/approval-card', () => ({
  ApprovalCard: 'ApprovalCard',
}));

vi.mock('@/components/chat/progress-card', () => ({
  ProgressCard: 'ProgressCard',
}));

const STICKER = {
  pack_id: '11111111-1111-4111-8111-111111111111',
  sticker_id: '223e4567-e89b-12d3-a456-426614174001',
  url: '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file',
  emoji: '🐱',
  width: 200,
  height: 200,
  mime: 'image/png' as const,
};

describe('stickerOf', () => {
  it('parses a valid sticker payload', () => {
    expect(stickerOf({ card: { v: 0, type: 'sticker', data: STICKER } })).toEqual(STICKER);
  });

  it('falls back for non-sticker cards and invalid data', () => {
    expect(stickerOf({})).toBeUndefined();
    expect(stickerOf({ card: { v: 0, type: 'progress', data: { stage: 'x' } } })).toBeUndefined();
    // The same-origin gate lives at render (`StickerMessage`), not in the
    // parse: a hostile off-origin URL still parses and renders the emoji
    // tile, never an image. Drifted dimensions and short payloads fall back
    // to the body text.
    expect(
      stickerOf({
        card: { v: 0, type: 'sticker', data: { ...STICKER, url: 'https://evil.test/x.webp' } },
      }),
    ).toBeDefined();
    expect(
      stickerOf({ card: { v: 0, type: 'sticker', data: { ...STICKER, width: 9999 } } }),
    ).toBeUndefined();
    expect(stickerOf({ card: { v: 0, type: 'sticker', data: { pack_id: 'p1' } } })).toBeUndefined();
  });
});
