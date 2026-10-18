// effect-plain: the promise edge over callApi; the Effect client owns the request and the decode.
import type { BlocksRespondPayload } from '@zilar/api-contract';
import { BlocksDataSchema, type BlocksData } from '@zilar/protocol';
import { Result, Schema } from 'effect';
import { callApi } from '@/lib/effect/api-client';
import { ApiError } from './http';

const decodeBlocksData = Schema.decodeUnknownResult(BlocksDataSchema);

/** Returns the merged card so the caller can draw the new state before the room correction
 * arrives. A failed decode is an error, never a partial card. */
export function respondToBlock(payload: BlocksRespondPayload): Promise<BlocksData> {
  return callApi((client) => client['message-blocks'].respond({ payload })).then(({ data }) => {
    const decoded = decodeBlocksData(data);
    if (Result.isFailure(decoded)) {
      throw new ApiError(200, 'invalid_response', 'The server sent an unexpected response');
    }
    return decoded.success;
  });
}

/** The viewer's own picks, restored after a reload: a re-vote sends the whole set, so the
 * server never drops an earlier option. */
export function myBlockPicks(messageId: string): Promise<Record<string, readonly string[]>> {
  return callApi((client) => client['message-blocks'].mine({ query: { messageId } })).then(
    ({ picks }) => picks,
  );
}
