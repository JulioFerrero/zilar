// effect-plain: pure ejabberd error-text helpers; the schema-issue walker moved to effect/schema-issues
// Every ejabberd failure; messages never include the admin credentials.
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

// ejabberd answers either a bare JSON string or `{ status, code, message }`.
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
