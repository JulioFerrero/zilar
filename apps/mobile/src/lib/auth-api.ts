/** The signed-in profile, from `GET /api/me` (T-0015/T-0020). */
export interface Me {
  id: string;
  email: string;
  name: string;
  jid: string | null;
}

/** A failed API call, carrying the status and the server's error code. */
export class AuthApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseMe(value: unknown): Me | null {
  if (!isRecord(value)) return null;
  const { id, email, name } = value;
  if (typeof id !== 'string' || typeof email !== 'string' || typeof name !== 'string') {
    return null;
  }
  const jid = value['jid'];
  return { id, email, name, jid: typeof jid === 'string' ? jid : null };
}

async function request(
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  } catch {
    throw new AuthApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = typeof error?.['code'] === 'string' ? error['code'] : 'request_failed';
    const message =
      typeof error?.['message'] === 'string'
        ? error['message']
        : `Request failed (${response.status})`;
    throw new AuthApiError(response.status, code, message);
  }
  return body;
}

export async function fetchMe(
  apiUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Me> {
  const body = await request(apiUrl, '/api/me', token, { method: 'GET' }, fetchImpl);
  const me = parseMe(body);
  if (me === null) {
    throw new AuthApiError(200, 'invalid_response', 'The server sent an unexpected response');
  }
  return me;
}

export async function updateMe(
  apiUrl: string,
  token: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Me> {
  const body = await request(
    apiUrl,
    '/api/me',
    token,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    },
    fetchImpl,
  );
  const me = parseMe(body);
  if (me === null) {
    throw new AuthApiError(200, 'invalid_response', 'The server sent an unexpected response');
  }
  return me;
}

/** Checks an invite link without leaking anything about its creator. */
export async function checkInvite(
  apiUrl: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}/api/invites/${encodeURIComponent(code)}`, {
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new AuthApiError(0, 'network_error', 'Could not reach the server');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(body)) {
    return false;
  }
  return body['valid'] === true;
}
