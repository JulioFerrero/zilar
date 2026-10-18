import { runApi } from '@zilar/api-contract';
import { makeChatExtrasApi } from '@zilar/client-core';

import { createApiClient } from './effect/api-client';

export type { Pin } from '@zilar/api-contract';
export type { PinMessageInput } from '@zilar/client-core';

/** A pin `kind` this build does not know decodes to `text`. */
export type { SnapshotPinKind, SnapshotPinKind as PinKind } from './pin-snapshot';

export type PinsApi = ReturnType<typeof makeChatExtrasApi>;

export function createPinsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): PinsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return makeChatExtrasApi((call) => runApi(call(client)));
}

export { pinKindFor, pinLabel, pinSnapshotText } from './pin-snapshot';
