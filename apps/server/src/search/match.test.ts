import { describe, expect, it } from 'vitest';
import {
  buildTsQuery,
  damerauDistance,
  foldText,
  matchMessageTerms,
  mergeMarks,
  searchTerms,
  splitWords,
  windowSnippet,
} from './match';

describe('searchTerms', () => {
  it('keeps folded words and drops operators and punctuation', () => {
    expect(searchTerms('Hello WORLD')).toEqual(['hello', 'world']);
    expect(searchTerms('café au lait')).toEqual(['cafe', 'au', 'lait']);
    expect(searchTerms('!!!')).toEqual([]);
    expect(searchTerms('& | ! ( )')).toEqual([]);
    expect(searchTerms('OR AND NOT')).toEqual(['or', 'and', 'not']);
    expect(searchTerms("l'hôtel")).toEqual(['l', 'hotel']);
  });
});

describe('buildTsQuery', () => {
  it('keeps earlier terms whole and prefixes the last', () => {
    expect(buildTsQuery(['hello'])).toBe('"hello":*');
    expect(buildTsQuery(['concert', 'tick'])).toBe('"concert" & "tick":*');
    expect(buildTsQuery(['and', 'or'])).toBe('"and" & "or":*');
  });
});

describe('foldText', () => {
  it('folds accents and case on both sides', () => {
    expect(foldText('CAFÉ')).toBe('cafe');
    expect(foldText('café')).toBe('cafe');
    expect(foldText('ØRE Ångström')).toBe('ore angstrom');
    expect(foldText('hello')).toBe('hello');
  });
});

describe('damerauDistance', () => {
  it('counts insertion, deletion, substitution and transposition as one', () => {
    expect(damerauDistance('hello', 'heello', 2)).toBe(1);
    expect(damerauDistance('hello', 'helo', 2)).toBe(1);
    expect(damerauDistance('hello', 'hllo', 2)).toBe(1);
    expect(damerauDistance('hello', 'hlelo', 2)).toBe(1);
    expect(damerauDistance('hello', 'yellow', 2)).toBe(2);
    expect(damerauDistance('hello', 'hxllo', 1)).toBe(1);
    expect(damerauDistance('hello', 'yellow', 1)).toBeGreaterThan(1);
  });
});

describe('matchMessageTerms', () => {
  it('matches exact, prefix-last and fuzzy rules', () => {
    expect(matchMessageTerms(['hello'], 'say hello there', false)).not.toBeNull();
    expect(matchMessageTerms(['hel'], 'say hello there', false)).not.toBeNull();
    expect(matchMessageTerms(['hel'], 'say hello there', true)).not.toBeNull();
    expect(matchMessageTerms(['hello'], 'say heello there', false)).toBeNull();
    expect(matchMessageTerms(['hello'], 'say heello there', true)).not.toBeNull();
    expect(matchMessageTerms(['hello'], 'say hlelo there', true)).not.toBeNull();
    // Non-last terms never match by prefix.
    expect(matchMessageTerms(['hel', 'room'], 'say hello room', false)).toBeNull();
    expect(matchMessageTerms(['hello', 'room'], 'say hello to the room', false)).not.toBeNull();
    // yellow is distance 2 from hello: no match.
    expect(matchMessageTerms(['hello'], 'the yellow submarine', true)).toBeNull();
    // Short terms never go fuzzy: exact or prefix only, at any position.
    expect(matchMessageTerms(['zx'], 'the car broke', true)).toBeNull();
    expect(matchMessageTerms(['ca'], 'the car broke', true)).not.toBeNull();
    expect(matchMessageTerms(['car'], 'the car broke', true)).not.toBeNull();
    // A 5-char term does not match at distance 2 ("hello"→"hxxlo" is 2).
    expect(matchMessageTerms(['hello'], 'say hxxlo now', true)).toBeNull();
    expect(matchMessageTerms(['hello'], 'say hxllo now', true)).not.toBeNull();
    // 8+ chars allow distance 2; 7-char terms allow only 1.
    expect(matchMessageTerms(['concerts'], 'a conccrts note', true)).not.toBeNull();
    expect(matchMessageTerms(['concert'], 'a concxxt note', true)).toBeNull();
    // Folded matching on both sides.
    expect(matchMessageTerms(['cafe'], 'visit the café today', false)).not.toBeNull();
    expect(matchMessageTerms(['hello'], 'say HELLO loudly', false)).not.toBeNull();
    expect(matchMessageTerms([], 'anything', true)).toBeNull();
  });

  it('returns code-point spans of the matched words', () => {
    const spans = matchMessageTerms(['hello'], '🎉 say heello 🎉', true);
    expect(spans).toHaveLength(1);
    const [span] = spans ?? [];
    expect([...'🎉 say heello 🎉'].slice(span?.start, span?.end).join('')).toBe('heello');
  });
});

describe('splitWords', () => {
  it('uses code-point offsets across emoji', () => {
    const spans = splitWords('🎉 heello 🎉');
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ word: 'heello', start: 2, end: 8 });
  });
});

describe('mergeMarks', () => {
  it('sorts, merges and clamps into range', () => {
    expect(
      mergeMarks(
        [
          [8, 12],
          [2, 5],
          [4, 9],
          [-3, 1],
          [10, 100],
          [5, 5],
        ],
        12,
      ),
    ).toEqual([
      [0, 1],
      [2, 12],
    ]);
    expect(mergeMarks([[3, 2]], 10)).toEqual([]);
  });
});

describe('windowSnippet', () => {
  it('windows around the first hit and shifts marks into it', () => {
    const text = `${'x '.repeat(100)}heello there`;
    const spans = matchMessageTerms(['hello'], text, true);
    expect(spans).not.toBeNull();
    const { snippet, marks } = windowSnippet(text, spans ?? []);
    expect(snippet.length).toBeLessThanOrEqual(200);
    expect(snippet).toContain('heello');
    const [start, end] = marks[0] ?? [0, 0];
    expect([...snippet].slice(start, end).join('')).toBe('heello');
  });
});
