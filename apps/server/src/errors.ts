type ContentfulStatusCode =
  400 | 401 | 403 | 404 | 409 | 410 | 413 | 415 | 422 | 429 | 500 | 501 | 502 | 503;

export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
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

export function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'Not found');
}

/** The chat service is unreachable: answers 503 with code `xmpp_unavailable`. */
export function xmppUnavailable(): HttpError {
  return new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
}
