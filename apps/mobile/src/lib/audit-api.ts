import { API_URL } from './auth';

/**
 * The AI activity read API (`GET /api/audit?aiId=…`), the mobile twin of the
 * web client in `apps/web/src/lib/api.ts` (`listAudit`). The wire contract
 * lives in `apps/server/src/audit/routes.ts`.
 *
 * Mobile validates the boundary with type guards, like `tools-api.ts`.
 * `AuditApiError` keeps the server's `code` and `status`, so the section can
 * show fixed user-facing sentences instead of server text.
 */

export type AuditResult = 'ok' | 'denied' | 'error';

export interface AuditCost {
  currency: 'EUR' | 'USD';
  amount: number;
}

export interface PublicAuditEntry {
  id: string;
  at: string;
  aiId: string | null;
  groupId: string | null;
  action: string;
  subjectId: string | null;
  argsHash: string | null;
  cost: AuditCost | null;
  result: AuditResult;
  detail: Record<string, unknown> | null;
  actorUserId: string | null;
}

export interface AuditPage {
  entries: PublicAuditEntry[];
  next: string | null;
}

export interface AuditApi {
  listAiAudit(aiId: string, before?: string): Promise<AuditPage>;
}

export class AuditApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AuditApiError';
    this.status = status;
    this.code = code;
  }
}

/** Page size, matching web `PAGE_LIMIT` in `AiActivity.tsx`. */
export const AUDIT_PAGE_LIMIT = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isAuditResult(value: unknown): value is AuditResult {
  return value === 'ok' || value === 'denied' || value === 'error';
}

function parseCost(value: unknown): AuditCost | null {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  const currency = value['currency'];
  const amount = value['amount'];
  if ((currency !== 'EUR' && currency !== 'USD') || typeof amount !== 'number') return null;
  return { currency, amount };
}

function parseAuditEntry(value: unknown): PublicAuditEntry | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const at = value['at'];
  const aiId = value['aiId'];
  const groupId = value['groupId'];
  const action = value['action'];
  const subjectId = value['subjectId'];
  const argsHash = value['argsHash'];
  const cost = value['cost'];
  const result = value['result'];
  const detail = value['detail'];
  const actorUserId = value['actorUserId'];
  if (!isString(id) || !isString(at)) return null;
  if (aiId !== null && !isString(aiId)) return null;
  if (groupId !== null && !isString(groupId)) return null;
  if (!isString(action)) return null;
  if (subjectId !== null && !isString(subjectId)) return null;
  if (argsHash !== null && !isString(argsHash)) return null;
  if (!isAuditResult(result)) return null;
  if (detail !== null && !isRecord(detail)) return null;
  if (actorUserId !== null && !isString(actorUserId)) return null;
  if (cost !== null && !isRecord(cost)) return null;
  const parsedCost = parseCost(cost);
  if (cost !== null && parsedCost === null) return null;
  return {
    id,
    at,
    aiId,
    groupId,
    action,
    subjectId,
    argsHash,
    cost: parsedCost,
    result,
    detail,
    actorUserId,
  };
}

function parseAuditPage(value: unknown): AuditPage | null {
  if (!isRecord(value)) return null;
  const entries = value['entries'];
  const next = value['next'];
  if (!Array.isArray(entries)) return null;
  if (next !== null && !isString(next)) return null;
  const parsed: PublicAuditEntry[] = [];
  for (const item of entries) {
    const entry = parseAuditEntry(item);
    if (entry === null) return null;
    parsed.push(entry);
  }
  return { entries: parsed, next };
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
    throw new AuditApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new AuditApiError(response.status, code, message);
  }
  return body;
}

/** The production `AuditApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createAuditApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AuditApi {
  return {
    async listAiAudit(aiId, before) {
      const params = new URLSearchParams();
      params.set('aiId', aiId);
      params.set('limit', String(AUDIT_PAGE_LIMIT));
      if (before !== undefined && before !== '') {
        params.set('before', before);
      }
      const token = await getToken();
      if (token === undefined) {
        throw new AuditApiError(401, 'unauthorized', 'No session');
      }
      const body = await request(
        apiUrl,
        `/api/audit?${params.toString()}`,
        token,
        { method: 'GET' },
        fetchImpl,
      );
      const parsed = parseAuditPage(body);
      if (parsed === null) {
        throw new AuditApiError(200, 'invalid_response', 'The server sent an unexpected response');
      }
      return parsed;
    },
  };
}
