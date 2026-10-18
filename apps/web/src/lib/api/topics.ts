// The topics part of the web API client: the calls themselves live in
// `@zilar/client-core` (`topics-api.ts`, T-2048), over `callApi`. This module
// keeps the names and types web has always imported.
import {
  Topic as topicSchema,
  type ApproverRole,
  type Topic as ContractTopic,
  type TopicAi,
  type TopicMember,
  type TopicRole,
  type TopicVisibility,
} from '@zilar/api-contract';
import {
  makeTopicsApi,
  type CreateTopicInput,
  type PatchTopicInput,
  type SetTopicRolesInput,
  type TopicTool,
} from '@zilar/client-core';
import { callApi } from '@/lib/effect/api-client';

export { topicSchema };
export type { ApproverRole, TopicAi, TopicMember, TopicRole, TopicVisibility };
export type { CreateTopicInput, PatchTopicInput, SetTopicRolesInput, TopicTool };
export type Topic = ContractTopic;

const api = makeTopicsApi(callApi);
export const {
  addTopicAi,
  addTopicMember,
  archiveTopic,
  createTopic,
  getTopic,
  getTopicPreview,
  joinTopic,
  listGroupTopics,
  listTopicAis,
  listTopicMembers,
  listTopicTools,
  patchTopic,
  removeTopicAi,
  removeTopicMember,
  setTopicRoles,
} = api;
