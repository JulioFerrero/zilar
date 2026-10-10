// The standing "always allow" rules (T-0941). The table starts empty; an
// `approve_always` decision in the approvals route adds a row.
import type { MockSeed } from '../../data';

/** One standing "always allow" rule an `approve_always` decision creates. */
export interface MockApprovalRule {
  id: string;
  aiId: string;
  action: string;
  scope: 'personal' | 'group';
  groupId: string | null;
  createdAt: string;
  createdBy: string;
}

/** The rules seed is empty: every rule is created by a decision. */
export function seedApprovalRules(): Partial<MockSeed> {
  return {};
}
