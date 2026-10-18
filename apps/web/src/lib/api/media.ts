// effect-plain: the promise edge over the Effect client.
import {
  type AiMemoryFact,
  type LinkPreview,
  type MediaItem,
  type MediaPage,
  type MediaTab,
  type Pin,
  type PinKind,
  type SearchItem,
} from '@zilar/api-contract';
import { callApi, callApiAbortable } from '@/lib/effect/api-client';

// Pins arrive newest first.

export type { Pin, PinKind };

export interface PinMessageInput {
  chat: string;
  messageId: string;
  senderName: string;
  text: string;
  kind: PinKind;
}

export function listPins(chat: string): Promise<Pin[]> {
  return callApi((client) => client.pins.list({ query: { chat } })).then((body) => [...body.pins]);
}

// The contract encodes the trimmed senderName, so the client trims before sending.
export function pinMessage(input: PinMessageInput): Promise<Pin> {
  return callApi((client) =>
    client.pins.create({ payload: { ...input, senderName: input.senderName.trim() } }),
  );
}

export async function unpinMessage(id: string): Promise<void> {
  await callApi((client) => client.pins.remove({ params: { id } }));
}

// chat is the DM peer's bare JID and aiId the AI's id; canChange is false for a room
// member who may only view.

export interface AiMemory {
  facts: AiMemoryFact[];
  lines: string[];
  canChange: boolean;
}

export async function getAiMemory(chat: string, aiId: string): Promise<AiMemory> {
  const memory = await callApi((client) => client.aiMemory.view({ query: { chat, ai: aiId } }));
  return { facts: [...memory.facts], lines: [...memory.lines], canChange: memory.canChange };
}

export async function forgetAiMemoryFact(
  chat: string,
  aiId: string,
  factId: string,
): Promise<void> {
  await callApi((client) =>
    client.aiMemory.deleteFact({ params: { id: factId }, query: { chat, ai: aiId } }),
  );
}

export async function clearAiMemory(chat: string, aiId: string): Promise<void> {
  await callApi((client) => client.aiMemory.clear({ payload: { chat, ai: aiId } }));
}

// chat is a room bare JID for groups/topics, or a DM peer's bare JID. before is the
// previous page's next cursor (microseconds as a string); items arrive newest first.

// The server decodes the query by hand, so every key travels as a plain string.
export type { MediaItem, MediaPage, MediaTab };

export interface ListChatMediaInput {
  chat: string;
  type: MediaTab;
  before?: string;
  limit?: number;
}

export function listChatMedia(input: ListChatMediaInput): Promise<MediaPage> {
  return callApi((client) =>
    client.media.gallery({
      query: {
        chat: input.chat,
        type: input.type,
        ...(input.before === undefined ? {} : { before: input.before }),
        ...(input.limit === undefined ? {} : { limit: String(input.limit) }),
      },
    }),
  ).then((page) => ({ items: [...page.items], next: page.next }));
}

// Answers 204 when the page has nothing to show; a module-level cache plus in-flight
// dedupe stops a list re-render from refetching the same URL.

export type { LinkPreview };

const linkPreviewCache = new Map<string, LinkPreview | null>();
const linkPreviewInFlight = new Map<string, Promise<LinkPreview | null>>();

/** The unfurled head, or null when the page has nothing or the call fails; hits are cached. */
export function linkPreview(url: string): Promise<LinkPreview | null> {
  const cached = linkPreviewCache.get(url);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }
  const running = linkPreviewInFlight.get(url);
  if (running !== undefined) {
    return running;
  }
  const task = callApi((client) => client.linkPreview.get({ query: { url } }))
    .then((value) => {
      const preview = value ?? null;
      linkPreviewCache.set(url, preview);
      return preview;
    })
    .catch(() => null)
    .finally(() => {
      linkPreviewInFlight.delete(url);
    });
  linkPreviewInFlight.set(url, task);
  return task;
}

/** Forgets the module-level cache (tests only). */
export function resetLinkPreviewCache(): void {
  linkPreviewCache.clear();
  linkPreviewInFlight.clear();
}

// Snippets arrive as plain text plus marks ranges; the client highlights with spans, never HTML.

export type { SearchItem };

export interface SearchMessagesInput {
  q: string;
  chat?: string;
  limit?: number;
  before?: string;
  signal?: AbortSignal;
}

export function searchMessages(
  input: SearchMessagesInput,
): Promise<{ items: SearchItem[]; nextBefore?: string | undefined }> {
  // The cursor travels as a string and decodes to a number in the contract.
  const query = {
    q: input.q,
    ...(input.chat === undefined || input.chat === '' ? {} : { chat: input.chat }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.before === undefined || input.before === '' ? {} : { before: Number(input.before) }),
  };
  return callApiAbortable((client) => client.search.search({ query }), input.signal).then(
    (page) => ({
      items: [...page.items],
      ...(page.nextBefore === undefined ? {} : { nextBefore: page.nextBefore }),
    }),
  );
}
