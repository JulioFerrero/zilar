// The contact-requests seed (T-1067): no rows, like web's mock
// (`contactRequests: []` at `apps/web/src/mock/api.ts:919`).

import type { MockSeed } from '../../data';

export function seedContactRequestsTable(): Partial<MockSeed> {
  return { contactRequests: [] };
}
