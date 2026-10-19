import { Data } from 'effect';
import { makeFromApi } from './api-effect';

/** The typed failure of an api call; it mirrors each app's api error field for
 * field, so a caller matching on `code` or `status` behaves the same. */
export class ApiFailure extends Data.TaggedError('ApiFailure')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly detail: Record<string, unknown>;
}> {}

const UNKNOWN_MESSAGE = 'Something went wrong';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Maps anything a rejected *-api.ts call throws to an ApiFailure. A numeric `status`
 * with string `code` and `message` keeps its fields; any other value becomes a
 * generic failure, so the thrown text never reaches a message.
 */
export const toApiFailure = (cause: unknown): ApiFailure => {
  if (
    isRecord(cause) &&
    typeof cause.status === 'number' &&
    typeof cause.code === 'string' &&
    typeof cause.message === 'string'
  ) {
    return new ApiFailure({
      status: cause.status,
      code: cause.code,
      message: cause.message,
      detail: isRecord(cause.detail) ? cause.detail : {},
    });
  }
  return new ApiFailure({ status: 0, code: 'unknown_error', message: UNKNOWN_MESSAGE, detail: {} });
};

/** Matches a failure with the given code, for `Effect.catchIf`. */
export const isApiFailureCode =
  (code: string) =>
  (failure: ApiFailure): boolean =>
    failure.code === code;

export const isStaleDecision = (failure: ApiFailure): boolean =>
  failure.code === 'not_pending' || failure.code === 'expired';

export const fromApi = makeFromApi(toApiFailure);
