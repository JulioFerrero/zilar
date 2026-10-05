import { describe, expect, it } from 'vitest';

import { movedOrder, panelIdSet } from './order';

describe('movedOrder', () => {
  it('moves a pack up and down one step', () => {
    expect(movedOrder(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(movedOrder(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  it('sends the complete id list in the new order', () => {
    const next = movedOrder(['a', 'b', 'c', 'd'], 'a', 1);
    expect(next).toEqual(['b', 'a', 'c', 'd']);
    expect(next).toHaveLength(4);
  });

  it('leaves the ends in place', () => {
    expect(movedOrder(['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
    expect(movedOrder(['a', 'b'], 'b', 1)).toEqual(['a', 'b']);
    expect(movedOrder(['a', 'b'], 'gone', 1)).toEqual(['a', 'b']);
  });
});

describe('panelIdSet', () => {
  it('marks the panel packs', () => {
    const ids = panelIdSet(['a', 'b']);
    expect(ids.has('a')).toBe(true);
    expect(ids.has('c')).toBe(false);
  });
});
