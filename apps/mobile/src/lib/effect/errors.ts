import { Data } from 'effect';

/**
 * The typed failure of a *-api.ts call lifted into Effect. Mobile has one
 * error class per api module (`ChatApiError`, `AisApiError`, ...) with the
 * same `status`, `code` and `message`, so this mirrors them field for field
 * and a caller that matches on `code` or `status` behaves the same.
 */
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
 * Maps anything a rejected *-api.ts call can throw to an ApiFailure. Any error
 * with a numeric `status` and string `code` and `message` (whatever its
 * class) keeps its fields and message, and a record `detail` when it has one;
 * any other value becomes a generic failure, so the thrown text never reaches
 * a message.
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
