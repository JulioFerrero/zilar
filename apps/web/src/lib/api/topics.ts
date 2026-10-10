// effect-plain: moved unchanged from apps/web/src/lib/api.ts (size split)
import {
  omitUndefined,
  Topic as topicSchema,
  trimTopicText,
  type ApproverRole,
  type ToolListItem,
  type Topic,
  type TopicAi,
  type TopicKind,
  type TopicMember,
  type TopicOwner,
  type TopicRole,
  type TopicStatus,
  type TopicVisibility,
} from '@zilar/api-contract';
import { callApi } from '@/lib/effect/api-client';

// --- Topics (T-0111) -------------------------------------------------------
// The wire contract lives in apps/server/src/topics/{routes,service,access}
// (T-0108/T-0109/T-0110). Only what the web UI shows is modelled here: list,
// create, patch (the strip, visibility, archive), members and AIs, plus the
// group's `membersCanCreateTopics` switch. A group entry in `/api/chats`
// carries its visible `topics` (archived excluded); older servers omit the
// field, and the store treats such a group exactly as before. A topic the
// viewer may not see is a 404 everywhere, byte-identical to a missing id.
// The schemas live in `@zilar/api-contract` (T-0892). T-0116: `roles` and
// `approverRole` are absent on older servers (treated as none). An unknown
// kind, status or visibility from a newer server reads as `chat`, `open` and
// `private`. `topicSchema` stays exported for the chat entries, which carry
// topic rows that are decoded one by one.
export { topicSchema };
export type {
  ApproverRole,
  Topic,
  TopicAi,
  TopicKind,
  TopicMember,
  TopicOwner,
  TopicRole,
  TopicStatus,
  TopicVisibility,
};

export interface CreateTopicInput {
  name: string;
  kind?: TopicKind;
  visibility?: TopicVisibility;
  memberIds?: string[];
  glyph?: string;
  owner?: { kind: 'user' | 'ai'; id: string } | null;
  linkUrl?: string | null;
  linkLabel?: string | null;
}

export interface PatchTopicInput {
  name?: string;
  glyph?: string;
  kind?: TopicKind;
  status?: TopicStatus;
  owner?: { kind: 'user' | 'ai'; id: string } | null;
  linkUrl?: string | null;
  linkLabel?: string | null;
  archived?: true;
  visibility?: TopicVisibility;
  memberIds?: string[];
  confirmExposeHistory?: boolean;
}

export function listGroupTopics(groupId: string): Promise<Topic[]> {
  return callApi((client) => client.topics.list({ params: { id: groupId } })).then(
    ({ topics }) => topics,
  );
}

export function createTopic(groupId: string, input: CreateTopicInput): Promise<Topic> {
  return callApi((client) =>
    client.topics.create({
      params: { id: groupId },
      payload: omitUndefined(trimTopicText(input)),
    }),
  );
}

export function getTopic(id: string): Promise<Topic> {
  return callApi((client) => client.topics.detail({ params: { id } }));
}

export function patchTopic(id: string, input: PatchTopicInput): Promise<Topic> {
  return callApi((client) =>
    client.topics.patch({ params: { id }, payload: omitUndefined(trimTopicText(input)) }),
  );
}

export function archiveTopic(id: string): Promise<Topic> {
  return callApi((client) => client.topics.archive({ params: { id } }));
}

export function listTopicMembers(id: string): Promise<TopicMember[]> {
  return callApi((client) => client.topics.members({ params: { id } })).then(
    ({ members }) => members,
  );
}

export function addTopicMember(id: string, userId: string): Promise<Topic> {
  return callApi((client) => client.topics.addMember({ params: { id }, payload: { userId } }));
}

export function removeTopicMember(id: string, userId: string): Promise<Topic> {
  return callApi((client) => client.topics.removeMember({ params: { id, userId } }));
}

export function listTopicAis(id: string): Promise<TopicAi[]> {
  return callApi((client) => client.topics.listAis({ params: { id } })).then(({ ais }) => ais);
}

export function addTopicAi(id: string, aiId: string): Promise<Topic> {
  return callApi((client) => client.topics.addAi({ params: { id }, payload: { aiId } }));
}

export function removeTopicAi(id: string, aiId: string): Promise<Topic> {
  return callApi((client) => client.topics.removeAi({ params: { id, aiId } }));
}

export interface SetTopicRolesInput {
  roleIds: string[];
  approverRoleId: string | null;
}

export function setTopicRoles(id: string, input: SetTopicRolesInput): Promise<Topic> {
  return callApi((client) => client.topics.setRoles({ params: { id }, payload: input }));
}

// Web UI helper for T-0111: the panel shows the rules of one topic, read
// through the existing per-group list (each row carries its `topicId`).
// Declared as a type alias (not a const) because the approval schemas are
// defined further below in this file.
export type TopicTool = ToolListItem;

export async function listTopicTools(topicId: string): Promise<TopicTool[]> {
  const rows = await callApi((client) => client.tools.listForTopic({ params: { id: topicId } }));
  return [...rows];
}
