import { describe, expect, it } from 'vitest';
import { peopleHandleFor } from './people-handle-search';

describe('peopleHandleFor', () => {
  it('ignores text that does not start with @', () => {
    expect(peopleHandleFor('ana')).toBeNull();
  });

  it('ignores a bare @', () => {
    expect(peopleHandleFor('@')).toBeNull();
  });

  it('trims, strips one @ and lowercases', () => {
    expect(peopleHandleFor(' @Ana ')).toBe('ana');
  });
});
