// effect-plain: Promise port over the contract; each app's `call` owns the Effect edge.
import type { Effect } from 'effect';
import {
  type AiMemoryView,
  type LinkPreview,
  type MediaItem,
  type MediaPage as ContractMediaPage,
  type MediaTab,
  type Pin,
  type PinKind,
  type SearchItem,
  type SearchPage as ContractSearchPage,
  type ZilarClient,
} from '@zilar/api-contract';

// The decoded pages carry readonly arrays; the apps keep mutable rows.
export type MediaPage = Omit<ContractMediaPage, 'items'> & { items: MediaItem[] };
export type SearchPage = Omit<ContractSearchPage, 'items'> & { items: SearchItem[] };

export interface PinMessageInput {
  chat: string;
  messageId: string;
  senderName: string;
  text: string;
  kind: PinKind;
}

export interface ListChatMediaInput {
  chat: string;
  type: MediaTab;
  before?: string;
  limit?: number;
}

export interface SearchMessagesInput {
  q: string;
  chat?: string;
  limit?: number;
  before?: string;
  signal?: AbortSignal;
}

export type ChatExtrasCall = <A, E>(
  call: (client: ZilarClient) => Effect.Effect<A, E>,
  signal?: AbortSignal,
) => Promise<A>;

/**
 * The pins, AI memory, chat media, link preview and search API of both apps, over
 * the caller's `call`; the signal carries a cancelled search.
 */
export function makeChatExtrasApi(call: ChatExtrasCall) {
  return {
    // Pins arrive newest first.
    listPins: (chat: string): Promise<Pin[]> =>
      call((client) => client.pins.list({ query: { chat } })).then((body) => [...body.pins]),

    // The contract encodes the trimmed senderName, so the client trims before sending.
    pinMessage: (input: PinMessageInput): Promise<Pin> =>
      call((client) =>
        client.pins.create({ payload: { ...input, senderName: input.senderName.trim() } }),
      ),

    unpinMessage: (id: string): Promise<Pin> =>
      call((client) => client.pins.remove({ params: { id } })),

    // chat is the DM peer's bare JID and aiId the AI's id; canChange is false for a room member.
    getAiMemory: (chat: string, aiId: string): Promise<AiMemoryView> =>
      call((client) => client.aiMemory.view({ query: { chat, ai: aiId } })),

    forgetAiMemoryFact: (chat: string, aiId: string, factId: string): Promise<void> =>
      call((client) =>
        client.aiMemory.deleteFact({ params: { id: factId }, query: { chat, ai: aiId } }),
      ).then(() => undefined),

    clearAiMemory: (chat: string, aiId: string): Promise<void> =>
      call((client) => client.aiMemory.clear({ payload: { chat, ai: aiId } })).then(
        () => undefined,
      ),

    // chat is a room bare JID or a DM peer's bare JID; before is the previous page's next
    // cursor. The server decodes the query by hand, so every key travels as a plain string.
    listChatMedia: (input: ListChatMediaInput): Promise<MediaPage> =>
      call((client) =>
        client.media.gallery({
          query: {
            chat: input.chat,
            type: input.type,
            ...(input.before === undefined ? {} : { before: input.before }),
            ...(input.limit === undefined ? {} : { limit: String(input.limit) }),
          },
        }),
      ).then((page) => ({
        // Both apps format every row's date; a malformed `at` would render as `NaN.NaN.NaN`.
        items: page.items.filter((item) => !Number.isNaN(Date.parse(item.at))),
        next: page.next,
      })),

    // The route answers 204 when the page has nothing to show.
    linkPreview: (url: string): Promise<LinkPreview | null> =>
      call((client) => client.linkPreview.get({ query: { url } })).then((value) => value ?? null),

    // Snippets arrive as plain text plus marks ranges; the client highlights with spans, never HTML.
    searchMessages: (input: SearchMessagesInput): Promise<SearchPage> => {
      const query = {
        q: input.q,
        ...(input.chat === undefined || input.chat === '' ? {} : { chat: input.chat }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.before === undefined || input.before === ''
          ? {}
          : { before: Number(input.before) }),
      };
      return call((client) => client.search.search({ query }), input.signal).then((page) => ({
        items: [...page.items],
        ...(page.nextBefore === undefined ? {} : { nextBefore: page.nextBefore }),
      }));
    },
  };
}
