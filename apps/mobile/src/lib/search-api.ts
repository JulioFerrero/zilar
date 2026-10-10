import { Effect } from 'effect';
import { ApiError, toApiError } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * Message search (`GET /api/search`, T-0138). The mobile twin of the web
 * client in `apps/web/src/lib/api.ts`: the client is derived from the shared
 * contract (`packages/api-contract/src/search.ts`, T-0894), which owns the
 * schemas. Snippets arrive as plain text plus `marks` character ranges; the
 * client highlights with nested text and never renders HTML, like web's
 * `SearchSnippet`. Queries are never logged: they travel only in the request
 * URL the server deliberately does not log.
 */

export type SearchMark = [number, number];

export interface SearchItem {
  chatJid: string;
  messageId: string;
  senderName: string;
  at: string;
  snippet: string;
  marks: SearchMark[];
}

export interface SearchPage {
  items: SearchItem[];
  nextBefore?: string;
}

export interface SearchMessagesInput {
  q: string;
  chat?: string;
  limit?: number;
  before?: string;
  signal?: AbortSignal;
}

export interface SearchApi {
  searchMessages(input: SearchMessagesInput): Promise<SearchPage>;
}

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const SearchApiError = ApiError;
export type SearchApiError = ApiError;

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

/** The production `SearchApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createSearchApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): SearchApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    async searchMessages(input) {
      // A function, not a direct read, so TypeScript does not narrow `aborted`
      // to `false` after the first check: the signal can still fire mid-request.
      const isAborted = () => input.signal?.aborted === true;
      if (isAborted()) {
        throw abortError();
      }
      // The cursor travels as a string in the app and decodes to a number in
      // the contract; an empty `chat` or `before` is left out, like before.
      const query = {
        q: input.q,
        ...(input.chat === undefined || input.chat === '' ? {} : { chat: input.chat }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.before === undefined || input.before === ''
          ? {}
          : { before: Number(input.before) }),
      };
      let page;
      try {
        // An abort is not a search failure: it interrupts the request and
        // surfaces as the `AbortError` a `fetch` abort would give.
        page = await Effect.runPromise(
          Effect.mapError(client.search.search({ query }), toApiError),
          input.signal === undefined ? undefined : { signal: input.signal },
        );
      } catch (error) {
        throw isAborted() ? abortError() : error;
      }
      if (isAborted()) {
        throw abortError();
      }
      return {
        items: [...page.items],
        ...(page.nextBefore === undefined ? {} : { nextBefore: page.nextBefore }),
      };
    },
  };
}
