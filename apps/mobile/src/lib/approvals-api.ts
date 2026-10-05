import { API_URL } from './auth';

/**
 * The approvals API (`/api/approvals`), the mobile twin of the web client in
 * `apps/web/src/lib/api.ts`. The wire contract lives in
 * `apps/server/src/approvals/routes.ts` and `apps/server/src/approvals/service.ts`.
 *
 * Mobile has no zod, so — like `ais-api.ts` and `chat-api.ts` — the boundary is
 * validated with type guards. `ApprovalsApiError` keeps the server's `code` and
 * `status`, so the card can branch on the error without parsing the message
 * again (404 = not decidable, 409 = race / expired).
 */

export type ApprovalStatus =
  'pending' | 'approved_once' | 'approved_always' | 'denied' | 'consumed' | 'expired';

export type ApprovalDecision = 'approve_once' | 'approve_always' | 'deny';

export interface ApprovalWorstCase {
  currency: 'EUR' | 'USD';
  amount: number;
}

export interface PublicApproval {
  id: string;
  aiId: string;
  groupId: string | null;
  action: string;
  summary: string;
  details: string | null;
  argsHash: string;
  worstCase: ApprovalWorstCase | null;
  requestedBy: string;
  status: ApprovalStatus;
  decidedAt: string | null;
  note: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface ApprovalsApi {
  getApproval(id: string): Promise<PublicApproval>;
  decideApproval(id: string, decision: ApprovalDecision, note?: string): Promise<PublicApproval>;
  listApprovals(): Promise<PublicApproval[]>;
  listAiApprovalRules(aiId: string): Promise<ApprovalRule[]>;
  listGroupApprovalRules(groupId: string): Promise<ApprovalRule[]>;
  revokeApprovalRule(id: string): Promise<void>;
}

export type ApprovalRuleScope = 'personal' | 'group';

export interface ApprovalRule {
  id: string;
  action: string;
  scope: ApprovalRuleScope;
  groupId: string | null;
  topicId: string | null;
  topicName: string | null;
  createdAt: string;
  createdBy: string;
}

export class ApprovalsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApprovalsApiError';
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

function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return (
    value === 'pending' ||
    value === 'approved_once' ||
    value === 'approved_always' ||
    value === 'denied' ||
    value === 'consumed' ||
    value === 'expired'
  );
}

function isApprovalCurrency(value: unknown): value is 'EUR' | 'USD' {
  return value === 'EUR' || value === 'USD';
}

function parseWorstCase(value: unknown): ApprovalWorstCase | null {
  if (!isRecord(value)) return null;
  const currency = value['currency'];
  const amount = value['amount'];
  if (!isApprovalCurrency(currency) || typeof amount !== 'number') return null;
  return { currency, amount };
}

function parsePublicApproval(value: unknown): PublicApproval | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const aiId = value['aiId'];
  const groupId = value['groupId'];
  const action = value['action'];
  const summary = value['summary'];
  const details = value['details'];
  const argsHash = value['argsHash'];
  const requestedBy = value['requestedBy'];
  const status = value['status'];
  const decidedAt = value['decidedAt'];
  const note = value['note'];
  const expiresAt = value['expiresAt'];
  const createdAt = value['createdAt'];
  if (
    !isString(id) ||
    !isString(aiId) ||
    !isString(action) ||
    !isString(summary) ||
    !isString(argsHash) ||
    !isString(requestedBy) ||
    !isString(expiresAt) ||
    !isString(createdAt) ||
    !isApprovalStatus(status)
  ) {
    return null;
  }
  const worstCase = parseWorstCase(value['worstCase']);
  if (value['worstCase'] !== null && worstCase === null) {
    return null;
  }
  return {
    id,
    aiId,
    groupId: isString(groupId) ? groupId : null,
    action,
    summary,
    details: isString(details) ? details : null,
    argsHash,
    worstCase,
    requestedBy,
    status,
    decidedAt: isString(decidedAt) ? decidedAt : null,
    note: isString(note) ? note : null,
    expiresAt,
    createdAt,
  };
}

function isApprovalRuleScope(value: unknown): value is ApprovalRuleScope {
  return value === 'personal' || value === 'group';
}

function parseApprovalRule(value: unknown): ApprovalRule | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const action = value['action'];
  const scope = value['scope'];
  const groupId = value['groupId'];
  const topicId = value['topicId'];
  const topicName = value['topicName'];
  const createdAt = value['createdAt'];
  const createdBy = value['createdBy'];
  if (
    !isString(id) ||
    !isString(action) ||
    !isApprovalRuleScope(scope) ||
    !isString(createdAt) ||
    !isString(createdBy)
  ) {
    return null;
  }
  return {
    id,
    action,
    scope,
    groupId: isString(groupId) ? groupId : null,
    // Optional on the wire (older servers omit them); a non-string value
    // reads like absence rather than failing the whole list.
    topicId: isString(topicId) ? topicId : null,
    topicName: isString(topicName) ? topicName : null,
    createdAt,
    createdBy,
  };
}

/** The exact POST body the server's strict `decisionSchema` accepts. */
export function buildDecisionBody(
  decision: ApprovalDecision,
  note?: string,
): Record<string, unknown> {
  return note === undefined ? { decision } : { decision, note };
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
    throw new ApprovalsApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new ApprovalsApiError(response.status, code, message);
  }
  return body;
}

/** The production `ApprovalsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createApprovalsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ApprovalsApi {
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
  const withToken = async (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> => {
    const token = await getToken();
    if (token === undefined) {
      throw new ApprovalsApiError(401, 'unauthorized', 'No session');
    }
    const body = await request(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      throw new ApprovalsApiError(
        200,
        'invalid_response',
        'The server sent an unexpected response',
      );
    }
    return parsed;
  };

  return {
    async getApproval(id) {
      const body = await withToken(
        `/api/approvals/${encodeURIComponent(id)}`,
        { method: 'GET' },
        parsePublicApproval,
      );
      return body as PublicApproval;
    },
    async decideApproval(id, decision, note) {
      const body = buildDecisionBody(decision, note);
      const result = await withToken(
        `/api/approvals/${encodeURIComponent(id)}/decision`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        parsePublicApproval,
      );
      return result as PublicApproval;
    },
    async listApprovals() {
      const body = await withToken('/api/approvals', { method: 'GET' }, (value) =>
        parseList(value, parsePublicApproval),
      );
      return body as PublicApproval[];
    },
    async listAiApprovalRules(aiId) {
      const body = await withToken(
        `/api/ais/${encodeURIComponent(aiId)}/approval-rules`,
        { method: 'GET' },
        (value) => parseList(value, parseApprovalRule),
      );
      return body as ApprovalRule[];
    },
    async listGroupApprovalRules(groupId) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/approval-rules`,
        { method: 'GET' },
        (value) => parseList(value, parseApprovalRule),
      );
      return body as ApprovalRule[];
    },
    async revokeApprovalRule(id) {
      await withToken(
        `/api/approval-rules/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        // A 204 has no body (`request` yields null): any 2xx means revoked.
        () => true,
      );
    },
  };
}
