import { SqlError } from 'effect/sql';

// Recognises the pending-request partial unique indexes by code or constraint,
// never by message text.
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
