import { describe, expect, it } from 'vitest';

import { AVATAR_GRADIENTS, avatarGradient, initials, senderColor } from './avatar';

describe('initials', () => {
  it('takes the first letter of one word', () => {
    expect(initials('Ana')).toBe('A');
  });

  it('takes two letters from two words', () => {
    expect(initials('Dev AI')).toBe('DA');
  });

  it('skips emoji words', () => {
    expect(initials('Viernes 🍻')).toBe('V');
  });

  it('returns an empty string for an empty name', () => {
    expect(initials('')).toBe('');
    expect(initials('   ')).toBe('');
  });

  it('keeps an emoji-only name', () => {
    expect(initials('🍻')).toBe('🍻');
  });

  it('uppercases accented letters', () => {
    expect(initials('ángel ruiz')).toBe('ÁR');
  });
});

describe('avatarGradient', () => {
  it('is deterministic for the same id', () => {
    expect(avatarGradient('ana')).toEqual(avatarGradient('ana'));
  });

  it('always returns one of the 7 gradients', () => {
    for (const id of ['ana', 'dev-ai', 'viernes', 'family', 'luis', 'x', '']) {
      expect(AVATAR_GRADIENTS).toContainEqual(avatarGradient(id));
    }
  });

  it('spreads ids across the palette', () => {
    const used = new Set(
      Array.from({ length: 60 }, (_, index) => avatarGradient(`user-${index}`)[0]),
    );
    expect(used.size).toBe(AVATAR_GRADIENTS.length);
  });
});

describe('senderColor', () => {
  it('uses the start color of the sender gradient', () => {
    expect(senderColor('ana')).toBe(avatarGradient('ana')[0]);
  });
});
