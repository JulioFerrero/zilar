import { Effect } from 'effect';
import { toApiError } from '@zilar/api-contract';
import { runApiAbortable } from '@zilar/client-core';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * Snippets are plain text plus `marks` ranges, so the client highlights with nested text and never renders HTML. Queries are never logged.
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

export function createSearchApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): SearchApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    async searchMessages(input) {
      const query = {
        q: input.q,
        ...(input.chat === undefined || input.chat === '' ? {} : { chat: input.chat }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.before === undefined || input.before === ''
          ? {}
          : { before: Number(input.before) }),
      };
      // An abort is not a search failure: it surfaces as the `AbortError` a `fetch` abort would give.
      const page = await runApiAbortable(
        Effect.mapError(client.search.search({ query }), toApiError),
        input.signal,
      );
      return {
        items: [...page.items],
        ...(page.nextBefore === undefined ? {} : { nextBefore: page.nextBefore }),
      };
    },
  };
}
