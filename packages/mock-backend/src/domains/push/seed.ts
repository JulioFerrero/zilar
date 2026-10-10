// The push domain's seed (T-0119), mirroring web's mock
// (`apps/web/src/mock/api.ts:731-733`): no registered devices, previews on.

import type { MockSeed } from '../../data';

export function seedPush(): Partial<MockSeed> {
  return { pushDevices: [], pushShowPreviews: true };
}
