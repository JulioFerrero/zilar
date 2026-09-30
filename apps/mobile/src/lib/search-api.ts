import { API_URL } from './auth';

/**
 * Message search (`GET /api/search`, T-0138). The mobile twin of the web
 * client in `apps/web/src/lib/api.ts`: the same wire contract
 * (`apps/server/src/search/routes.ts`), validated the same way mobile
 * validates every other boundary — with type guards, since mobile has no
 * zod (`chat-api.ts`, `topics-api.ts`).
 *
 * Snippets arrive as plain text plus `marks` character ranges; the client
 * highlights with nested text and never renders HTML, like web's
 * `SearchSnippet`. Queries are never logged: they travel only in the
 * request URL the server deliberately does not log.
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

export class SearchApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'SearchApiError';
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function parseMark(value: unknown): SearchMark | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [start, end] = value;
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end < 0) return null;
  return [start, end];
}

function parseSearchItem(value: unknown): SearchItem | null {
  if (!isRecord(value)) return null;
  const chatJid = value['chatJid'];
  const messageId = value['messageId'];
  const senderName = value['senderName'];
  const at = value['at'];
  const snippet = value['snippet'];
  const marks = value['marks'];
  if (
    !isString(chatJid) ||
    !isString(messageId) ||
    !isString(senderName) ||
    !isString(at) ||
    !isString(snippet) ||
    !Array.isArray(marks)
  ) {
    return null;
  }
  const parsed: SearchMark[] = [];
  for (const mark of marks) {
    const parsedMark = parseMark(mark);
    if (parsedMark === null) return null;
    parsed.push(parsedMark);
  }
  return { chatJid, messageId, senderName, at, snippet, marks: parsed };
}

function parseSearchPage(value: unknown): SearchPage | null {
  if (!isRecord(value) || !Array.isArray(value['items'])) return null;
  const items: SearchItem[] = [];
  for (const entry of value['items']) {
    const item = parseSearchItem(entry);
    if (item === null) return null;
    items.push(item);
  }
  const nextBefore = value['nextBefore'];
  if (nextBefore === undefined) return { items };
  return isString(nextBefore) ? { items, nextBefore } : null;
}

function searchParams(input: SearchMessagesInput): string {
  const params = new URLSearchParams();
  params.set('q', input.q);
  if (input.chat !== undefined && input.chat !== '') {
    params.set('chat', input.chat);
  }
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  if (input.before !== undefined && input.before !== '') {
    params.set('before', input.before);
  }
  return params.toString();
}

/** The production `SearchApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createSearchApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): SearchApi {
  return {
    async searchMessages(input) {
      const token = await getToken();
      if (token === undefined) {
        throw new SearchApiError(401, 'unauthorized', 'No session');
      }
      if (input.signal?.aborted === true) {
        throw new DOMException('Aborted', 'AbortError');
      }
      let response: Response;
      try {
        response = await fetchImpl(`${apiUrl}/api/search?${searchParams(input)}`, {
          method: 'GET',
          headers: { accept: 'application/json', authorization: `Bearer ${token}` },
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error;
        }
        throw new SearchApiError(0, 'network_error', 'Could not reach the server');
      }
      if (input.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
        const code = isString(error?.['code']) ? error['code'] : 'request_failed';
        const message = isString(error?.['message'])
          ? error['message']
          : `Request failed (${response.status})`;
        throw new SearchApiError(response.status, code, message);
      }
      const parsed = parseSearchPage(body);
      if (parsed === null) {
        throw new SearchApiError(200, 'invalid_response', 'The server sent an unexpected response');
      }
      return parsed;
    },
  };
}
