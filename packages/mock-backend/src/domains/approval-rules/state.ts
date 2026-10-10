import type { MockData } from '../../state';
import type { MockApprovalRule } from './seed';

/** The standing "always allow" rules; empty until an `approve_always` decision. */
export function createApprovalRulesState(): Partial<MockData> {
  const approvalRules: MockApprovalRule[] = [];
  return { approvalRules };
}
