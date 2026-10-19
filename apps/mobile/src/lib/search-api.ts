import { Effect } from 'effect';
import { toApiError } from '@zilar/api-contract';
import { makeChatExtrasApi, runApiAbortable } from '@zilar/client-core';

import { createApiClient, type ApiCall, type ApiTransport } from './effect/api-client';

export type { SearchItem, SearchMark } from '@zilar/api-contract';
export type { SearchMessagesInput, SearchPage } from '@zilar/client-core';

export type SearchApi = ReturnType<typeof makeChatExtrasApi>;

export function makeSearchApi(_call: ApiCall, transport: ApiTransport): SearchApi {
  const client = createApiClient(transport);
  // An abort is not a search failure: it surfaces as the `AbortError` a `fetch` abort would give.
  return makeChatExtrasApi((call, signal) =>
    runApiAbortable(Effect.mapError(call(client), toApiError), signal),
  );
}
