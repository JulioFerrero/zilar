import { Exit, Schema } from 'effect';
import { ApiError, runApi, type BlocksRespondPayload } from '@zilar/api-contract';
import { BlocksDataSchema, type BlocksData } from '@zilar/protocol';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';
import { getSessionToken } from './session-token';

/**
 * The card comes back as opaque data; a failed decode rejects as `invalid_response`.
 */

let client: ReturnType<typeof createApiClient> | undefined;

function blocksClient(): ReturnType<typeof createApiClient> {
  client ??= createApiClient({ getToken: getSessionToken, fetchImpl: fetch, apiUrl: API_URL });
  return client;
}

export async function respondToBlock(payload: BlocksRespondPayload): Promise<BlocksData> {
  const { data } = await runApi(blocksClient()['message-blocks'].respond({ payload }));
  const decoded = Schema.decodeUnknownExit(BlocksDataSchema)(data);
  if (Exit.isFailure(decoded)) {
    throw new ApiError(200, 'invalid_response', 'The server sent an unexpected response');
  }
  return decoded.value;
}

/**
 * A poll starts from them after a reload, so a re-vote never drops an earlier option.
 */
export async function myBlockPicks(messageId: string): Promise<Record<string, readonly string[]>> {
  const { picks } = await runApi(blocksClient()['message-blocks'].mine({ query: { messageId } }));
  return picks;
}
