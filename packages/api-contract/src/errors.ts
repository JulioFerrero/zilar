import { Exit, Schema } from 'effect';

// The one error envelope every failed response carries: `{ error: { ...detail, code, message, requestId } }`.
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

// The error every client call rejects with; status 0 means the server was never reached.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: Record<string, unknown>;

  constructor(status: number, code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

// Builds the `ApiError` from `code`/`message` plus extra fields on `detail`, minus the `requestId`;
// a body that is not the envelope becomes `request_failed`.
export function apiErrorFromBody(status: number, raw: unknown): ApiError {
  const decoded = Schema.decodeUnknownExit(ApiErrorBody)(raw);
  if (!Exit.isSuccess(decoded)) {
    return partialApiError(status, raw);
  }
  const { code, message, requestId: _requestId, ...detail } = decoded.value.error;
  void _requestId;
  return new ApiError(status, code, message, detail);
}

// A malformed `code` must not discard a valid `message`, nor the reverse: each field falls back on its own.
function partialApiError(status: number, raw: unknown): ApiError {
  const error =
    typeof raw === 'object' && raw !== null && 'error' in raw
      ? (raw as { readonly error: unknown }).error
      : undefined;
  const fields =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  return new ApiError(
    status,
    typeof fields.code === 'string' ? fields.code : 'request_failed',
    typeof fields.message === 'string' ? fields.message : `Request failed (${status})`,
  );
}
