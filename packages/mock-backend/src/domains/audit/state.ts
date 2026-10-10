import type { MockSeed } from '../../data';
import type { MockData } from '../../state';

/** The audit log table; rows are immutable once seeded. */
export function createAuditState(seed: MockSeed): Partial<MockData> {
  return { audit: seed.audit };
}
