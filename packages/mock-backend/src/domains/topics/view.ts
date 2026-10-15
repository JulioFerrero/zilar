// Builds the contract's `Topic` view from a live `MockTopic`. The view needs a
// little of the surrounding group, its roles and its AI names, so callers pass a
// `TopicViewSource`: the seed uses one built from the seed constants and the
// routes use one built from the merged `MockData`. The chats route uses
// `groupTopicViews` too, so `/chats` and `/groups/:id/topics` always agree.
import type { Topic } from '@zilar/api-contract';
import type { MockData } from '../../state';
import type { MockTopic } from './tables';

export interface TopicRoleSource {
  readonly id: string;
  readonly name: string;
  readonly memberIds: readonly string[];
}

export interface TopicViewSource {
  /** How many members the topic's group has (a public topic shows all of them). */
  groupMemberCount(groupId: string): number;
  role(roleId: string): TopicRoleSource | undefined;
  aiName(aiId: string): string;
  /** T-1537: the AI's bare JID, so the client can match its live card. */
  aiJid(aiId: string): string | undefined;
}

/** The contract `Topic` row of one topic, with `memberCount` and its roles. */
export function buildTopicView(topic: MockTopic, source: TopicViewSource): Topic {
  const roles = topic.roleIds
    .map((roleId) => source.role(roleId))
    .filter((role): role is TopicRoleSource => role !== undefined)
    .map((role) => ({ id: role.id, name: role.name, memberCount: role.memberIds.length }));
  const approver =
    topic.approverRoleId === null ? null : (source.role(topic.approverRoleId) ?? null);
  // T-1492: AIs count as members. A private topic adds the AIs it lists; a
  // public topic shows the whole group, people and AIs (see `groupMemberCount`).
  const memberCount =
    topic.visibility === 'private'
      ? new Set([
          ...topic.memberIds,
          ...topic.roleIds.flatMap((roleId) => source.role(roleId)?.memberIds ?? []),
        ]).size + topic.aiIds.length
      : source.groupMemberCount(topic.groupId);
  return {
    id: topic.id,
    groupId: topic.groupId,
    name: topic.name,
    glyph: topic.glyph,
    chatJid: topic.chatJid,
    visibility: topic.visibility,
    kind: topic.kind,
    status: topic.status,
    owner: topic.owner,
    linkUrl: topic.linkUrl,
    linkLabel: topic.linkLabel,
    isGeneral: topic.isGeneral,
    archived: topic.archived,
    doneAt: topic.doneAt ?? null,
    memberCount,
    ais: topic.aiIds.map((aiId) => ({ id: aiId, name: source.aiName(aiId) })),
    roles,
    approverRole: approver === null ? null : { id: approver.id, name: approver.name },
    // T-1514: the topic's AI activity, empty for an idle topic. T-1537: each
    // entry carries the AI's JID, resolved from the AI rows.
    activity: (topic.activity ?? []).map((entry) => {
      const jid = source.aiJid(entry.aiId);
      return {
        aiId: entry.aiId,
        name: entry.name,
        ...(jid === undefined ? {} : { jid }),
        ...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl }),
        ...(entry.questionId === undefined ? {} : { questionId: entry.questionId }),
        state: entry.state,
      };
    }),
  };
}

/** A view source over the live tables of the merged `MockData`. */
export function viewSourceFromData(data: MockData): TopicViewSource {
  return {
    groupMemberCount: (groupId) => {
      const group = data.findGroup(groupId);
      return (group?.members.length ?? 0) + (group?.ais.length ?? 0);
    },
    role: (roleId) => {
      const role = data.findGroupRole(roleId);
      return role === undefined
        ? undefined
        : { id: role.id, name: role.name, memberIds: role.memberIds };
    },
    aiName: (aiId) => data.ais.find((ai) => ai.id === aiId)?.name ?? 'An AI',
    aiJid: (aiId) => data.ais.find((ai) => ai.id === aiId)?.jid,
  };
}

/** One topic's view from the merged `MockData`. */
export function topicView(data: MockData, topic: MockTopic): Topic {
  return buildTopicView(topic, viewSourceFromData(data));
}

/**
 * The visible topics of one group, General first, exactly as `/chats` and
 * `/groups/:id/topics` both expect them.
 */
export function groupTopicViews(data: MockData, groupId: string): Topic[] {
  const source = viewSourceFromData(data);
  return data.topics
    .filter((topic) => topic.groupId === groupId && !topic.archived)
    .sort((a, b) => (a.isGeneral === b.isGeneral ? 0 : a.isGeneral ? -1 : 1))
    .map((topic) => buildTopicView(topic, source));
}
