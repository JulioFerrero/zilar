// Contact-request error helpers (T-0983 size split, moved unchanged from
// `./service`): the shared 404 and the unique-violation probe for the
// pending-request indexes.
import { SqlError } from 'effect/sql';
import { HttpError } from '../errors';

export function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'Not found');
}

// Whether `error` is a unique violation on one of the pending-request
// indexes: either the structured `effect/sql` `UniqueViolation` reason (which
// carries the constraint identifier) or a plain `{ code: '23505', constraint }`
// object (plain driver errors and the recovery test's doubles).
// Matched by code/constraint — never by message text.
export function isPendingPairViolation(error: unknown): boolean {
  if (error instanceof SqlError.SqlError) {
    const reason = error.reason;
    return (
      reason._tag === 'UniqueViolation' &&
      (reason.constraint === undefined ||
        reason.constraint === 'contact_requests_pending_idx' ||
        reason.constraint === 'contact_requests_pending_pair_idx')
    );
  }
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }
    const record = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (record.code === '23505') {
      return (
        record.constraint === undefined ||
        record.constraint === 'contact_requests_pending_idx' ||
        record.constraint === 'contact_requests_pending_pair_idx'
      );
    }
    if (!('cause' in record)) {
      return false;
    }
    current = record.cause;
  }
  return false;
}
