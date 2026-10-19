import type { AiMemoryView } from '@zilar/api-contract';
import { makeChatExtrasApi } from '@zilar/client-core';

import type { ApiCall } from './effect/api-client';

export type { AiMemoryView as AiMemory, AiMemoryFact } from '@zilar/api-contract';

/** Errors are the shared `ApiError`, so the section shows fixed sentences, never server text. */
export interface AiMemoryApi {
  getMemory(chat: string, aiId: string): Promise<AiMemoryView>;
  forgetFact(chat: string, aiId: string, factId: string): Promise<void>;
  clear(chat: string, aiId: string): Promise<void>;
}

export function makeAiMemoryApi(call: ApiCall): AiMemoryApi {
  const api = makeChatExtrasApi(call);
  return {
    getMemory: api.getAiMemory,
    forgetFact: api.forgetAiMemoryFact,
    clear: api.clearAiMemory,
  };
}
