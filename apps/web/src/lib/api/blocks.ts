// effect-plain: the promise edge over `callApi`, like the other api/ modules;
// the Effect client owns the request and the card decode happens here.
import type { BlocksRespondPayload } from '@zilar/api-contract';
import { BlocksDataSchema, type BlocksData } from '@zilar/protocol';
import { Result, Schema } from 'effect';
import { callApi } from '@/lib/effect/api-client';
import { ApiError } from './http';

const decodeBlocksData = Schema.decodeUnknownResult(BlocksDataSchema);

/**
 * T-1795: one answer to an interactive card. The route records the answer and
 * returns the merged card, so the caller can draw the new state before the
 * room correction arrives. A failed decode is an error, never a partial card.
 */
export function respondToBlock(payload: BlocksRespondPayload): Promise<BlocksData> {
  return callApi((client) => client['message-blocks'].respond({ payload })).then(({ data }) => {
    const decoded = decodeBlocksData(data);
    if (Result.isFailure(decoded)) {
      throw new ApiError(200, 'invalid_response', 'The server sent an unexpected response');
    }
    return decoded.success;
  });
}
