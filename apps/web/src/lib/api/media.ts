// effect-plain: the promise edge over the Effect client.
import type { LinkPreview } from '@zilar/api-contract';
import { makeChatExtrasApi } from '@zilar/client-core';
import { callApiAbortable } from '@/lib/effect/api-client';

export type {
  ListChatMediaInput,
  MediaPage,
  PinMessageInput,
  SearchMessagesInput,
} from '@zilar/client-core';
export type {
  AiMemoryView as AiMemory,
  LinkPreview,
  MediaItem,
  MediaTab,
  Pin,
  PinKind,
  SearchItem,
} from '@zilar/api-contract';

const api = makeChatExtrasApi(callApiAbortable);

export const { listChatMedia, listPins, pinMessage, searchMessages } = api;

export const aiMemoryApi = {
  clearAiMemory: api.clearAiMemory,
  forgetAiMemoryFact: api.forgetAiMemoryFact,
  getAiMemory: api.getAiMemory,
};

export const unpinMessage = (id: string): Promise<void> =>
  api.unpinMessage(id).then(() => undefined);

const previews = new Map<string, Promise<LinkPreview | null>>();

/** The unfurled head, or null when the page has nothing or the call fails; hits are cached. */
export function linkPreview(url: string): Promise<LinkPreview | null> {
  const cached = previews.get(url);
  if (cached !== undefined) return cached;
  const settled: Promise<LinkPreview | null> = api.linkPreview(url).then(
    (preview) => {
      previews.set(url, settled);
      return preview;
    },
    () => {
      previews.delete(url);
      return null;
    },
  );
  previews.set(url, settled);
  return settled;
}

/** Forgets the module-level cache (tests only). */
export function resetLinkPreviewCache(): void {
  previews.clear();
}
