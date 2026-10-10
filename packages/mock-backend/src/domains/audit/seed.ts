// The audit seed (T-0941): the AI and group log rows the AI panel and the group
// panel read. Ported from web's `seedState().audit`, with the AI ids normalized
// to the unified row-id scheme (`ai-dev-1`, `ai-qa-1`, `ai-marketing`).
// Timestamps are relative to the clock, so the rows always look recent.
import type { MockSeed } from '../../data';
import type { DomainContext } from '../domain';

export interface MockAuditEntry {
  id: string;
  at: string;
  aiId: string;
  groupId: string | null;
  action: string;
  subjectId: string | null;
  argsHash: string | null;
  cost: { currency: 'EUR' | 'USD'; amount: number } | null;
  result: 'ok' | 'denied' | 'error';
  detail: Record<string, unknown> | null;
  actorUserId: string | null;
}

const MINUTE_MS = 60_000;

export function seedAudit(context: DomainContext): Partial<MockSeed> {
  const at = context.now().getTime();
  const minutesAgo = (minutes: number): string => new Date(at - minutes * MINUTE_MS).toISOString();
  const you = 'u-you';
  const audit: MockAuditEntry[] = [
    {
      id: 'audit-dev-stopped',
      at: minutesAgo(7),
      aiId: 'ai-dev-1',
      groupId: null,
      action: 'ai.stopped',
      subjectId: 'ai-dev-1',
      argsHash: null,
      cost: null,
      result: 'ok',
      detail: null,
      actorUserId: you,
    },
    {
      id: 'audit-dev-resumed',
      at: minutesAgo(4),
      aiId: 'ai-dev-1',
      groupId: null,
      action: 'ai.resumed',
      subjectId: 'ai-dev-1',
      argsHash: null,
      cost: null,
      result: 'ok',
      detail: null,
      actorUserId: you,
    },
    {
      id: 'audit-dev-approval',
      at: minutesAgo(2),
      aiId: 'ai-dev-1',
      groupId: null,
      action: 'approval.decided',
      subjectId: 'apr-42',
      argsHash: 'a'.repeat(64),
      cost: { currency: 'EUR', amount: 0.4 },
      result: 'ok',
      detail: { decision: 'approve_once' },
      actorUserId: you,
    },
    {
      id: 'audit-mkt-approval',
      at: minutesAgo(10),
      aiId: 'ai-marketing',
      groupId: null,
      action: 'approval.decided',
      subjectId: 'apr-43',
      argsHash: 'b'.repeat(64),
      cost: { currency: 'USD', amount: 0.2 },
      result: 'denied',
      detail: { decision: 'deny' },
      actorUserId: you,
    },
    {
      id: 'audit-mkt-paired',
      at: minutesAgo(35),
      aiId: 'ai-marketing',
      groupId: null,
      action: 'machine.paired',
      subjectId: 'mach-approved',
      argsHash: null,
      cost: null,
      result: 'ok',
      detail: null,
      actorUserId: you,
    },
    {
      id: 'audit-devteam-approval',
      at: minutesAgo(15),
      aiId: 'ai-dev-1',
      groupId: 'g-devteam',
      action: 'approval.decided',
      subjectId: 'apr-100',
      argsHash: 'c'.repeat(64),
      cost: { currency: 'EUR', amount: 0.25 },
      result: 'ok',
      detail: { decision: 'approve_once' },
      actorUserId: you,
    },
    {
      id: 'audit-devteam-deny',
      at: minutesAgo(28),
      aiId: 'ai-qa-1',
      groupId: 'g-devteam',
      action: 'approval.decided',
      subjectId: 'apr-101',
      argsHash: 'd'.repeat(64),
      cost: { currency: 'USD', amount: 0.1 },
      result: 'denied',
      detail: { decision: 'deny' },
      actorUserId: you,
    },
    {
      id: 'audit-qa-approval',
      at: minutesAgo(40),
      aiId: 'ai-qa-1',
      groupId: 'g-qa',
      action: 'approval.decided',
      subjectId: 'apr-102',
      argsHash: 'e'.repeat(64),
      cost: { currency: 'EUR', amount: 0.5 },
      result: 'ok',
      detail: { decision: 'approve_always' },
      actorUserId: you,
    },
  ];
  return { audit };
}
