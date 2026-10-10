import { SchemaIssue } from 'effect';

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

export function firstIssueMessage(issue: SchemaIssue.Issue): string | undefined {
  switch (issue._tag) {
    case 'Composite':
    case 'AnyOf':
      for (const child of issue.issues) {
        const message = firstIssueMessage(child);
        if (message !== undefined) {
          return message;
        }
      }
      return undefined;
    case 'Pointer':
    case 'Filter':
    case 'Encoding':
      return firstIssueMessage(issue.issue);
    case 'InvalidValue': {
      const message = issue.annotations?.message;
      return typeof message === 'string' && message.length > 0 ? message : undefined;
    }
    default:
      return undefined;
  }
}
