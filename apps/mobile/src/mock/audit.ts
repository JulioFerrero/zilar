import { AUDIT_PAGE_LIMIT, type AuditPage, type PublicAuditEntry } from '../lib/audit-api';

/**
 * Mock AI activity API for the AI edit screen (T-0213). Twenty-five entries,
 * newest first, across the actions the section describes (approvals with each
 * decision, stops, resumes, tool runs and an empty action), so `Load more`
 * shows on the first page of 20.
 */

const BASE_AT = new Date('2026-10-03T10:00:00.000Z').getTime();

function makeEntry(
  index: number,
  minutesAgo: number,
  action: string,
  detail: Record<string, unknown> | null,
): PublicAuditEntry {
  return {
    id: `audit-${index}`,
    at: new Date(BASE_AT - minutesAgo * 60_000).toISOString(),
    aiId: 'ai-1',
    groupId: null,
    action,
    subjectId: null,
    argsHash: null,
    cost: null,
    result: 'ok',
    detail,
    actorUserId: null,
  };
}

const ENTRIES: PublicAuditEntry[] = [
  makeEntry(1, 0, 'approval.decided', { decision: 'approve_once' }),
  makeEntry(2, 3, 'approval.decided', { decision: 'approve_always' }),
  makeEntry(3, 9, 'approval.decided', { decision: 'deny' }),
  makeEntry(4, 25, 'approval.decided', null),
  makeEntry(5, 47, 'approval.decided', { decision: 'needs_changes' }),
  makeEntry(6, 70, 'ai.stopped', null),
  makeEntry(7, 95, 'ai.resumed', null),
  makeEntry(8, 130, 'tool.run', null),
  makeEntry(9, 200, 'routine.created', null),
  makeEntry(10, 280, 'tool.run', null),
  makeEntry(11, 400, 'approval.decided', { decision: 'approve_once' }),
  makeEntry(12, 520, 'ai.stopped', null),
  makeEntry(13, 700, 'ai.resumed', null),
  makeEntry(14, 900, 'message.sent', null),
  makeEntry(15, 1200, 'tool.run', null),
  makeEntry(16, 1600, 'approval.decided', { decision: 'deny' }),
  makeEntry(17, 2100, 'routine.updated', null),
  makeEntry(18, 2800, 'ai.stopped', null),
  makeEntry(19, 3600, 'ai.resumed', null),
  makeEntry(20, 4500, 'tool.run', null),
  makeEntry(21, 5600, 'approval.decided', { decision: 'approve_always' }),
  makeEntry(22, 7000, '', null),
  makeEntry(23, 8600, 'routine.deleted', null),
  makeEntry(24, 10500, 'tool.run', null),
  makeEntry(25, 13000, 'ai.resumed', null),
];

/** An `AuditApi` backed by the mock data, for offline UI work and screenshots. */
export function createMockAuditApi(): {
  listAiAudit(aiId: string, before?: string): Promise<AuditPage>;
} {
  return {
    async listAiAudit(_aiId, before) {
      const start =
        before === undefined || before === ''
          ? 0
          : (() => {
              const found = ENTRIES.findIndex((entry) => entry.id === before);
              return found === -1 ? 0 : found + 1;
            })();
      const slice = ENTRIES.slice(start, start + AUDIT_PAGE_LIMIT);
      const remaining = ENTRIES.length - (start + slice.length);
      const last = slice[slice.length - 1];
      return {
        entries: [...slice],
        next: remaining > 0 && last !== undefined ? last.id : null,
      };
    },
  };
}
