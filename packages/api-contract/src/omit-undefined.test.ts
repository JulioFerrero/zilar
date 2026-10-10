import { describe, expect, it } from 'vitest';
import { omitUndefined } from './omit-undefined';

describe('omitUndefined', () => {
  it('keeps null and false, drops undefined', () => {
    expect(omitUndefined({ a: null, b: false, c: undefined, d: 0 })).toEqual({
      a: null,
      b: false,
      d: 0,
    });
  });
});
