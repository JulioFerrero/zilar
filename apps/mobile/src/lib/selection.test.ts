import { describe, expect, it } from 'vitest';

import { selectedInOrder, toggleSelected } from './selection';

describe('toggleSelected', () => {
  it('adds an id that is not selected', () => {
    expect(toggleSelected(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('removes an id that is selected', () => {
    expect(toggleSelected(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('does not mutate the input', () => {
    const ids = ['a'];
    toggleSelected(ids, 'b');
    expect(ids).toEqual(['a']);
  });
});

describe('selectedInOrder', () => {
  it('keeps the messages in chat order even when picked out of order', () => {
    const messages = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }];
    expect(selectedInOrder(messages, ['m3', 'm1']).map((message) => message.id)).toEqual([
      'm1',
      'm3',
    ]);
  });

  it('drops ids with no message and handles an empty selection', () => {
    const messages = [{ id: 'm1' }, { id: 'm2' }];
    expect(selectedInOrder(messages, ['gone'])).toEqual([]);
    expect(selectedInOrder(messages, [])).toEqual([]);
  });
});
