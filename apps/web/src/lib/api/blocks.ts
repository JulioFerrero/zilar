// effect-plain: the promise edge over callApi; the shared module owns the request and the decode.
import { makeBlocksApi } from '@zilar/client-core';
import { callApi } from '@/lib/effect/api-client';

export const { myBlockPicks, respondToBlock } = makeBlocksApi(callApi);
