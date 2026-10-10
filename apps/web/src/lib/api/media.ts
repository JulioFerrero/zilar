// effect-plain: moved unchanged from apps/web/src/lib/api.ts (size split)
import {
  type AiMemoryFact,
  type MediaItem,
  type MediaPage,
  type MediaTab,
  type Pin,
  type PinKind,
  type SearchItem,
} from '@zilar/api-contract';
import { callApi, callApiAbortable } from '@/lib/effect/api-client';

// --- Pinned messages (T-0114) ------------------------------------------------
// The contract (schemas and endpoints) lives in `@zilar/api-contract`
// (`pins.ts`, T-0864); these functions are thin wrappers over the derived
// client. Pins arrive newest first.

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

// The server trims `senderName`; the contract encodes the trimmed form, so
// the client trims before sending.
export function pinMessage(input: PinMessageInput): Promise<Pin> {
  return callApi((client) =>
    client.pins.create({ payload: { ...input, senderName: input.senderName.trim() } }),
  );
}

export async function unpinMessage(id: string): Promise<void> {
  await callApi((client) => client.pins.remove({ params: { id } }));
}

// --- AI memory (T-0443) ------------------------------------------------------
// The wire contract lives in apps/server/src/agents/memory/api.ts. `chat`
// is the DM peer's bare JID (the AI's JID in a DM); `aiId` is the AI's id. The
// server answers the pinned facts and the cover lines; `canChange` is false
// for a room member who may only view.

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

// --- Media gallery (T-0434) --------------------------------------------------
// The wire contract lives in apps/server/src/media/api.ts. `chat` is a room
// bare JID for groups/topics, or a DM peer's bare JID. `type` maps to a panel
// tab; `before` is the `next` cursor of the previous page (microseconds as a
// string). Items arrive newest first.

// The schemas and the query keys live in `@zilar/api-contract` (`media.ts`,
// T-0895). The server decodes the query by hand, after its archive check and
// limiter, so every key travels as a plain string.
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

// --- Message search (T-0117) -----------------------------------------------
// The wire contract lives in packages/api-contract/src/search.ts. Snippets
// arrive as plain text plus `marks` ranges; the client highlights with
// spans and never renders HTML.

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
  // The cursor travels as a string in the app and decodes to a number in the
  // contract; an empty `chat` or `before` is left out, like before.
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
