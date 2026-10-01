import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { StickerMessage } from './sticker-message';
import type { Sticker } from '@galena/protocol';
import type { UiMessage } from '@galena/chat-core';

vi.mock('react-native', () => ({
  Image: 'Image',
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('@/components/chat/ticks', () => ({
  Ticks: 'Ticks',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/lib/auth', () => ({
  API_URL: 'http://127.0.0.1:3188',
}));

vi.mock('@/lib/session-token', () => ({
  getSessionToken: async () => 'tok',
}));

vi.mock('@/lib/depth', () => ({
  raisedPill: { borderWidth: 1 },
}));

vi.mock('@/lib/utils', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}));

const STICKER: Sticker = {
  pack_id: '11111111-1111-4111-8111-111111111111',
  sticker_id: '223e4567-e89b-12d3-a456-426614174001',
  url: '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file',
  emoji: '🐱',
  width: 200,
  height: 200,
  mime: 'image/png',
};

const MESSAGE: UiMessage = {
  id: 'm1',
  chatId: 'ana',
  senderId: 'ana',
  senderName: 'Ana',
  text: '🐱',
  createdAt: new Date('2026-09-28T12:00:00Z'),
  status: 'read',
};

function stickerHtml(sticker: Sticker): string {
  return renderToStaticMarkup(
    createElement(StickerMessage, {
      sticker,
      message: MESSAGE,
      outgoing: false,
      onLongPress: () => {},
    }),
  );
}

describe('StickerMessage', () => {
  it('loads the same-origin URL as an image with the time pill', () => {
    const html = stickerHtml(STICKER);
    expect(html).toContain('<Image');
    expect(html).toContain('🐱');
  });

  it('shows the emoji tile for a hostile absolute URL, never an image', () => {
    const html = stickerHtml({ ...STICKER, url: 'https://evil.test/x.webp' });
    expect(html).not.toContain('<Image');
    expect(html).toContain('🐱');
  });

  it('shows a placeholder when there is no emoji', () => {
    const html = stickerHtml({
      ...STICKER,
      url: 'https://evil.test/x.webp',
      emoji: undefined,
    });
    expect(html).not.toContain('<Image');
    expect(html).toContain('🙂');
  });

  it('renders the broken fallback tile with the same label as the image', () => {
    const trusted = stickerHtml(STICKER);
    expect(trusted).toContain('<Image');
    expect(trusted).toContain('🐱');
    // `onError` flips `broken`, which swaps the `Image` for the emoji tile
    // below (the same tile a hostile URL shows from the start). State hooks
    // cannot run outside a renderer, so the swap itself needs a device look;
    // this pins the tile the swap lands on.
    const hostile = stickerHtml({ ...STICKER, url: 'https://evil.test/x.webp' });
    expect(hostile).not.toContain('<Image');
    expect(hostile).toContain('🐱');
  });
});
