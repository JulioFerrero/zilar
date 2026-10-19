import { makeChatExtrasApi } from '@zilar/client-core';

export type { Pin } from '@zilar/api-contract';

export type PinsApi = ReturnType<typeof makeChatExtrasApi>;
