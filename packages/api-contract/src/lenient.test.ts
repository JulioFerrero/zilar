import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { lenientArray, LenientOptionalString } from './lenient';

const Row = Schema.Struct({ id: Schema.String, n: Schema.Number });
const Rows = lenientArray(Row);

describe('lenientArray', () => {
  it('drops the rows that fail and keeps the rest in order', () => {
    const rows = Schema.decodeUnknownSync(Rows)([
      { id: 'a', n: 1 },
      { id: 7, n: 2 },
      null,
      { id: 'b', n: 3 },
    ]);
    expect(rows).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 3 },
    ]);
  });

  it('still fails when the value is not an array', () => {
    expect(() => Schema.decodeUnknownSync(Rows)('nope')).toThrow();
    expect(() => Schema.decodeUnknownSync(Rows)(undefined)).toThrow();
  });

  it('encodes strictly: a bad row is an error on the server side', () => {
    expect(Schema.encodeUnknownSync(Rows)([{ id: 'a', n: 1 }])).toEqual([{ id: 'a', n: 1 }]);
    expect(() => Schema.encodeUnknownSync(Rows)([{ id: 'a', n: 'x' }])).toThrow();
  });
});

describe('LenientOptionalString', () => {
  const Holder = Schema.Struct({ next: LenientOptionalString });

  it('reads a string, and a value of the wrong type or a missing key as undefined', () => {
    expect(Schema.decodeUnknownSync(Holder)({ next: 'x' }).next).toBe('x');
    expect(Schema.decodeUnknownSync(Holder)({ next: 25 }).next).toBeUndefined();
    expect(Schema.decodeUnknownSync(Holder)({}).next).toBeUndefined();
  });
});
