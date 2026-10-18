// effect-plain: pure canonical JSON and SHA-256 hash; bad input is a typed CanonicalJsonError
import { createHash } from 'node:crypto';

// Thrown for values `JSON.stringify` would coerce or drop (NaN, Infinity, bigint, undefined, functions, symbols).
export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

// Canonical JSON for the args hash: keys sorted at every depth, arrays keep order, non-JSON values throw instead of coercing.
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
    // `JSON.stringify` is the spec for number→string: shortest round-tripping repr.
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
        // Refuse `undefined` in objects so a bug never changes the hash.
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

export function argsHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
