/**
 * Mock message search (T-0138): the mobile twin of the web mock in
 * `apps/web/src/mock/api.ts`. A case-insensitive substring match over the
 * mock messages' text bodies (deleted messages and cards have no searchable
 * text), newest first, with the server's `nextBefore` cursor. `chat`
 * narrows to one chat id, like the server. Short queries and out-of-range
 * pages answer the same errors as the server so the UI states stay honest.
 */

import { SearchApiError, type SearchApi, type SearchItem } from '../lib/search-api';
import type { UiMessage } from '../lib/types';
import { mockChats, mockMessagesByChat } from './index';

/** UTF-16 offsets (what `String.indexOf` counts) to character offsets. */
function codePointIndex(text: string, utf16Index: number): number {
  let count = 0;
  for (const _ of text.slice(0, utf16Index)) {
    count += 1;
  }
  return count;
}

interface MockSearchInput {
  q: string;
  chat?: string;
  limit?: number;
  before?: string;
  signal?: AbortSignal;
}

function searchableText(message: UiMessage): string | undefined {
  if (message.deleted === true || message.text === undefined) {
    return undefined;
  }
  return message.text;
}

function matchIn(
  text: string,
  needle: string,
  chatId: string,
  message: UiMessage,
): SearchItem | null {
  const index = text.toLowerCase().indexOf(needle);
  if (index < 0) {
    return null;
  }
  const begin = codePointIndex(text, index);
  const hitLength = codePointIndex(text, index + needle.length) - begin;
  return {
    chatJid: chatId,
    messageId: message.id,
    senderName: message.senderName,
    at: message.createdAt.toISOString(),
    snippet: snippetFor(text, begin, hitLength),
    marks: marksFor(begin, hitLength),
  };
}

// The server's `ts_headline` returns one fragment around the hit; the mock
// mirrors it with a window so long mock bodies stay one short line.
const SNIPPET_BEFORE = 60;
const SNIPPET_AFTER = 90;

function snippetFor(text: string, begin: number, hitLength: number): string {
  const chars = [...text];
  const start = Math.max(0, begin - SNIPPET_BEFORE);
  const end = Math.min(chars.length, begin + hitLength + SNIPPET_AFTER);
  return chars.slice(start, end).join('');
}

function marksFor(begin: number, hitLength: number): Array<[number, number]> {
  const start = Math.max(0, begin - SNIPPET_BEFORE);
  return [[begin - start, begin - start + hitLength]];
}

function searchMessages(input: MockSearchInput) {
  const q = input.q.trim();
  if (q.length < 2 || q.length > 100) {
    throw new SearchApiError(400, 'invalid_request', 'Invalid search query');
  }
  const limit = input.limit === undefined ? 20 : Math.max(1, Math.min(50, input.limit));
  const beforeTime =
    input.before === undefined || input.before === '' ? null : Date.parse(input.before);
  const needle = q.toLowerCase();

  const items: SearchItem[] = [];
  for (const [chatId, messages] of Object.entries(mockMessagesByChat)) {
    if (input.chat !== undefined && input.chat !== '' && input.chat !== chatId) {
      continue;
    }
    for (const message of messages) {
      const text = searchableText(message);
      if (text === undefined) {
        continue;
      }
      const at = message.createdAt;
      if (beforeTime !== null && !Number.isNaN(beforeTime) && at.getTime() >= beforeTime) {
        continue;
      }
      const hit = matchIn(text, needle, chatId, message);
      if (hit !== null) {
        items.push(hit);
      }
    }
  }
  // The seeded topic rows carry their own last message (not in
  // `mockMessagesByChat`); they are searchable through it, like every chat.
  for (const chat of mockChats) {
    const last = chat.lastMessage;
    if (last === undefined || mockMessagesByChat[chat.id] !== undefined) {
      continue;
    }
    if (input.chat !== undefined && input.chat !== '' && input.chat !== chat.id) {
      continue;
    }
    const text = searchableText(last);
    if (text === undefined) {
      continue;
    }
    if (
      beforeTime !== null &&
      !Number.isNaN(beforeTime) &&
      last.createdAt.getTime() >= beforeTime
    ) {
      continue;
    }
    const hit = matchIn(text, needle, chat.id, last);
    if (hit !== null) {
      items.push(hit);
    }
  }
  items.sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));
  const page = items.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page,
    ...(last === undefined || items.length <= limit ? {} : { nextBefore: last.at }),
  };
}

/** A `SearchApi` backed by the mock messages, for offline UI work. */
export function createMockSearchApi(): SearchApi {
  return {
    async searchMessages(input) {
      if (input.signal?.aborted === true) {
        throw new DOMException('Aborted', 'AbortError');
      }
      return searchMessages(input);
    },
  };
}
