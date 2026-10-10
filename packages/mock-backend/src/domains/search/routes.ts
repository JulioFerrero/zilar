// The mock search route (`GET /search`), answering the contract's `SearchPage`
// from the message seed. The rules match web's old `searchMessages`
// (`apps/web/src/mock/api.ts:4152`): a trimmed 2..100 character query,
// case-insensitive substring matching over text bodies only, newest first, with
// one code-point mark per hit. Reaction, correction and retraction stanzas are
// not messages, and deleted messages carry no body, so none are searchable.
//
// The cursor is the contract's numeric epoch-ms `before` (`SearchQuery`), like
// the real server: `nextBefore` is the oldest returned timestamp in ms.
import type { SearchItem, SearchMark, SearchPage } from '@zilar/api-contract';
import type { ChatMessage } from '@zilar/xmpp-core';
import type { MockData } from '../../state';
import { jsonResponse, type MockHttpRequest } from '../../http/shared';

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function handleSearch(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments.length !== 1 || request.segments[0] !== 'search') {
    return undefined;
  }
  if (request.method !== 'GET') {
    return undefined;
  }
  const q = (request.query.get('q') ?? '').trim();
  if (q.length < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH) {
    return jsonResponse(
      { error: { code: 'invalid_request', message: 'Invalid search query' } },
      400,
    );
  }

  const chat = request.query.get('chat');
  const limit = limitOf(request.query.get('limit'));
  const before = beforeOf(request.query.get('before'));
  const names = namesByJid(data);
  const needle = q.toLowerCase();

  const items: SearchItem[] = [];
  for (const [chatJid, messages] of Object.entries(data.messages)) {
    if (chat !== null && chat !== '' && chat !== chatJid) {
      continue;
    }
    for (const message of messages) {
      const body = searchableBody(message);
      if (body === undefined) {
        continue;
      }
      const index = body.toLowerCase().indexOf(needle);
      if (index < 0) {
        continue;
      }
      if (before !== null && message.timestamp.getTime() >= before) {
        continue;
      }
      const begin = codePointIndex(body, index);
      const marks: SearchMark[] = [[begin, begin + [...needle].length]];
      items.push({
        chatJid,
        messageId: message.id,
        senderName: senderNameOf(message, data, names),
        at: message.timestamp.toISOString(),
        snippet: body,
        marks,
      });
    }
  }

  items.sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));
  const page = items.slice(0, limit);
  const last = page.at(-1);
  const nextBefore =
    last === undefined || items.length <= limit ? undefined : String(Date.parse(last.at));
  const body: SearchPage = {
    items: page,
    ...(nextBefore === undefined ? {} : { nextBefore }),
  };
  return jsonResponse(body);
}

// A message is searchable only when it renders as a text bubble. A correction
// or retraction edits another message; a body-less reaction update only changes
// chips; a deleted message has no body.
function searchableBody(message: ChatMessage): string | undefined {
  if (message.correction !== undefined || message.retraction !== undefined) {
    return undefined;
  }
  if (
    message.reactions !== undefined &&
    message.body === undefined &&
    message.payload === undefined
  ) {
    return undefined;
  }
  return message.body;
}

function namesByJid(data: MockData): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const person of data.people) {
    names.set(person.jid, person.name);
  }
  names.set(data.me.jid, data.me.name);
  return names;
}

function senderNameOf(
  message: ChatMessage,
  data: MockData,
  names: ReadonlyMap<string, string>,
): string {
  if (message.outgoing) {
    return data.me.name;
  }
  return names.get(message.fromJid) ?? message.fromJid.slice(0, message.fromJid.indexOf('@'));
}

function limitOf(raw: string | null): number {
  if (raw === null) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(parsed)));
}

function beforeOf(raw: string | null): number | null {
  if (raw === null || raw === '') {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

// `String.indexOf` counts UTF-16 units; the contract's marks count characters.
function codePointIndex(text: string, utf16Index: number): number {
  let count = 0;
  for (const _ of text.slice(0, utf16Index)) {
    count += 1;
  }
  return count;
}
