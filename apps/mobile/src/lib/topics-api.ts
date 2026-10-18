import { Exit, Schema } from 'effect';
import {
  ApiError,
  runApi,
  Topic as TopicSchema,
  type Topic as ContractTopic,
  type TopicAi,
  type TopicMember,
  type TopicPreviewMessage,
} from '@zilar/api-contract';
import {
  makeTopicsApi,
  type CreateTopicInput,
  type PatchTopicInput,
  type SetTopicRolesInput,
  type Topic,
} from '@zilar/client-core';

import { createApiClient } from './effect/api-client';

// The phone's port over the shared topics API (`@zilar/client-core`, T-2048):
// bearer auth and `fetch` in, `TopicsApi` out; `parseTopic` drops malformed
// rows, never rendered.

export type { TopicVisibility } from '@zilar/chat-core';
export type {
  ApproverRole,
  TopicAi,
  TopicMember,
  TopicPreviewMessage,
  TopicRole,
} from '@zilar/api-contract';
export type { CreateTopicInput, PatchTopicInput, SetTopicRolesInput, Topic };

export interface TopicsApi {
  createTopic(groupId: string, input: CreateTopicInput): Promise<Topic>;
  getTopic(id: string): Promise<Topic>;
  patchTopic(id: string, input: PatchTopicInput): Promise<Topic>;
  archiveTopic(id: string): Promise<Topic>;
  listTopicMembers(id: string): Promise<TopicMember[]>;
  addTopicMember(id: string, userId: string): Promise<Topic>;
  removeTopicMember(id: string, userId: string): Promise<Topic>;
  /** T-1760/T-1787: joins the caller to a public topic the group lists. */
  joinTopic(id: string): Promise<Topic>;
  /** T-1798: the recent messages of a public topic, oldest first. */
  topicPreview(id: string): Promise<TopicPreviewMessage[]>;
  listTopicAis(id: string): Promise<TopicAi[]>;
  addTopicAi(id: string, aiId: string): Promise<Topic>;
  removeTopicAi(id: string, aiId: string): Promise<Topic>;
  setTopicRoles(id: string, input: SetTopicRolesInput): Promise<Topic>;
  setMembersCanCreateTopics(groupId: string, allowed: boolean): Promise<boolean>;
}

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const TopicsApiError = ApiError;
export type TopicsApiError = ApiError;

/** The port's topic: the absent `roles` and `approverRole` of an older server read as none. */
function toTopic(value: ContractTopic): Topic {
  return {
    ...value,
    roles: value.roles ?? [],
    approverRole: value.approverRole ?? null,
  };
}

/** A topic row the viewer may see: malformed rows return null and are dropped. */
export function parseTopic(value: unknown): Topic | null {
  const decoded = Schema.decodeUnknownExit(TopicSchema)(value);
  return Exit.isSuccess(decoded) ? toTopic(decoded.value) : null;
}

/** The production `TopicsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createTopicsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): TopicsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return makeTopicsApi((call) => runApi(call(client)));
}
