import type { MediaItem } from '@zilar/api-contract';
import { makeChatExtrasApi } from '@zilar/client-core';

export type { MediaItem, MediaTab } from '@zilar/api-contract';
export type { ListChatMediaInput, MediaPage } from '@zilar/client-core';

export type MediaKind = MediaItem['kind'];

export type MediaApi = ReturnType<typeof makeChatExtrasApi>;
