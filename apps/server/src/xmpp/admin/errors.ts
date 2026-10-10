// effect-plain: pure ejabberd error-text helpers; the schema-issue walker moved to effect/schema-issues
// Every failure coming from ejabberd (HTTP status or an error body) is wrapped
// in this type. Messages never include the admin credentials.
export class EjabberdApiError extends Error {
  readonly command: string;
  readonly status: number;

  constructor(command: string, status: number, detail: string) {
    super(`ejabberd command "${command}" failed with HTTP ${status}: ${detail}`);
    this.name = 'EjabberdApiError';
    this.command = command;
    this.status = status;
  }
}

// ejabberd answers errors either as a bare JSON string ("Room already exists")
// or as `{ "status": "error", "code": …, "message": … }`. This extracts a
// readable detail from both.
export function errorText(body: unknown): string {
  if (typeof body === 'string') {
    return body === '' ? 'no response body' : body;
  }
  if (body === null) {
    return 'no response body';
  }
  if (typeof body === 'object') {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  try {
    return JSON.stringify(body);
  } catch {
    return 'unreadable response body';
  }
}

export function isErrorBody(body: unknown): boolean {
  if (body === null || typeof body !== 'object') {
    return false;
  }
  const record = body as Record<string, unknown>;
  return record['status'] === 'error' || typeof record['error'] === 'string';
}

export function mentionsAlreadyExists(body: unknown): boolean {
  const text = errorText(body).toLowerCase();
  return text.includes('already registered') || text.includes('already exists');
}
