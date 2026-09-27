import { describe, expect, it } from 'vitest';

import { previewParts, previewText } from './preview';
import type { UiMessage } from './types';

const VOICE = {
  duration_ms: 12_400,
  mime: 'audio/ogg; codecs=opus',
  waveform: [10, 200, 40],
};

function message(overrides: Partial<UiMessage>): UiMessage {
  return {
    id: 'm1',
    chatId: 'chat',
    senderId: 'ana',
    senderName: 'Ana',
    text: 'ok!',
    createdAt: new Date(2026, 8, 27, 12, 0).toISOString(),
    status: 'read',
    ...overrides,
  };
}

const OPTIONS = { isGroup: false, currentUserId: 'me' };

describe('previewParts', () => {
  it('returns nothing for a missing message', () => {
    expect(previewParts(undefined, OPTIONS)).toEqual({ body: '' });
  });

  it('adds the sender first name in groups', () => {
    expect(
      previewParts(message({ senderName: 'Ana Ruiz' }), { ...OPTIONS, isGroup: true }),
    ).toEqual({
      prefix: 'Ana:',
      body: 'ok!',
    });
  });

  it('adds no prefix in a DM', () => {
    expect(previewParts(message({}), OPTIONS)).toEqual({ body: 'ok!' });
  });

  it('prefixes your own messages with You:', () => {
    expect(previewParts(message({ senderId: 'me', senderName: 'You' }), OPTIONS)).toEqual({
      prefix: 'You:',
      body: 'ok!',
    });
    expect(
      previewParts(message({ senderId: 'me', senderName: 'You' }), { ...OPTIONS, isGroup: true }),
    ).toEqual({ prefix: 'You:', body: 'ok!' });
  });

  it('renders voice messages', () => {
    expect(
      previewParts(message({ text: undefined, voice: VOICE }), { ...OPTIONS, isGroup: true }),
    ).toEqual({ prefix: 'Ana:', body: '🎤 Voice message (0:12)' });
  });

  it('renders photos without a caption', () => {
    expect(
      previewParts(
        message({ text: undefined, image: { url: 'gradient:sunset', width: 1, height: 1 } }),
        OPTIONS,
      ),
    ).toEqual({ body: '🖼 Photo' });
  });

  it('prefers the caption when an image has text', () => {
    expect(
      previewParts(
        message({
          text: 'Look at this',
          image: { url: 'gradient:sunset', width: 1, height: 1 },
        }),
        OPTIONS,
      ),
    ).toEqual({ body: 'Look at this' });
  });

  it('falls back to the card stage', () => {
    expect(
      previewParts(
        message({
          text: undefined,
          card: { v: 0, type: 'progress', data: { ai: 'ai@galena.chat', stage: 'Running tests' } },
        }),
        OPTIONS,
      ),
    ).toEqual({ body: 'Running tests' });
  });
});

describe('previewText', () => {
  it('joins the prefix and the body', () => {
    expect(previewText(message({}), { ...OPTIONS, isGroup: true })).toBe('Ana: ok!');
    expect(previewText(message({ senderId: 'me', senderName: 'You' }), OPTIONS)).toBe('You: ok!');
    expect(previewText(undefined, OPTIONS)).toBe('');
  });
});
