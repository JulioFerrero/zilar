import type { ChatEntry } from '@zilar/api-contract';
import type { MockMessage } from '../../data';
import type { MockData } from '../../state';
import { jsonResponse, noContent, type MockHttpRequest } from '../../http/shared';
import { groupTopicViews } from '../topics/view';

/**
 * `GET /chats`: the seed's entries with each group's live topic rows attached,
 * `PUT /chats/:jid/delivered` (T-1238): the receiving device's delivery
 * confirmation, and `PUT /chats/:jid/read` (T-1248): the read mark, which
 * clears the chat's hand-set unread pref like the server. The mock keeps no
 * delivery state; both writes answer 204 so mock mode logs no errors.
 * `DELETE /chats/:jid/history` and `DELETE /chats/:jid/messages/:archiveId`
 * (T-1247): clear a DM's own copy or drop one message from it, answering 204.
 */
export function handleChats(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments[0] !== 'chats') {
    return undefined;
  }
  if (request.segments.length === 1 && request.method === 'GET') {
    return jsonResponse({ chats: data.chats.map((entry) => withTopics(data, entry)) });
  }
  const jid = request.segments[1];
  if (
    request.segments.length === 3 &&
    jid !== undefined &&
    request.segments[2] === 'delivered' &&
    request.method === 'PUT'
  ) {
    return noContent();
  }
  if (
    request.segments.length === 3 &&
    jid !== undefined &&
    request.segments[2] === 'read' &&
    request.method === 'PUT'
  ) {
    clearUnreadMark(data, decodeURIComponent(jid));
    return noContent();
  }
  if (jid !== undefined && request.method === 'DELETE') {
    if (request.segments.length === 3 && request.segments[2] === 'history') {
      dropThread(data, decodeURIComponent(jid));
      return noContent();
    }
    const archiveId = request.segments[3];
    if (
      request.segments.length === 4 &&
      request.segments[2] === 'messages' &&
      archiveId !== undefined
    ) {
      dropMessage(data, decodeURIComponent(jid), decodeURIComponent(archiveId));
      return noContent();
    }
  }
  return undefined;
}

/** T-1248: a read mark clears the caller's hand-set unread pref, like the server. */
function clearUnreadMark(data: MockData, chatJid: string): void {
  const pref = data.findChatPref(chatJid);
  if (pref === undefined || pref.unreadMark !== true) {
    return;
  }
  data.putChatPref({ ...pref, unreadMark: false, updatedAt: new Date().toISOString() });
}

// `data.messages` is the messages domain's live getter over the seed's own map
// (`domains/messages/state.ts:12`), so writing to it in place would mutate the
// shared seed and leak across `reset()`. Drop rows by swapping in a private map
// and repointing `appendMessage` (the fake XMPP's write path) at it, the same
// replace-not-mutate move `appendMessage` itself makes (`state.ts:16`).
function replaceThreads(
  data: MockData,
  update: (
    threads: Readonly<Record<string, readonly MockMessage[]>>,
  ) => Readonly<Record<string, readonly MockMessage[]>>,
): void {
  let table = update(data.messages);
  Object.defineProperty(data, 'messages', {
    get: () => table,
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(data, 'appendMessage', {
    value: (chatJid: string, message: MockMessage): void => {
      table = { ...table, [chatJid]: [...(table[chatJid] ?? []), message] };
    },
    enumerable: true,
    configurable: true,
  });
}

function dropThread(data: MockData, chatJid: string): void {
  replaceThreads(data, (threads) => ({ ...threads, [chatJid]: [] }));
}

function dropMessage(data: MockData, chatJid: string, archiveId: string): void {
  replaceThreads(data, (threads) => {
    const thread = threads[chatJid];
    return thread === undefined
      ? { ...threads }
      : { ...threads, [chatJid]: thread.filter((message) => message.id !== archiveId) };
  });
}

/**
 * A group's `topics` is rebuilt from the live topics table, so a topic created
 * or archived through `/groups/:id/topics` shows up here right away. Every
 * seeded group has its General row there (T-1090); a group with no live topics
 * (one joined from the directory) keeps the seed entry without them.
 */
function withTopics(data: MockData, entry: ChatEntry): ChatEntry {
  if (entry.kind !== 'group') {
    return entry;
  }
  // T-1355: a channel's General row is its feed, not a listed topic, so a
  // channel answers the entry alone (no topic tree), like the real server.
  if (entry.chatKind === 'channel') {
    return { ...entry, topics: [] };
  }
  const topics = groupTopicViews(data, entry.groupId);
  return topics.length === 0 ? entry : { ...entry, topics };
}
