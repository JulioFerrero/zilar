import { API_URL } from './auth';

/**
 * The personal-invite API (`POST /api/invites`), the mobile twin of the web
 * client (`createInvite()` in `apps/web/src/lib/api.ts`). The wire contract
 * lives in `apps/server/src/auth/routes.ts` (answers
 * `{ code, url, expiresAt }`, session required).
 *
 * Mobile has no zod, so — like `approvals-api.ts` — the boundary is validated
 * with type guards. `InvitesApiError` keeps the server's `code` and `status`,
 * so the sheet can branch on the error without parsing the message again.
 */

export interface Invite {
  code: string;
  url: string;
  expiresAt?: string | undefined;
}

export interface InvitesApi {
  createInvite(): Promise<Invite>;
}

export class InvitesApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'InvitesApiError';
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function parseInvite(value: unknown): Invite | null {
  if (!isRecord(value)) return null;
  const code = value['code'];
  const url = value['url'];
  if (!isString(code) || !isString(url)) return null;
  const expiresAt = value['expiresAt'];
  if (expiresAt !== undefined && !isString(expiresAt)) return null;
  return {
    code,
    url,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
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
    throw new InvitesApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new InvitesApiError(response.status, code, message);
  }
  return body;
}

/** The production `InvitesApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createInvitesApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): InvitesApi {
  return {
    async createInvite() {
      const token = await getToken();
      if (token === undefined) {
        throw new InvitesApiError(401, 'unauthorized', 'No session');
      }
      const body = await request(apiUrl, '/api/invites', token, { method: 'POST' }, fetchImpl);
      const parsed = parseInvite(body);
      if (parsed === null) {
        throw new InvitesApiError(
          200,
          'invalid_response',
          'The server sent an unexpected response',
        );
      }
      return parsed;
    },
  };
}
