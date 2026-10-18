// effect-plain: Promise port over the contract; each app's `call` owns the
// Effect edge (T-2048).
// The shared topics calls: web and phone each supply a `call` that runs one
// contract request over their own transport, so endpoints and normalisation
// live once.
import type { Effect } from 'effect';
import {
  omitUndefined,
  trimTopicText,
  type ApproverRole,
  type ToolListItem,
  type Topic as ContractTopic,
  type TopicAi,
  type TopicMember,
  type TopicPreviewMessage,
  type TopicRole,
  type TopicVisibility,
  type ZilarClient,
} from '@zilar/api-contract';

/**
 * A topic as the apps use it: the contract row with `roles` and
 * `approverRole` always present (an older server omits them, read as none).
 */
export type Topic = Omit<ContractTopic, 'roles' | 'approverRole'> & {
  roles: TopicRole[];
  approverRole: ApproverRole | null;
};

export interface CreateTopicInput {
  name: string;
  visibility?: TopicVisibility;
  memberIds?: string[];
  glyph?: string;
  linkUrl?: string | null;
  linkLabel?: string | null;
}

export interface PatchTopicInput {
  name?: string;
  glyph?: string;
  linkUrl?: string | null;
  linkLabel?: string | null;
  archived?: true;
  visibility?: TopicVisibility;
  memberIds?: string[];
  confirmExposeHistory?: boolean;
  /** T-1521/T-1534: a person marks the topic done (`true`) or reopens it (`false`). */
  done?: boolean;
}

/** Replaces a private topic's roles and picks its approver role (T-0116). */
export interface SetTopicRolesInput {
  roleIds: string[];
  approverRoleId: string | null;
}

/** Web's topic-rules row: the per-group tools list carries each row's `topicId`. */
export type TopicTool = ToolListItem;

type TopicsCall = <A, E>(call: (client: ZilarClient) => Effect.Effect<A, E>) => Promise<A>;

function toTopic(value: ContractTopic): Topic {
  return { ...value, roles: value.roles ?? [], approverRole: value.approverRole ?? null };
}

/**
 * The topics API of both apps, over the caller's `call`. The server trims
 * `name`, `linkUrl` and `linkLabel`; every full topic response is normalised.
 */
export function makeTopicsApi(call: TopicsCall) {
  function topic<E>(
    request: (client: ZilarClient) => Effect.Effect<ContractTopic, E>,
  ): Promise<Topic> {
    return call(request).then(toTopic);
  }
  const getTopicPreview = (id: string): Promise<TopicPreviewMessage[]> =>
    call((c) => c.topics.preview({ params: { id } })).then(({ messages }) => messages);

  return {
    listGroupTopics: (groupId: string): Promise<Topic[]> =>
      call((c) => c.topics.list({ params: { id: groupId } })).then(({ topics }) =>
        topics.map(toTopic),
      ),
    createTopic: (groupId: string, input: CreateTopicInput) =>
      topic((c) =>
        c.topics.create({ params: { id: groupId }, payload: omitUndefined(trimTopicText(input)) }),
      ),
    getTopic: (id: string) => topic((c) => c.topics.detail({ params: { id } })),
    patchTopic: (id: string, input: PatchTopicInput) =>
      topic((c) =>
        c.topics.patch({ params: { id }, payload: omitUndefined(trimTopicText(input)) }),
      ),
    archiveTopic: (id: string) => topic((c) => c.topics.archive({ params: { id } })),
    listTopicMembers: (id: string): Promise<TopicMember[]> =>
      call((c) => c.topics.members({ params: { id } })).then(({ members }) => members),
    addTopicMember: (id: string, userId: string) =>
      topic((c) => c.topics.addMember({ params: { id }, payload: { userId } })),
    // T-1786: the caller joins a public topic themselves; General is rejected.
    joinTopic: (id: string) => topic((c) => c.topics.join({ params: { id } })),
    // T-1797: recent messages of an unjoined public topic, oldest first.
    getTopicPreview,
    /** The phone's name for `getTopicPreview`. */
    topicPreview: getTopicPreview,
    removeTopicMember: (id: string, userId: string) =>
      topic((c) => c.topics.removeMember({ params: { id, userId } })),
    listTopicAis: (id: string): Promise<TopicAi[]> =>
      call((c) => c.topics.listAis({ params: { id } })).then(({ ais }) => ais),
    addTopicAi: (id: string, aiId: string) =>
      topic((c) => c.topics.addAi({ params: { id }, payload: { aiId } })),
    removeTopicAi: (id: string, aiId: string) =>
      topic((c) => c.topics.removeAi({ params: { id, aiId } })),
    setTopicRoles: (id: string, input: SetTopicRolesInput) =>
      topic((c) => c.topics.setRoles({ params: { id }, payload: input })),
    // The switch lives on the group (`PATCH /api/groups/:id`); absent reads off.
    setMembersCanCreateTopics: (groupId: string, allowed: boolean): Promise<boolean> =>
      call((c) =>
        c.groups.patch({ params: { id: groupId }, payload: { membersCanCreateTopics: allowed } }),
      ).then((group) => group.membersCanCreateTopics === true),
    listTopicTools: (topicId: string): Promise<TopicTool[]> =>
      call((c) => c.tools.listForTopic({ params: { id: topicId } })).then((rows) => [...rows]),
  };
}
