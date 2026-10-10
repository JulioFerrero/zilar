// `GET /audit` (T-0941), mirroring web's mock: the caller names exactly one of
// `aiId` / `groupId` (400 otherwise), the rows come newest first, and `limit`
// is clamped. Group-scoped rows answer the group panel's log; AI-scoped rows
// answer the AI panel's.

import type { MockData } from '../../state';
import { errorResponse, jsonResponse, type MockHttpRequest } from '../../http/shared';
import type { MockAuditEntry } from './seed';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function handleAudit(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments.length !== 1 || request.segments[0] !== 'audit') {
    return undefined;
  }
  if (request.method !== 'GET') {
    return undefined;
  }
  const aiId = request.query.get('aiId');
  const groupId = request.query.get('groupId');
  if ((aiId === null) === (groupId === null)) {
    return errorResponse('invalid_request', 'Provide exactly one of groupId or aiId', 400);
  }
  const limit = clampLimit(request.query.get('limit'));
  const matches =
    aiId !== null
      ? (entry: MockAuditEntry): boolean => entry.aiId === aiId
      : (entry: MockAuditEntry): boolean => entry.groupId === groupId;
  const entries = [...data.audit]
    .filter(matches)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
  return jsonResponse({ entries, next: null });
}

function clampLimit(raw: string | null): number {
  if (raw === null) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}
