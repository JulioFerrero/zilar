import { API_URL } from './auth';

/**
 * The AI management API (`/api/ais`), the mobile twin of the web client in
 * `apps/web/src/lib/api.ts`. The wire contract lives in
 * `apps/server/src/ais/routes.ts` and `apps/server/src/ais/service.ts`.
 *
 * Mobile has no zod, so — like `chat-api.ts` — the boundary is validated with
 * type guards. `AisApiError` keeps the server's `code` and `status`, so screens
 * can branch on the error without parsing the message again.
 */

export type AiTemplate = 'dev' | 'marketing' | 'fun' | 'custom';

export interface AiLimits {
  perDayUsd: number;
  perMonthUsd: number;
}

export interface PublicAi {
  id: string;
  name: string;
  template: AiTemplate;
  persona: string;
  model: string;
  jid: string;
  // `stopped` is the owner kill switch (T-0080). Mobile only renders the
  // AI list, so accepting it in the type guard keeps the list rendering
  // for a paused AI — the screen shows it as "stopped" rather than failing.
  status: 'active' | 'disabled' | 'stopped';
  providerConnectionId: string;
  limits: AiLimits;
  createdAt: string;
}

export interface Connection {
  id: string;
  provider: string;
  label: string | null;
  status: string;
  createdAt: string;
}

export interface CreateAiInput {
  name: string;
  template: AiTemplate;
  /** Omit for a stock template the user did not edit: the server applies its default. */
  persona?: string;
  providerConnectionId: string;
  model: string;
  limits: AiLimits;
}

/** PATCH carries only the fields that actually changed. */
export interface UpdateAiInput {
  name?: string;
  persona?: string;
  limits?: AiLimits;
}

export interface AisApi {
  listAis(): Promise<PublicAi[]>;
  createAi(input: CreateAiInput): Promise<PublicAi>;
  updateAi(id: string, input: UpdateAiInput): Promise<PublicAi>;
  deleteAi(id: string): Promise<void>;
  listConnections(): Promise<Connection[]>;
}

export class AisApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AisApiError';
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

function isAiTemplate(value: unknown): value is AiTemplate {
  return value === 'dev' || value === 'marketing' || value === 'fun' || value === 'custom';
}

function parseLimits(value: unknown): AiLimits | null {
  if (!isRecord(value)) return null;
  const perDayUsd = value['perDayUsd'];
  const perMonthUsd = value['perMonthUsd'];
  if (typeof perDayUsd !== 'number' || typeof perMonthUsd !== 'number') return null;
  return { perDayUsd, perMonthUsd };
}

function parsePublicAi(value: unknown): PublicAi | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const name = value['name'];
  const template = value['template'];
  const persona = value['persona'];
  const model = value['model'];
  const jid = value['jid'];
  const status = value['status'];
  const providerConnectionId = value['providerConnectionId'];
  const createdAt = value['createdAt'];
  const limits = parseLimits(value['limits']);
  if (
    !isString(id) ||
    !isString(name) ||
    !isAiTemplate(template) ||
    !isString(persona) ||
    !isString(model) ||
    !isString(jid) ||
    (status !== 'active' && status !== 'disabled' && status !== 'stopped') ||
    !isString(providerConnectionId) ||
    !isString(createdAt) ||
    limits === null
  ) {
    return null;
  }
  return {
    id,
    name,
    template,
    persona,
    model,
    jid,
    status,
    providerConnectionId,
    limits,
    createdAt,
  };
}

function parseConnection(value: unknown): Connection | null {
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

/** The exact POST body the server's strict `CreateAiSchema` accepts. */
export function buildCreateBody(input: CreateAiInput): Record<string, unknown> {
  return {
    name: input.name,
    template: input.template,
    ...(input.persona === undefined ? {} : { persona: input.persona }),
    providerConnectionId: input.providerConnectionId,
    model: input.model,
    limits: input.limits,
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
    throw new AisApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new AisApiError(response.status, code, message);
  }
  return body;
}

/** The production `AisApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createAisApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AisApi {
  const withToken = async (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> => {
    const token = await getToken();
    if (token === undefined) {
      throw new AisApiError(401, 'unauthorized', 'No session');
    }
    const body = await request(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      throw new AisApiError(200, 'invalid_response', 'The server sent an unexpected response');
    }
    return parsed;
  };

  const parseList = <T>(value: unknown, parseItem: (item: unknown) => T | null): T[] | null => {
    if (!Array.isArray(value)) return null;
    const parsed: T[] = [];
    for (const item of value) {
      const result = parseItem(item);
      if (result === null) return null;
      parsed.push(result);
    }
    return parsed;
  };

  return {
    async listAis() {
      const body = await withToken('/api/ais', { method: 'GET' }, (value) =>
        parseList(value, parsePublicAi),
      );
      return body as PublicAi[];
    },
    async createAi(input) {
      const body = await withToken(
        '/api/ais',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildCreateBody(input)),
        },
        parsePublicAi,
      );
      return body as PublicAi;
    },
    async updateAi(id, input) {
      const body = await withToken(
        `/api/ais/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        parsePublicAi,
      );
      return body as PublicAi;
    },
    async deleteAi(id) {
      await withToken(`/api/ais/${encodeURIComponent(id)}`, { method: 'DELETE' }, () => undefined);
    },
    async listConnections() {
      const body = await withToken('/api/connections', { method: 'GET' }, (value) =>
        parseList(value, parseConnection),
      );
      return body as Connection[];
    },
  };
}
