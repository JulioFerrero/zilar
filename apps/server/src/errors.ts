// The statuses `HttpError` is built with across `apps/server/src`.
type ContentfulStatusCode =
  400 | 401 | 403 | 404 | 409 | 410 | 413 | 415 | 422 | 429 | 500 | 501 | 502 | 503;

export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  /** Extra JSON fields merged into the `error` body (e.g. `nextChangeAt`). */
  readonly detail: Record<string, unknown>;

  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}
