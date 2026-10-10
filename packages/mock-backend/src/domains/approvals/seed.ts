// The approval seed (T-0941): the one pending request the demo chat shows. The
// row carries both the request payload (`action`..`requestedBy`) and the
// decision, so the HTTP routes need no separate card helper. `aiId` uses the
// unified JID-localpart id (`ai-dev-1`), the same scheme the tools and audit
// seeds use.
import type { ApprovalStatus } from '@zilar/api-contract';
import type { MockSeed } from '../../data';
import type { DomainContext } from '../domain';

const HOUR_MS = 3_600_000;

/** One approval as the mock stores it: request fields plus the decision. */
export interface MockApproval {
  id: string;
  aiId: string;
  groupId: string | null;
  action: string;
  summary: string;
  details: string | null;
  argsHash: string;
  worstCase: { currency: 'EUR' | 'USD'; amount: number } | null;
  requestedBy: string;
  status: ApprovalStatus;
  decidedAt: string | null;
  note: string | null;
  expiresAt: string;
  createdAt: string;
  alwaysEligible: boolean;
}

/**
 * One pending approval, matching web's `approvalCard()` (`apr-42`,
 * `merge_pull_request`, the EUR 0.4 worst case). `expiresAt` is relative to the
 * clock, so the seeded row stays decidable on first paint.
 */
export function seedApprovals(context: DomainContext): Partial<MockSeed> {
  const at = context.now().getTime();
  return {
    approvals: [
      {
        id: 'apr-42',
        aiId: 'ai-dev-1',
        groupId: null,
        action: 'merge_pull_request',
        summary: 'Merge PR #42 — fix the checkout button on mobile Safari',
        details: 'Squash-merges the branch into main and deletes the branch.',
        argsHash: 'a'.repeat(64),
        worstCase: { currency: 'EUR', amount: 0.4 },
        requestedBy: 'dev-1@ai.zilar.test',
        status: 'pending',
        decidedAt: null,
        note: null,
        expiresAt: new Date(at + HOUR_MS).toISOString(),
        createdAt: new Date(at).toISOString(),
        alwaysEligible: true,
      },
    ],
  };
}
