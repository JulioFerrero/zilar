import { describe, expect, it } from 'vitest';
import { argsHash, canonicalJson, CanonicalJsonError } from './canonical';

describe('canonicalJson', () => {
  it('serialises primitives', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(false)).toBe('false');
    expect(canonicalJson(0)).toBe('0');
    expect(canonicalJson(-1.5)).toBe('-1.5');
    expect(canonicalJson('hi')).toBe('"hi"');
  });

  it('sorts object keys at every depth', () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(
      canonicalJson([
        { z: 1, a: 2 },
        { a: 1, z: 2 },
      ]),
    ).toBe('[{"a":2,"z":1},{"a":1,"z":2}]');
  });

  it('escapes unicode in strings', () => {
    expect(canonicalJson('héllo\u0000')).toBe('"héllo\\u0000"');
  });

  it('rejects undefined values at the root', () => {
    expect(() => canonicalJson(undefined)).toThrow(CanonicalJsonError);
  });

  it('rejects undefined values inside objects', () => {
    expect(() => canonicalJson({ a: 1, b: undefined })).toThrow(CanonicalJsonError);
  });

  it('rejects functions and symbols', () => {
    expect(() => canonicalJson(() => undefined)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(Symbol('s'))).toThrow(CanonicalJsonError);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => canonicalJson(NaN)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(Infinity)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(-Infinity)).toThrow(CanonicalJsonError);
  });

  it('rejects bigint values', () => {
    expect(() => canonicalJson(1n)).toThrow(CanonicalJsonError);
  });

  it('rejects cycles at any depth', () => {
    const a: Record<string, unknown> = { name: 'loop' };
    a.self = a;
    expect(() => canonicalJson(a)).toThrow(CanonicalJsonError);
  });

  it('two equal inputs produce the same string', () => {
    const left = { files: ['/a.ts', '/b.ts'], nested: { x: 1, y: [1, 2, 3] } };
    const right = { nested: { y: [1, 2, 3], x: 1 }, files: ['/a.ts', '/b.ts'] };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
  });

  it('numbers use the JSON.stringify shortest-repr rule', () => {
    // Same number, different keys — must serialise identically so the hash
    // is order-independent.
    expect(canonicalJson(1e10)).toBe(canonicalJson(10000000000));
  });
});

describe('argsHash', () => {
  it('is 64 hex characters', () => {
    const hash = argsHash({ a: 1 });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches for equal inputs regardless of key order', () => {
    expect(argsHash({ a: 1, b: 2 })).toBe(argsHash({ b: 2, a: 1 }));
  });

  it('differs for different inputs', () => {
    expect(argsHash({ a: 1 })).not.toBe(argsHash({ a: 2 }));
  });

  it('rejects non-JSON inputs', () => {
    expect(() => argsHash({ a: undefined })).toThrow(CanonicalJsonError);
  });
});
