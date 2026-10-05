import { describe, expect, it } from 'vitest';
import { isBigEmoji } from './emoji';

describe('isBigEmoji', () => {
  it('accepts one, two and three emoji', () => {
    expect(isBigEmoji('🎉')).toBe(true);
    expect(isBigEmoji('😂😂')).toBe(true);
    expect(isBigEmoji('❤️🔥🍻')).toBe(true);
  });

  it('rejects four emoji', () => {
    expect(isBigEmoji('😂😂😂😂')).toBe(false);
  });

  it('rejects emoji mixed with text or digits', () => {
    expect(isBigEmoji('hi 😀')).toBe(false);
    expect(isBigEmoji('😀 hi')).toBe(false);
    expect(isBigEmoji('12')).toBe(false);
    expect(isBigEmoji('😀1')).toBe(false);
    expect(isBigEmoji('1️⃣')).toBe(false);
  });

  it('counts a flag as one grapheme', () => {
    expect(isBigEmoji('🇪🇸')).toBe(true);
    expect(isBigEmoji('🇪🇸🇪🇸🇪🇸')).toBe(true);
    expect(isBigEmoji('🇪🇸🇪🇸🇪🇸🇪🇸')).toBe(false);
  });

  it('counts a ZWJ family as one grapheme', () => {
    expect(isBigEmoji('👨‍👩‍👧')).toBe(true);
    expect(isBigEmoji('👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧')).toBe(true);
    expect(isBigEmoji('👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧')).toBe(false);
  });

  it('rejects empty and whitespace-only text', () => {
    expect(isBigEmoji('')).toBe(false);
    expect(isBigEmoji('   ')).toBe(false);
  });
});
