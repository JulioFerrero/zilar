import { describe, expect, it } from 'vitest';
import { decodePayload, encodePayload } from './payload';
import { StickerSchema, type Sticker } from './sticker';

const validSticker: Sticker = {
  pack_id: '123e4567-e89b-12d3-a456-426614174000',
  sticker_id: '223e4567-e89b-12d3-a456-426614174001',
  url: 'http://localhost:3000/api/stickers/223e4567-e89b-12d3-a456-426614174001/file',
  emoji: '👍',
  width: 512,
  height: 512,
  mime: 'image/webp',
};

describe('StickerSchema', () => {
  it('accepts a valid sticker', () => {
    expect(StickerSchema.safeParse(validSticker).success).toBe(true);
  });

  it('accepts a sticker without an emoji', () => {
    const { emoji: _emoji, ...rest } = validSticker;
    expect(StickerSchema.safeParse(rest).success).toBe(true);
  });

  it('accepts image/png', () => {
    expect(StickerSchema.safeParse({ ...validSticker, mime: 'image/png' }).success).toBe(true);
  });

  it('rejects image/gif', () => {
    expect(StickerSchema.safeParse({ ...validSticker, mime: 'image/gif' }).success).toBe(false);
  });

  it('rejects image/svg+xml', () => {
    expect(StickerSchema.safeParse({ ...validSticker, mime: 'image/svg+xml' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(StickerSchema.safeParse({ ...validSticker, padding: 'x'.repeat(100) }).success).toBe(
      false,
    );
  });

  it('rejects a non-/api/stickers/ relative url', () => {
    expect(StickerSchema.safeParse({ ...validSticker, url: '/evil/track.png' }).success).toBe(
      false,
    );
  });

  it('rejects data: and javascript: urls', () => {
    expect(
      StickerSchema.safeParse({ ...validSticker, url: 'data:image/png;base64,AAA' }).success,
    ).toBe(false);
    expect(StickerSchema.safeParse({ ...validSticker, url: 'javascript:alert(1)' }).success).toBe(
      false,
    );
  });

  it('rejects an oversized url', () => {
    const base = 'http://localhost:3000/api/stickers/';
    const url = `${base}${'a'.repeat(2048 - base.length + 1)}`;
    expect(StickerSchema.safeParse({ ...validSticker, url }).success).toBe(false);
  });

  it('rejects an emoji longer than 8 characters', () => {
    expect(StickerSchema.safeParse({ ...validSticker, emoji: '012345678' }).success).toBe(false);
  });

  it('rejects zero and oversized dimensions', () => {
    for (const size of [0, 513, -1]) {
      expect(StickerSchema.safeParse({ ...validSticker, width: size }).success).toBe(false);
      expect(StickerSchema.safeParse({ ...validSticker, height: size }).success).toBe(false);
    }
  });

  it('rejects a non-uuid pack or sticker id', () => {
    expect(StickerSchema.safeParse({ ...validSticker, pack_id: 'nope' }).success).toBe(false);
    expect(StickerSchema.safeParse({ ...validSticker, sticker_id: 'nope' }).success).toBe(false);
  });
});

describe('sticker payload envelope', () => {
  it('round-trips a sticker payload', () => {
    const payload = { v: 0, type: 'sticker', data: validSticker } as const;
    expect(decodePayload(encodePayload(payload))).toEqual({ ok: true, payload });
  });

  it('round-trips a server-issued relative sticker url (must-fix: encodePayload threw)', () => {
    // The server API returns `/api/stickers/<id>/file`; the client sends that
    // value back verbatim, so the schema must accept it — `z.url()` rejected
    // it and every real sticker send threw inside `encodePayload`.
    const payload = {
      v: 0,
      type: 'sticker',
      data: { ...validSticker, url: '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file' },
    } as const;
    expect(decodePayload(encodePayload(payload))).toEqual({ ok: true, payload });
  });

  it('rejects a sticker payload with unknown keys in data', () => {
    const raw = JSON.stringify({
      v: 0,
      type: 'sticker',
      data: { ...validSticker, extra: true },
    });
    expect(decodePayload(raw).ok).toBe(false);
  });
});
