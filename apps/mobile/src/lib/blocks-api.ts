import { Exit, Schema } from 'effect';
import { ApiError, runApi, type BlocksRespondPayload } from '@zilar/api-contract';
import { BlocksDataSchema, type BlocksData } from '@zilar/protocol';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';
import { getSessionToken } from './session-token';

/**
 * The interactive card answer (T-1796), the phone twin of web's
 * `POST /api/blocks/respond` call (T-1795). The route lives in
 * `packages/api-contract/src/message-blocks.ts` (T-1792) and returns the
 * merged card as opaque data, decoded here with `BlocksDataSchema`; a failed
 * decode rejects as `invalid_response`.
 */

let client: ReturnType<typeof createApiClient> | undefined;

function blocksClient(): ReturnType<typeof createApiClient> {
  client ??= createApiClient({ getToken: getSessionToken, fetchImpl: fetch, apiUrl: API_URL });
  return client;
}

/** Records one answer and resolves the card the server merged it into. */
export async function respondToBlock(payload: BlocksRespondPayload): Promise<BlocksData> {
  const { data } = await runApi(blocksClient()['message-blocks'].respond({ payload }));
  const decoded = Schema.decodeUnknownExit(BlocksDataSchema)(data);
  if (Exit.isFailure(decoded)) {
    throw new ApiError(200, 'invalid_response', 'The server sent an unexpected response');
  }
  return decoded.value;
}
