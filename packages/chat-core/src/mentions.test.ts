import { describe, expect, it } from 'vitest';
import {
  filterMentionMembers,
  findMentionQuery,
  insertMention,
  isMentionOfMe,
  mentionsForTrimmedText,
  rebaseMentions,
  splitMentions,
} from './mentions';
import type { MentionMember, UiMention } from './types';

const ana: MentionMember = { jid: 'u-ana@galena.test', name: 'Ana' };

function mention(jid: string, name: string, begin: number, end: number): UiMention {
  return { jid, name, begin, end };
}

describe('findMentionQuery', () => {
  it.each([
    ['hello @an', 9, { start: 6, query: 'an' }],
    ['@', 1, { start: 0, query: '' }],
    ['hey @', 5, { start: 4, query: '' }],
    ['@a @b', 5, { start: 3, query: 'b' }],
    ['a\n@b', 4, { start: 2, query: 'b' }],
    ['@ana', 0, undefined],
    ['a @ b', 5, undefined],
    ['email@foo', 9, undefined],
    ['hello', 5, undefined],
  ])('%j at %i', (text, caret, expected) => {
    expect(findMentionQuery(text, caret)).toEqual(expected);
  });

  it('clamps a caret beyond the text', () => {
    expect(findMentionQuery('hi @an', 99)).toEqual({ start: 3, query: 'an' });
  });
});

describe('insertMention', () => {
  it('replaces the query with the name and a trailing space', () => {
    expect(insertMention('hello @an', 9, ana)).toEqual({
      text: 'hello @Ana ',
      caret: 11,
      mention: { jid: 'u-ana@galena.test', name: 'Ana', begin: 6, end: 10 },
    });
  });

  it('keeps the text that follows the caret', () => {
    const result = insertMention('hi @a there', 5, ana);
    expect(result?.text).toBe('hi @Ana  there');
    expect(result?.caret).toBe(8);
  });

  it('returns undefined when the caret is not in a query', () => {
    expect(insertMention('hello', 5, ana)).toBeUndefined();
  });
});

describe('rebaseMentions', () => {
  it('keeps a mention entirely before the edit', () => {
    const prev = '@Ana hi';
    const next = '@Ana hii';
    expect(rebaseMentions(prev, next, [mention('a', 'Ana', 0, 4)])).toEqual([
      mention('a', 'Ana', 0, 4),
    ]);
  });

  it('shifts a mention entirely after an insertion', () => {
    const prev = 'hi @Ana';
    const next = 'hi X@Ana';
    expect(rebaseMentions(prev, next, [mention('a', 'Ana', 3, 7)])).toEqual([
      mention('a', 'Ana', 4, 8),
    ]);
  });

  it('shifts a mention after a deletion', () => {
    const prev = 'hi @Ana';
    const next = 'h @Ana';
    expect(rebaseMentions(prev, next, [mention('a', 'Ana', 3, 7)])).toEqual([
      mention('a', 'Ana', 2, 6),
    ]);
  });

  it('drops a mention the edit touches', () => {
    const prev = '@Ana hi';
    const next = '@AnXa hi';
    expect(rebaseMentions(prev, next, [mention('a', 'Ana', 0, 4)])).toEqual([]);
  });

  it('drops a mention when its whole token is deleted', () => {
    const prev = 'hi @Ana';
    const next = 'hi ';
    expect(rebaseMentions(prev, next, [mention('a', 'Ana', 3, 7)])).toEqual([]);
  });

  it('drops a shifted mention that would fall outside the new text', () => {
    const prev = 'hi @Ana';
    const next = 'hi @A';
    expect(rebaseMentions(prev, next, [mention('a', 'Ana', 3, 7)])).toEqual([]);
  });
});

describe('splitMentions', () => {
  it('returns plain text when there are no mentions', () => {
    expect(splitMentions('hello', [])).toEqual([{ kind: 'text', text: 'hello' }]);
  });

  it('splits text around mentions', () => {
    const segments = splitMentions('hi @Ana and @Luis', [
      mention('a', 'Ana', 3, 7),
      mention('l', 'Luis', 12, 17),
    ]);
    expect(segments).toEqual([
      { kind: 'text', text: 'hi ' },
      { kind: 'mention', text: '@Ana', jid: 'a', name: 'Ana' },
      { kind: 'text', text: ' and ' },
      { kind: 'mention', text: '@Luis', jid: 'l', name: 'Luis' },
    ]);
  });

  it('keeps an emoji before the mention in the text segment', () => {
    const segments = splitMentions('😀 @Ana', [mention('a', 'Ana', 3, 7)]);
    expect(segments).toEqual([
      { kind: 'text', text: '😀 ' },
      { kind: 'mention', text: '@Ana', jid: 'a', name: 'Ana' },
    ]);
  });

  it('ignores out-of-range and overlapping mentions', () => {
    const segments = splitMentions('hi @Ana', [
      mention('x', 'X', 0, 99),
      mention('a', 'Ana', 3, 7),
      mention('b', 'B', 4, 8),
    ]);
    expect(segments).toEqual([
      { kind: 'text', text: 'hi ' },
      { kind: 'mention', text: '@Ana', jid: 'a', name: 'Ana' },
    ]);
  });
});

describe('filterMentionMembers', () => {
  const members: MentionMember[] = [
    { jid: 'u-ana@galena.test', name: 'Ana' },
    { jid: 'u-sofia@galena.test', name: 'Sofía' },
    { jid: 'ai-dev-1@galena.test', name: 'Dev-1' },
  ];

  it('returns everyone for an empty query', () => {
    expect(filterMentionMembers(members, '')).toEqual(members);
  });

  it('matches case-insensitively', () => {
    expect(filterMentionMembers(members, 'an')).toEqual([members[0]]);
  });

  it('matches without accents', () => {
    expect(filterMentionMembers(members, 'sofia')).toEqual([members[1]]);
  });

  it('returns nothing when no name matches', () => {
    expect(filterMentionMembers(members, 'zzz')).toEqual([]);
  });
});

describe('isMentionOfMe', () => {
  it('matches by localpart', () => {
    expect(isMentionOfMe('u-you@galena.test', 'u-you')).toBe(true);
    expect(isMentionOfMe('u-ana@galena.test', 'u-you')).toBe(false);
  });

  it('matches by the full bare JID when given', () => {
    expect(isMentionOfMe('me@galena.test', 'u-me', 'me@galena.test')).toBe(true);
  });

  it('ignores the resource', () => {
    expect(isMentionOfMe('u-you@galena.test/phone', 'u-you')).toBe(true);
  });
});

describe('mentionsForTrimmedText', () => {
  it('shifts a mention left by the leading whitespace', () => {
    expect(mentionsForTrimmedText(' @Ana hi', '@Ana hi', [mention('a', 'Ana', 1, 5)])).toEqual([
      mention('a', 'Ana', 0, 4),
    ]);
  });

  it('keeps a mention that still fits after trailing whitespace is trimmed', () => {
    expect(mentionsForTrimmedText('hi @Ana  ', 'hi @Ana', [mention('a', 'Ana', 3, 7)])).toEqual([
      mention('a', 'Ana', 3, 7),
    ]);
  });

  it('drops a mention that no longer fits the trimmed text', () => {
    expect(mentionsForTrimmedText('hi @Ana', 'hi', [mention('a', 'Ana', 3, 7)])).toEqual([]);
  });
});
