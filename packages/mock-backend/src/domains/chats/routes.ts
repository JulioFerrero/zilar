import type { ChatEntry } from '@zilar/api-contract';
import type { MockData } from '../../state';
import { jsonResponse, type MockHttpRequest } from '../../http/shared';
import { groupTopicViews } from '../topics/view';

/** `GET /chats`: the seed's entries with each group's live topic rows attached. */
export function handleChats(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments.length !== 1 || request.segments[0] !== 'chats') {
    return undefined;
  }
  if (request.method !== 'GET') {
    return undefined;
  }
  return jsonResponse({ chats: data.chats.map((entry) => withTopics(data, entry)) });
}

/**
 * A group's `topics` is rebuilt from the live topics table, so a topic created
 * or archived through `/groups/:id/topics` shows up here right away. A group
 * with no topics keeps its single legacy row (the `summariesFor` fallback).
 */
function withTopics(data: MockData, entry: ChatEntry): ChatEntry {
  if (entry.kind !== 'group') {
    return entry;
  }
  const topics = groupTopicViews(data, entry.groupId);
  return topics.length === 0 ? entry : { ...entry, topics };
}
