import type { MockSeed } from '../../data';
import type { MockData } from '../../state';
import type { MockApproval } from './seed';

/**
 * The approvals table. Rows are cloned from the seed so a caller-supplied seed
 * is never changed; decisions mutate the row in place (the route owns that).
 */
export function createApprovalsState(seed: MockSeed): Partial<MockData> {
  const approvals: MockApproval[] = seed.approvals.map((row) => ({ ...row }));
  return { approvals };
}
