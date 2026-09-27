import { describe, expect, it } from 'vitest';
import { AVATAR_GRADIENTS, avatarGradient, initials } from './avatar';

describe('avatarGradient', () => {
  it('exposes the seven gradients from the style guide', () => {
    expect(AVATAR_GRADIENTS).toHaveLength(7);
    expect(AVATAR_GRADIENTS[0]).toEqual({ index: 0, from: '#ff885e', to: '#ff516a' });
    expect(AVATAR_GRADIENTS[6]).toEqual({ index: 6, from: '#e0a2f3', to: '#d669ed' });
  });

  it('is deterministic for the same id', () => {
    expect(avatarGradient('c-ana')).toEqual(avatarGradient('c-ana'));
    expect(avatarGradient('')).toEqual(avatarGradient(''));
  });

  it('always returns one of the seven gradients', () => {
    for (const id of ['a', 'b', 'c', 'u-1', 'u-2', 'group:dev', '🍻']) {
      const gradient = avatarGradient(id);
      expect(AVATAR_GRADIENTS).toContainEqual(gradient);
    }
  });
});

describe('initials', () => {
  it('uses the first letter of a single name', () => {
    expect(initials('Ana')).toBe('A');
    expect(initials('ana')).toBe('A');
  });

  it('uses the first letters of the first two words', () => {
    expect(initials('Ana María')).toBe('AM');
    expect(initials('Dev Team')).toBe('DT');
  });

  it('takes the first letter or digit of a word', () => {
    expect(initials('Dev-1')).toBe('D');
  });

  it('ignores extra whitespace', () => {
    expect(initials('  Ana   María  ')).toBe('AM');
  });

  it('returns an empty string for empty names', () => {
    expect(initials('')).toBe('');
    expect(initials('   ')).toBe('');
  });

  it('ignores emoji and symbols', () => {
    expect(initials('Viernes 🍻')).toBe('V');
    expect(initials('🍻 Viernes')).toBe('V');
    expect(initials('Dev Team 🍻')).toBe('DT');
  });

  it('returns an empty string when there is no letter or digit', () => {
    expect(initials('🍻🍻')).toBe('');
    expect(initials('🎉 ✨')).toBe('');
    expect(initials('-_-')).toBe('');
  });
});
