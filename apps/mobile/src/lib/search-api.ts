import { Effect } from 'effect';
import { toApiError } from '@zilar/api-contract';
import { makeChatExtrasApi, runApiAbortable } from '@zilar/client-core';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

export type { SearchItem, SearchMark } from '@zilar/api-contract';
export type { SearchMessagesInput, SearchPage } from '@zilar/client-core';

export type SearchApi = ReturnType<typeof makeChatExtrasApi>;

export function createSearchApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): SearchApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  // An abort is not a search failure: it surfaces as the `AbortError` a `fetch` abort would give.
  return makeChatExtrasApi((call, signal) =>
    runApiAbortable(Effect.mapError(call(client), toApiError), signal),
  );
}
