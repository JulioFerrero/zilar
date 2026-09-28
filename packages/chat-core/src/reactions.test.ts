import { describe, expect, it } from 'vitest';
import {
  applyReaction,
  emptyReactions,
  mergeTargets,
  summarize,
  type ReactionsState,
} from './reactions';

function apply(
  state: ReactionsState,
  targetId: string,
  reactorJid: string,
  emojis: string[],
  order: number,
): ReactionsState {
  return applyReaction(state, { targetId, reactorJid, emojis, order });
}

describe('applyReaction', () => {
  it('replaces a reactor set with the newest order', () => {
    let state = emptyReactions();
    state = apply(state, 'm-1', 'ana@x', ['👍'], 1);
    state = apply(state, 'm-1', 'ana@x', ['❤️'], 2);

    expect(summarize(state, 'm-1', 'me@x')).toEqual([
      { emoji: '❤️', count: 1, mine: false, reactors: ['ana@x'] },
    ]);
  });

  it('clears a set with an empty update', () => {
    let state = emptyReactions();
    state = apply(state, 'm-1', 'ana@x', ['👍'], 1);
    state = apply(state, 'm-1', 'ana@x', [], 2);

    expect(summarize(state, 'm-1', 'me@x')).toEqual([]);
  });

  it('ignores an out-of-order update so the latest stanza wins', () => {
    let state = emptyReactions();
    state = apply(state, 'm-1', 'ana@x', ['❤️'], 5);
    state = apply(state, 'm-1', 'ana@x', ['👍'], 3);

    expect(summarize(state, 'm-1', 'me@x')).toEqual([
      { emoji: '❤️', count: 1, mine: false, reactors: ['ana@x'] },
    ]);
  });

  it('is idempotent when the same update is applied twice', () => {
    let state = emptyReactions();
    state = apply(state, 'm-1', 'ana@x', ['👍'], 4);
    state = apply(state, 'm-1', 'ana@x', ['👍'], 4);

    expect(summarize(state, 'm-1', 'me@x')).toEqual([
      { emoji: '👍', count: 1, mine: false, reactors: ['ana@x'] },
    ]);
  });

  it('drops duplicates and caps a set at six', () => {
    const state = apply(
      emptyReactions(),
      'm-1',
      'ana@x',
      ['👍', '👍', '😀', '😂', '😮', '😢', '🙏', '❤️'],
      1,
    );

    expect(summarize(state, 'm-1', 'me@x').map((entry) => entry.emoji)).toEqual([
      '👍',
      '😀',
      '😂',
      '😮',
      '😢',
      '🙏',
    ]);
  });
});

describe('summarize', () => {
  it('counts reactJIDs and flags mine', () => {
    let state = emptyReactions();
    state = apply(state, 'm-1', 'ana@x', ['👍'], 1);
    state = apply(state, 'm-1', 'luis@x', ['👍'], 2);
    state = apply(state, 'm-1', 'me@x', ['👍', '❤️'], 3);

    expect(summarize(state, 'm-1', 'me@x')).toEqual([
      { emoji: '👍', count: 3, mine: true, reactors: ['ana@x', 'luis@x', 'me@x'] },
      { emoji: '❤️', count: 1, mine: true, reactors: ['me@x'] },
    ]);
  });

  it('orders emoji by the first time any reactor used them', () => {
    let state = emptyReactions();
    state = apply(state, 'm-1', 'ana@x', ['😢', '👍'], 2);
    state = apply(state, 'm-1', 'luis@x', ['😂'], 1);

    expect(summarize(state, 'm-1', 'me@x').map((entry) => entry.emoji)).toEqual(['😂', '😢', '👍']);
  });

  it('returns nothing for an unknown target', () => {
    expect(summarize(emptyReactions(), 'nope', 'me@x')).toEqual([]);
  });
});

describe('mergeTargets', () => {
  it('moves entries onto the surviving target, keeping the newer set', () => {
    let state = emptyReactions();
    state = apply(state, 'local-1', 'ana@x', ['👍'], 2);
    state = apply(state, 'srv-1', 'me@x', ['❤️'], 5);

    const merged = mergeTargets(state, 'srv-1', 'local-1');

    expect(merged.targets['srv-1']).toBeUndefined();
    expect(summarize(merged, 'local-1', 'me@x')).toEqual([
      { emoji: '👍', count: 1, mine: false, reactors: ['ana@x'] },
      { emoji: '❤️', count: 1, mine: true, reactors: ['me@x'] },
    ]);
  });

  it('keeps the newer set when both targets know the same reactor', () => {
    let state = emptyReactions();
    state = apply(state, 'local-1', 'me@x', ['👍'], 3);
    state = apply(state, 'srv-1', 'me@x', ['❤️'], 5);

    const merged = mergeTargets(state, 'srv-1', 'local-1');

    expect(summarize(merged, 'local-1', 'me@x')).toEqual([
      { emoji: '❤️', count: 1, mine: true, reactors: ['me@x'] },
    ]);
  });

  it('leaves the state alone when the source target is unknown', () => {
    const state = apply(emptyReactions(), 'm-1', 'ana@x', ['👍'], 1);
    expect(mergeTargets(state, 'nope', 'm-1')).toBe(state);
  });
});
