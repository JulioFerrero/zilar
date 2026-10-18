// Shared error-name helpers and the widest unique-violation check, so every
// module logs and classifies failures the same way.
import { SqlError } from 'effect/sql';

// The `Error.name` of a thrown value, or its type for a non-Error.
export function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }
  return typeof error;
}

// The constructor name, used where logs must not carry a subclass-supplied `name`.
export function errorClassName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

// Either the structured `UniqueViolation` reason or the Postgres `23505` code,
// which a wrapped driver error can carry on a nested `cause`. The message check
// is a last resort, never matched instead of a code.
export function isUniqueViolation(error: unknown): boolean {
  if (error instanceof SqlError.SqlError) {
    return error.reason._tag === 'UniqueViolation';
  }
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }
    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (record.code === '23505') {
      return true;
    }
    if (
      typeof record.message === 'string' &&
      (/duplicate key/i.test(record.message) || /UNIQUE constraint/i.test(record.message))
    ) {
      return true;
    }
    if (!('cause' in record)) {
      return false;
    }
    current = record.cause;
  }
  return false;
}
