import { createHash } from 'node:crypto';

// A typed error thrown by `canonicalJson` when the value is not a tree of
// JSON-safe primitives. The set is narrower than `JSON.stringify`: we also
// reject `NaN`, `Infinity`, `-Infinity` and `bigint` because they would either
// silently coerce to `null` or throw, and neither matches the "exactly what
// was approved" promise the gateway makes.
export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

// Canonical JSON for the args hash (PROJECT_PLAN §15.3, integrity):
// keys sorted at every depth, arrays keep order, numbers go through
// `JSON.stringify`'s rules, and any non-JSON value (including `undefined`,
// functions, symbols, `NaN`, `Infinity` and cycles) throws so the caller
// knows the input is unsafe rather than getting a hash over a coerced
// string that disagrees with the original.
export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  return serialise(value, seen);
}

function serialise(value: unknown, seen: WeakSet<object>): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError('Non-finite numbers are not allowed in canonical JSON');
    }
    // `JSON.stringify` is the spec for number→string: it rounds to the
    // shortest repr that round-trips, so two equal numbers serialise
    // identically.
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') {
    throw new CanonicalJsonError('bigint values are not allowed in canonical JSON');
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    throw new CanonicalJsonError(`${typeof value} values are not allowed in canonical JSON`);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new CanonicalJsonError('Cycles are not allowed in canonical JSON');
    }
    seen.add(value);
    try {
      const parts = value.map((entry) => serialise(entry, seen));
      return `[${parts.join(',')}]`;
    } finally {
      seen.delete(value);
    }
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (seen.has(record)) {
      throw new CanonicalJsonError('Cycles are not allowed in canonical JSON');
    }
    seen.add(record);
    try {
      const keys = Object.keys(record).sort();
      const parts: string[] = [];
      for (const key of keys) {
        // `undefined` inside an object would silently drop in JSON; we
        // refuse it instead so a bug never changes the hash.
        if (record[key] === undefined) {
          throw new CanonicalJsonError('undefined values are not allowed in canonical JSON');
        }
        parts.push(`${JSON.stringify(key)}:${serialise(record[key], seen)}`);
      }
      return `{${parts.join(',')}}`;
    } finally {
      seen.delete(record);
    }
  }
  throw new CanonicalJsonError(`Unsupported value of type ${typeof value}`);
}

// SHA-256 hex of `canonicalJson(value)`. Cheap: callers parse the args once
// (zod), then both the stored hash and the verification hash go through this.
export function argsHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
