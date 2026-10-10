import { ApiFailure } from '@zilar/client-core';
import { ApiError } from '@/lib/api';

export { ApiFailure };

const UNKNOWN_MESSAGE = 'Something went wrong';

/**
 * Maps anything a rejected api.ts call can throw to an ApiFailure. An
 * ApiError keeps its fields and message; any other value becomes a generic
 * failure, so the thrown text never reaches a message.
 */
export const toApiFailure = (cause: unknown): ApiFailure => {
  if (cause instanceof ApiError) {
    return new ApiFailure({
      status: cause.status,
      code: cause.code,
      message: cause.message,
      detail: cause.detail,
    });
  }
  return new ApiFailure({ status: 0, code: 'unknown_error', message: UNKNOWN_MESSAGE, detail: {} });
};

/** Matches a failure with the given code, for `Effect.catchIf`. */
export const isApiFailureCode =
  (code: string) =>
  (failure: ApiFailure): boolean =>
    failure.code === code;
