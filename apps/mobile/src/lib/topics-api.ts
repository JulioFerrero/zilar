import { Exit, Schema } from 'effect';
import {
  Topic as TopicSchema,
  type Topic as ContractTopic,
  type TopicAi,
  type TopicMember,
  type TopicPreviewMessage,
} from '@zilar/api-contract';
import {
  type CreateTopicInput,
  type PatchTopicInput,
  type SetTopicRolesInput,
  type Topic,
} from '@zilar/client-core';

// `parseTopic` drops malformed rows, never rendered.

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
  joinTopic(id: string): Promise<Topic>;
  topicPreview(id: string): Promise<TopicPreviewMessage[]>;
  listTopicAis(id: string): Promise<TopicAi[]>;
  addTopicAi(id: string, aiId: string): Promise<Topic>;
  removeTopicAi(id: string, aiId: string): Promise<Topic>;
  setTopicRoles(id: string, input: SetTopicRolesInput): Promise<Topic>;
  setMembersCanCreateTopics(groupId: string, allowed: boolean): Promise<boolean>;
}

function toTopic(value: ContractTopic): Topic {
  return {
    ...value,
    roles: value.roles ?? [],
    approverRole: value.approverRole ?? null,
  };
}

export function parseTopic(value: unknown): Topic | null {
  const decoded = Schema.decodeUnknownExit(TopicSchema)(value);
  return Exit.isSuccess(decoded) ? toTopic(decoded.value) : null;
}
