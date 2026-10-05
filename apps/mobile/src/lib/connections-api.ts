import { API_URL } from './auth';

/**
 * The model provider connections API (`/api/connections`), the mobile twin
 * of the web client in `apps/web/src/lib/api.ts`. The wire contract lives in
 * `apps/server/src/connections/routes.ts`.
 *
 * An API key is write-only: the server never returns one, and this module
 * never stores one. The key travels only in the POST body of
 * `createConnection` and is dropped by the caller right after.
 *
 * Mobile has no zod, so — like `ais-api.ts` — the boundary is validated with
 * type guards. `ConnectionsApiError` keeps the server's `code` and `status`,
 * so screens can branch on the error without parsing the message again.
 */

export interface ProviderConnection {
  id: string;
  provider: string;
  label: string | null;
  status: string;
  createdAt: string;
}

export interface CreateConnectionInput {
  provider: string;
  key: string;
  label?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message?: string;
}

export interface ConnectionsApi {
  listConnections(): Promise<ProviderConnection[]>;
  createConnection(input: CreateConnectionInput): Promise<ProviderConnection>;
  testConnection(id: string): Promise<ConnectionTestResult>;
  deleteConnection(id: string): Promise<void>;
}

export class ConnectionsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ConnectionsApiError';
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

function parseConnection(value: unknown): ProviderConnection | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const provider = value['provider'];
  const status = value['status'];
  const createdAt = value['createdAt'];
  const label = value['label'];
  if (!isString(id) || !isString(provider) || !isString(status) || !isString(createdAt)) {
    return null;
  }
  return { id, provider, label: isString(label) ? label : null, status, createdAt };
}

function parseTestResult(value: unknown): ConnectionTestResult | null {
  if (!isRecord(value)) return null;
  const ok = value['ok'];
  const message = value['message'];
  if (typeof ok !== 'boolean') return null;
  return message === undefined ? { ok } : isString(message) ? { ok, message } : null;
}

/** The exact POST body the server's strict `CreateConnectionSchema` accepts. */
export function buildCreateConnectionBody(input: CreateConnectionInput): Record<string, unknown> {
  return {
    provider: input.provider,
    key: input.key,
    ...(input.label === undefined ? {} : { label: input.label }),
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
    throw new ConnectionsApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new ConnectionsApiError(response.status, code, message);
  }
  return body;
}

/** The production `ConnectionsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createConnectionsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ConnectionsApi {
  const withToken = async (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> => {
    const token = await getToken();
    if (token === undefined) {
      throw new ConnectionsApiError(401, 'unauthorized', 'No session');
    }
    const body = await request(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      throw new ConnectionsApiError(
        200,
        'invalid_response',
        'The server sent an unexpected response',
      );
    }
    return parsed;
  };

  const parseList = (value: unknown): ProviderConnection[] | null => {
    if (!Array.isArray(value)) return null;
    const parsed: ProviderConnection[] = [];
    for (const item of value) {
      const result = parseConnection(item);
      if (result === null) return null;
      parsed.push(result);
    }
    return parsed;
  };

  return {
    async listConnections() {
      const body = await withToken('/api/connections', { method: 'GET' }, parseList);
      return body as ProviderConnection[];
    },
    async createConnection(input) {
      const body = await withToken(
        '/api/connections',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildCreateConnectionBody(input)),
        },
        parseConnection,
      );
      return body as ProviderConnection;
    },
    async testConnection(id) {
      const body = await withToken(
        `/api/connections/${encodeURIComponent(id)}/test`,
        { method: 'POST' },
        parseTestResult,
      );
      return body as ConnectionTestResult;
    },
    async deleteConnection(id) {
      await withToken(
        `/api/connections/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        () => undefined,
      );
    },
  };
}
