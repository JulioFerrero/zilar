import { runApi } from '@zilar/api-contract';
import { makeBlocksApi } from '@zilar/client-core';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';
import { getSessionToken } from './session-token';

// A failed decode rejects as `invalid_response`; the card itself is opaque data.

let client: ReturnType<typeof createApiClient> | undefined;

function blocksClient(): ReturnType<typeof createApiClient> {
  client ??= createApiClient({ getToken: getSessionToken, fetchImpl: fetch, apiUrl: API_URL });
  return client;
}

const api = makeBlocksApi((call) => runApi(call(blocksClient())));

export const { myBlockPicks, respondToBlock } = api;
