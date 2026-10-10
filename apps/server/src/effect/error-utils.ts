// Shared server error helpers (T-1043, dedup F6): the two "error name" bodies
// and the widest unique-violation check, collected here from their local
// copies so every module logs and classifies failures the same way.
import { SqlError } from 'effect/sql';

// The `Error.name` of a thrown value, or its type for a non-Error. Callers
// that must keep this string have their own reason; the class-name variant is
// `errorClassName`.
export function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }
  return typeof error;
}

// The constructor class name of a thrown Error, or its type for a non-Error.
// Used where logs must not carry a subclass-supplied `name`.
export function errorClassName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

// Whether `error` is a unique-constraint violation: either the structured
// `effect/sql` `UniqueViolation` reason or a driver error carrying the
// Postgres `23505` code. Driver failures can be wrapped, so the code may sit on
// a nested `cause` (`groups/service.ts` calls this on its `effect/sql` insert).
// Walk the chain; the message check is a last-resort fallback
// for the wrapped shape only, never matched instead of a code.
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
