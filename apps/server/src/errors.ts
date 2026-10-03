import type { ContentfulStatusCode } from 'hono/utils/http-status';

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
