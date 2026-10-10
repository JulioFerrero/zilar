import { Effect } from 'effect';
import { HttpError } from '../errors';
import { RoutineServiceError } from './service';

function mapServiceError(error: unknown): unknown {
  if (error instanceof RoutineServiceError) {
    if (error.errorCode === 'not_found') {
      return new HttpError(404, 'not_found', 'Routine not found');
    }
    if (error.errorCode === 'needs_approval') {
      return new HttpError(409, 'needs_approval', error.message);
    }
    if (error.errorCode === 'routine_limit' || error.errorCode === 'hosts_not_approved') {
      return new HttpError(400, error.errorCode, error.message);
    }
    return new HttpError(400, 'invalid_request', error.message);
  }
  return error;
}

// Service rejections travel as defects (`Effect.promise`), which `try/catch`
// inside `Effect.gen` cannot see: map them with `catchDefect` and re-die so
// the envelope renders the mapped answer. Unknown rejections pass through
// unchanged and stay a 500, exactly like the old route's unmapped throw.
export function withServiceErrors<A>(promise: () => Promise<A>): Effect.Effect<A> {
  return Effect.promise(promise).pipe(
    Effect.catchDefect((defect) => Effect.die(mapServiceError(defect))),
  );
}
