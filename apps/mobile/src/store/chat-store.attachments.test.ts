import { describe, expect, it } from 'vitest';

import type { PickedFile } from '../lib/attachment-ports';
import { createChatStore } from './chat-store';

const PHOTO: PickedFile = {
  uri: 'file:///cache/photo.jpg',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: 240_000,
  width: 1200,
  height: 800,
};

const PDF: PickedFile = {
  uri: 'file:///cache/tickets.pdf',
  name: 'tickets.pdf',
  mimeType: 'application/pdf',
  size: 2_411_724,
};

describe('mock store sends attachments (T-0150)', () => {
  it('sends a photo optimistically with the attachment payload and a caption', () => {
    const store = createChatStore();
    store.getState().sendAttachment('ana', PHOTO, { caption: 'Stage!' });

    const sent = store.getState().messages('ana').at(-1);
    expect(sent?.attachment).toEqual({
      kind: 'image',
      url: expect.stringContaining('mock://attachments/'),
      name: 'photo.jpg',
      size: 240_000,
      mime: 'image/jpeg',
      width: 1200,
      height: 800,
    });
    expect(sent?.text).toBe('Stage!');
    expect(sent?.status).toBe('sending');
  });

  it('sends a file without dimensions and without a caption', () => {
    const store = createChatStore();
    store.getState().sendAttachment('ana', PDF);

    const sent = store.getState().messages('ana').at(-1);
    expect(sent?.attachment).toMatchObject({ kind: 'file', name: 'tickets.pdf' });
    expect(sent?.attachment).not.toHaveProperty('width');
    expect(sent?.text).toBeUndefined();
  });

  it('refuses an empty or oversized file with a visible error and no bubble', () => {
    const store = createChatStore();
    const before = store.getState().messages('ana').length;

    store.getState().sendAttachment('ana', { ...PHOTO, size: 0 });
    expect(store.getState().messages('ana')).toHaveLength(before);
    expect(store.getState().actionError).toEqual({
      chatId: 'ana',
      message: 'That file is empty.',
    });

    store.getState().sendAttachment('ana', { ...PHOTO, size: 60 * 1024 * 1024 });
    expect(store.getState().messages('ana')).toHaveLength(before);
    expect(store.getState().actionError).toEqual({
      chatId: 'ana',
      message: 'That file is larger than 50 MB.',
    });
  });

  it('sends an unknown-size file instead of refusing it as empty', () => {
    // Finding 2: only a REAL zero says "That file is empty."
    const store = createChatStore();
    const { size: _dropped, ...unknownSize } = PHOTO;
    const before = store.getState().messages('ana').length;

    store.getState().sendAttachment('ana', unknownSize);
    expect(store.getState().messages('ana')).toHaveLength(before + 1);
    expect(store.getState().actionError).toBeUndefined();
    expect(store.getState().messages('ana').at(-1)?.status).toBe('sending');
  });

  it('clears a stale error banner on a later validated send', () => {
    const store = createChatStore();
    store.getState().sendAttachment('ana', { ...PHOTO, size: 0 });
    expect(store.getState().actionError).toBeDefined();

    store.getState().sendAttachment('ana', PHOTO);
    expect(store.getState().actionError).toBeUndefined();
  });

  it('retries a failed attachment by resending it', () => {
    const store = createChatStore();
    store.getState().sendAttachment('ana', PHOTO);
    const id = store.getState().messages('ana').at(-1)?.id ?? '';
    store.getState().retryAttachment('ana', id);
    expect(
      store
        .getState()
        .messages('ana')
        .find((item) => item.id === id)?.status,
    ).toBe('sending');
  });

  it('keeps a gradient demo image URL so the bubble renders the tile', () => {
    const store = createChatStore();
    store.getState().sendAttachment('ana', { ...PHOTO, uri: 'gradient:sunset' });
    expect(store.getState().messages('ana').at(-1)?.attachment?.url).toBe('gradient:sunset');
  });

  it('cancels a sending attachment by removing the bubble', () => {
    const store = createChatStore();
    store.getState().sendAttachment('ana', PHOTO);
    const id = store.getState().messages('ana').at(-1)?.id ?? '';
    store.getState().cancelAttachment('ana', id);
    expect(
      store
        .getState()
        .messages('ana')
        .find((item) => item.id === id),
    ).toBeUndefined();
  });

  it('ignores unknown chats', () => {
    const store = createChatStore();
    const before = store.getState().messages('ana').length;
    store.getState().sendAttachment('nope', PHOTO);
    expect(store.getState().messages('ana')).toHaveLength(before);
  });
});
