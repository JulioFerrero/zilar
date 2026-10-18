import { runApi, type MediaItem } from '@zilar/api-contract';
import { makeChatExtrasApi } from '@zilar/client-core';

import { createApiClient } from './effect/api-client';

export type { MediaItem, MediaTab } from '@zilar/api-contract';
export type { ListChatMediaInput, MediaPage } from '@zilar/client-core';

export type MediaKind = MediaItem['kind'];

export type MediaApi = ReturnType<typeof makeChatExtrasApi>;

export function createMediaApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): MediaApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return makeChatExtrasApi((call) => runApi(call(client)));
}
