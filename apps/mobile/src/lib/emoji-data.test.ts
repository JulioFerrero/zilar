import { describe, expect, it } from 'vitest';

import {
  EMOJI_BY_CATEGORY,
  EMOJI_CATEGORIES,
  insertEmojiAtCaret,
  MAX_RECENT_EMOJI,
  readRecentEmoji,
  rememberRecentEmoji,
} from './emoji-data';

describe('emoji-data (T-0175)', () => {
  it('holds about 250 emoji across the nine categories', () => {
    const ids = EMOJI_CATEGORIES.map((category) => category.id);
    expect(ids).toEqual([
      'smileys',
      'people',
      'hearts',
      'animals',
      'food',
      'activities',
      'travel',
      'objects',
      'symbols',
    ]);
    const total = Object.values(EMOJI_BY_CATEGORY).reduce(
      (count, emoji) => count + emoji.length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(240);
    expect(total).toBeLessThanOrEqual(320);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('inserts an emoji at a given caret, replacing any selected range', () => {
    expect(insertEmojiAtCaret('hello', '😀', { start: 5, end: 5 })).toEqual({
      text: 'hello😀',
      caret: 7,
    });
    expect(insertEmojiAtCaret('hello', '😀', { start: 2, end: 2 })).toEqual({
      text: 'he😀llo',
      caret: 4,
    });
    expect(insertEmojiAtCaret('hello world', '😀', { start: 5, end: 11 })).toEqual({
      text: 'hello😀',
      caret: 7,
    });
  });

  it('appends at the end when there is no known selection', () => {
    expect(insertEmojiAtCaret('hi', '❤️', undefined)).toEqual({ text: 'hi❤️', caret: 4 });
  });

  it('clamps out-of-range selections to the text', () => {
    expect(insertEmojiAtCaret('hi', '😀', { start: -9, end: 99 })).toEqual({
      text: '😀',
      caret: 2,
    });
  });

  it('recents deduplicate, keep most-recent-first and cap at 24', () => {
    expect(MAX_RECENT_EMOJI).toBe(24);
    expect(rememberRecentEmoji(['😀', '❤️'], '❤️')).toEqual(['❤️', '😀']);
    const filled = Array.from({ length: 24 }, (_, index) => `e${index}`);
    expect(rememberRecentEmoji(filled, '😀')).toHaveLength(24);
    expect(rememberRecentEmoji(filled, '😀')[0]).toBe('😀');
    expect(rememberRecentEmoji(filled, '😀')).not.toContain('e23');
  });

  it('readRecentEmoji drops hostile data', () => {
    expect(readRecentEmoji(null)).toEqual([]);
    expect(readRecentEmoji('not json')).toEqual([]);
    expect(readRecentEmoji(JSON.stringify({ nope: true }))).toEqual([]);
    expect(readRecentEmoji(JSON.stringify(['😀', 42, '', null]))).toEqual(['😀']);
  });
});
