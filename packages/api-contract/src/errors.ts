import { Exit, Schema } from 'effect';

/**
 * The one error envelope every failed API response carries:
 * `{ error: { ...detail, code, message, requestId } }`. The server renders it
 * in `apps/server/src/effect/http-core.ts`; extra keys are the `detail` an
 * `HttpError` merged in (for example `nextChangeAt`).
 */
export const ApiErrorBody = Schema.Struct({
  error: Schema.StructWithRest(
    Schema.Struct({
      code: Schema.String,
      message: Schema.String,
      requestId: Schema.optional(Schema.String),
    }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ),
});

export type ApiErrorBody = typeof ApiErrorBody.Type;

/**
 * The error every client call rejects with: the HTTP status (0 when the
 * server was never reached), the envelope `code` and `message`, and the
 * envelope's extra fields on `detail`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Extra fields the server merged into the `error` body (e.g. `nextChangeAt`). */
  readonly detail: Record<string, unknown>;

  constructor(status: number, code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Builds the `ApiError` for a failed response body: `code`/`message` plus any
 * extra fields on `detail`, minus the `requestId` the server adds for
 * tracing. A body that is not the envelope becomes `request_failed`.
 */
export function apiErrorFromBody(status: number, raw: unknown): ApiError {
  const decoded = Schema.decodeUnknownExit(ApiErrorBody)(raw);
  if (!Exit.isSuccess(decoded)) {
    return new ApiError(status, 'request_failed', `Request failed (${status})`);
  }
  const { code, message, requestId: _requestId, ...detail } = decoded.value.error;
  void _requestId;
  return new ApiError(status, code, message, detail);
}
