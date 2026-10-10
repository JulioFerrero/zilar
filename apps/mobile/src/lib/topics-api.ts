import { Exit, Schema } from 'effect';
import {
  ApiError,
  omitUndefined,
  runApi,
  Topic as TopicSchema,
  trimTopicText,
  type Topic as ContractTopic,
} from '@zilar/api-contract';
import type { TopicKind, TopicOwner, TopicStatus, TopicVisibility } from '@zilar/chat-core';

import { createApiClient } from './effect/api-client';

/**
 * The mobile twin of the web topics client (`apps/web/src/lib/api.ts`): list,
 * create and patch topics, read members, plus the group's
 * `membersCanCreateTopics` switch, as a Promise port over the client derived
 * from the shared contract (`@zilar/api-contract`, `topics.ts`, T-0892). The
 * contract reads an unknown enum value as a safe default (a mid-rollout server
 * can send a kind the bundle does not know), and `parseTopic` drops malformed
 * rows, never rendered.
 */

export type { TopicKind, TopicStatus, TopicVisibility, TopicOwner };

export interface TopicAi {
  id: string;
  name: string;
}

export interface Topic {
  id: string;
  groupId: string;
  name: string;
  glyph: string;
  chatJid: string;
  visibility: TopicVisibility;
  kind: TopicKind;
  status: TopicStatus;
  owner: TopicOwner | null;
  linkUrl: string | null;
  linkLabel: string | null;
  isGeneral: boolean;
  archived: boolean;
  memberCount: number;
  ais: TopicAi[];
  // T-0116: roles with access and the approver role. Absent on payloads from
  // an older server (treated as none); never stale, the store replaces them
  // on every topic refresh (going public clears them server-side too).
  roles: TopicRole[];
  approverRole: ApproverRole | null;
}

export interface TopicMember {
  userId: string;
  name: string;
}

/** A custom group role attached to a topic, with its holder count (T-0116). */
export interface TopicRole {
  id: string;
  name: string;
  memberCount: number;
}

/** The role whose holders may decide approval cards in this topic (T-0116). */
export interface ApproverRole {
  id: string;
  name: string;
}

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

/** Replaces a private topic's roles and picks its approver role (T-0116). */
export interface SetTopicRolesInput {
  roleIds: string[];
  approverRoleId: string | null;
}

export interface TopicsApi {
  createTopic(groupId: string, input: CreateTopicInput): Promise<Topic>;
  getTopic(id: string): Promise<Topic>;
  patchTopic(id: string, input: PatchTopicInput): Promise<Topic>;
  archiveTopic(id: string): Promise<Topic>;
  listTopicMembers(id: string): Promise<TopicMember[]>;
  addTopicMember(id: string, userId: string): Promise<Topic>;
  removeTopicMember(id: string, userId: string): Promise<Topic>;
  listTopicAis(id: string): Promise<TopicAi[]>;
  addTopicAi(id: string, aiId: string): Promise<Topic>;
  removeTopicAi(id: string, aiId: string): Promise<Topic>;
  setTopicRoles(id: string, input: SetTopicRolesInput): Promise<Topic>;
  setMembersCanCreateTopics(groupId: string, allowed: boolean): Promise<boolean>;
}

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const TopicsApiError = ApiError;
export type TopicsApiError = ApiError;

/** Unknown kinds fall back to `chat`, so a newer server never breaks the list. */
export function parseTopicKind(value: unknown): TopicKind {
  if (
    value === 'chat' ||
    value === 'task' ||
    value === 'bug' ||
    value === 'ui' ||
    value === 'routine'
  ) {
    return value;
  }
  return 'chat';
}

/** Unknown statuses fall back to `open`, always with their text (never color alone). */
export function parseTopicStatus(value: unknown): TopicStatus {
  if (
    value === 'open' ||
    value === 'in_progress' ||
    value === 'in_review' ||
    value === 'blocked' ||
    value === 'done'
  ) {
    return value;
  }
  return 'open';
}

/** Unknown visibilities are treated as private: hiding is safer than leaking. */
export function parseTopicVisibility(value: unknown): TopicVisibility {
  if (value === 'public' || value === 'private') {
    return value;
  }
  return 'private';
}
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

/**
 * The topics of one `/api/chats` group entry: entries that parse as topics
 * are kept (malformed ones dropped); an older server omits `topics` entirely,
 * so the result is empty for it and the group keeps its single legacy row.
 */
export function chatEntryTopics(entry: unknown): Topic[] {
  const rows =
    typeof entry === 'object' && entry !== null && 'topics' in entry
      ? (entry as { readonly topics: unknown }).topics
      : undefined;
  if (!Array.isArray(rows)) {
    return [];
  }
  const topics: Topic[] = [];
  for (const raw of rows) {
    const topic = parseTopic(raw);
    if (topic !== null) {
      topics.push(topic);
    }
  }
  return topics;
}

/** The production `TopicsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createTopicsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): TopicsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    // The server trims `name`, `linkUrl` and `linkLabel`; the contract encodes the trimmed form.
    createTopic: (groupId, input) =>
      runApi(
        client.topics.create({
          params: { id: groupId },
          payload: omitUndefined(trimTopicText(input)),
        }),
      ).then(toTopic),
    getTopic: (id) => runApi(client.topics.detail({ params: { id } })).then(toTopic),
    patchTopic: (id, input) =>
      runApi(
        client.topics.patch({ params: { id }, payload: omitUndefined(trimTopicText(input)) }),
      ).then(toTopic),
    archiveTopic: (id) => runApi(client.topics.archive({ params: { id } })).then(toTopic),
    listTopicMembers: (id) =>
      runApi(client.topics.members({ params: { id } })).then(({ members }) => members),
    addTopicMember: (id, userId) =>
      runApi(client.topics.addMember({ params: { id }, payload: { userId } })).then(toTopic),
    removeTopicMember: (id, userId) =>
      runApi(client.topics.removeMember({ params: { id, userId } })).then(toTopic),
    listTopicAis: (id) => runApi(client.topics.listAis({ params: { id } })).then(({ ais }) => ais),
    addTopicAi: (id, aiId) =>
      runApi(client.topics.addAi({ params: { id }, payload: { aiId } })).then(toTopic),
    removeTopicAi: (id, aiId) =>
      runApi(client.topics.removeAi({ params: { id, aiId } })).then(toTopic),
    setTopicRoles: (id, input) =>
      runApi(client.topics.setRoles({ params: { id }, payload: input })).then(toTopic),
    // The switch lives on the group (`PATCH /api/groups/:id`, the groups part
    // of the contract); an absent flag reads as off.
    setMembersCanCreateTopics: (groupId, allowed) =>
      runApi(
        client.groups.patch({
          params: { id: groupId },
          payload: { membersCanCreateTopics: allowed },
        }),
      ).then((group) => group.membersCanCreateTopics === true),
  };
}

/** The first glyph letter, uppercased, for a new topic the user just named. */
export function glyphForTopicName(name: string): string {
  const first = [...name.trim()][0] ?? 'G';
  return first.toUpperCase();
}
