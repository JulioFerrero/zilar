// The topics routes (T-0943): `/groups/:id/topics` lists and creates, and
// `/topics/:id` reads, patches, archives, and manages members, AIs and roles —
// the mutations web's mock serves (`topicToView`/`patchMockTopic`/topic ranges).
// A missing or archived topic answers the same 404 everywhere.
import type { MockData } from '../../state';
import {
  badRequest,
  jsonResponse,
  notFound,
  readJsonBody,
  type MockHttpRequest,
} from '../../http/shared';
import type { MockTopic, MockTopicOwner, TopicKind, TopicStatus } from './tables';
import { groupTopicViews, topicView } from './view';

const TOPIC_NOT_FOUND = 'Topic not found';
const TOPIC_NAME_MAX = 80;
const TOPIC_LINK_LABEL_MAX = 40;

const TOPIC_KINDS: readonly TopicKind[] = ['chat', 'task', 'bug', 'ui', 'routine'];
const TOPIC_STATUSES: readonly TopicStatus[] = [
  'open',
  'in_progress',
  'in_review',
  'blocked',
  'done',
];

export function handleTopics(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments[0] === 'groups' && request.segments[2] === 'topics') {
    return handleGroupTopics(data, request);
  }
  if (request.segments[0] !== 'topics') {
    return undefined;
  }
  const id = request.segments[1];
  if (id === undefined) {
    return undefined;
  }
  const topic = data.findTopic(decodeURIComponent(id));
  if (topic === undefined || topic.archived) {
    return notFound(TOPIC_NOT_FOUND);
  }
  const sub = request.segments[2];
  const subId = request.segments[3];
  if (sub === undefined) {
    if (request.method === 'GET') return jsonResponse(topicView(data, topic));
    if (request.method === 'PATCH') return patchTopic(data, topic, request);
    return undefined;
  }
  if (sub === 'archive' && request.method === 'POST') return archiveTopic(data, topic);
  if (sub === 'members') return handleTopicMembers(data, topic, subId, request);
  if (sub === 'ais') return handleTopicAis(data, topic, subId, request);
  if (sub === 'roles' && request.method === 'PUT') return setTopicRoles(data, topic, request);
  return undefined;
}

function handleGroupTopics(data: MockData, request: MockHttpRequest): Response | undefined {
  const groupId = decodeURIComponent(request.segments[1] ?? '');
  if (data.findGroup(groupId) === undefined) {
    return notFound('Group not found');
  }
  if (request.method === 'GET') {
    return jsonResponse({ topics: groupTopicViews(data, groupId) });
  }
  if (request.method === 'POST') {
    return createTopic(data, groupId, request);
  }
  return undefined;
}

function createTopic(data: MockData, groupId: string, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, TOPIC_NAME_MAX) : '';
  if (name === '') {
    return badRequest('invalid_request', 'name is required');
  }
  const visibility = body.visibility === 'private' ? 'private' : 'public';
  const id = data.nextTopicId();
  const created: MockTopic = {
    id,
    groupId,
    name,
    glyph: typeof body.glyph === 'string' && body.glyph !== '' ? body.glyph : glyphForTopic(name),
    chatJid: `${id}@rooms.zilar.test`,
    visibility,
    kind: isTopicKind(body.kind) ? body.kind : 'chat',
    status: 'open',
    owner: readOwner(data, body.owner) ?? null,
    linkUrl: typeof body.linkUrl === 'string' ? body.linkUrl : null,
    linkLabel:
      typeof body.linkLabel === 'string' ? body.linkLabel.slice(0, TOPIC_LINK_LABEL_MAX) : null,
    isGeneral: false,
    archived: false,
    memberIds:
      visibility === 'private' ? unique([data.me.id, ...readStringArray(body.memberIds)]) : [],
    aiIds: [],
    roleIds: [],
    approverRoleId: null,
  };
  data.putTopic(created);
  return jsonResponse(topicView(data, created), 201);
}

function patchTopic(data: MockData, topic: MockTopic, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  let updated = topic;
  if (typeof body.name === 'string' && body.name.trim() !== '') {
    updated = { ...updated, name: body.name.trim().slice(0, TOPIC_NAME_MAX) };
  }
  if (typeof body.glyph === 'string' && body.glyph !== '') {
    updated = { ...updated, glyph: body.glyph };
  }
  if (isTopicKind(body.kind)) updated = { ...updated, kind: body.kind };
  if (isTopicStatus(body.status)) updated = { ...updated, status: body.status };
  const owner = readOwner(data, body.owner);
  if (owner !== undefined) updated = { ...updated, owner };
  if (body.linkUrl === null) {
    updated = { ...updated, linkUrl: null };
  } else if (typeof body.linkUrl === 'string') {
    updated = { ...updated, linkUrl: body.linkUrl };
  }
  if (body.linkLabel === null) {
    updated = { ...updated, linkLabel: null };
  } else if (typeof body.linkLabel === 'string') {
    updated = { ...updated, linkLabel: body.linkLabel.slice(0, TOPIC_LINK_LABEL_MAX) };
  }
  if (body.archived === true) {
    if (updated.isGeneral) {
      return badRequest('invalid_request', 'General cannot be archived');
    }
    updated = { ...updated, archived: true };
  }
  if (body.visibility === 'public' && updated.visibility === 'private') {
    if (body.confirmExposeHistory !== true) {
      return badRequest('confirmation_required', 'Confirm exposing the history');
    }
    updated = { ...updated, visibility: 'public', memberIds: [] };
  } else if (body.visibility === 'private' && updated.visibility === 'public') {
    updated = {
      ...updated,
      visibility: 'private',
      memberIds: unique([data.me.id, ...readStringArray(body.memberIds)]),
    };
  }
  data.putTopic(updated);
  return jsonResponse(topicView(data, updated));
}

function archiveTopic(data: MockData, topic: MockTopic): Response {
  if (topic.isGeneral) {
    return badRequest('invalid_request', 'General cannot be archived');
  }
  const updated = { ...topic, archived: true };
  data.putTopic(updated);
  return jsonResponse(topicView(data, updated));
}

function handleTopicMembers(
  data: MockData,
  topic: MockTopic,
  subId: string | undefined,
  request: MockHttpRequest,
): Response | undefined {
  if (subId === undefined) {
    if (request.method === 'GET') return jsonResponse({ members: topicMembers(data, topic) });
    if (request.method === 'POST') return addTopicMember(data, topic, request);
    return undefined;
  }
  if (request.method !== 'DELETE') {
    return undefined;
  }
  const userId = decodeURIComponent(subId);
  if (!topic.memberIds.includes(userId)) {
    return notFound('That user is not a member of this topic');
  }
  const memberIds = topic.memberIds.filter((id) => id !== userId);
  const archived = memberIds.length === 0 && topic.visibility === 'private' ? true : topic.archived;
  if (archived) {
    data.putTopic({ ...topic, memberIds, archived });
    return notFound(TOPIC_NOT_FOUND);
  }
  const updated = { ...topic, memberIds, archived };
  data.putTopic(updated);
  return jsonResponse(topicView(data, updated));
}

function addTopicMember(data: MockData, topic: MockTopic, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const userId = typeof body.userId === 'string' ? body.userId : '';
  const memberIds =
    userId !== '' && !topic.memberIds.includes(userId)
      ? [...topic.memberIds, userId]
      : [...topic.memberIds];
  const updated = { ...topic, memberIds };
  data.putTopic(updated);
  return jsonResponse(topicView(data, updated));
}

function handleTopicAis(
  data: MockData,
  topic: MockTopic,
  subId: string | undefined,
  request: MockHttpRequest,
): Response | undefined {
  if (subId === undefined) {
    if (request.method === 'GET') {
      return jsonResponse({
        ais: topic.aiIds.map((aiId) => ({ id: aiId, name: aiName(data, aiId) })),
      });
    }
    if (request.method === 'POST') return addTopicAi(data, topic, request);
    return undefined;
  }
  if (request.method !== 'DELETE') {
    return undefined;
  }
  const aiId = decodeURIComponent(subId);
  const updated = { ...topic, aiIds: topic.aiIds.filter((id) => id !== aiId) };
  data.putTopic(updated);
  return jsonResponse(topicView(data, updated));
}

function addTopicAi(data: MockData, topic: MockTopic, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const aiId = typeof body.aiId === 'string' ? body.aiId : '';
  if (aiId === '' || !data.ais.some((ai) => ai.id === aiId)) {
    return badRequest('invalid_request', 'Unknown AI');
  }
  const aiIds = topic.aiIds.includes(aiId) ? [...topic.aiIds] : [...topic.aiIds, aiId];
  const updated = { ...topic, aiIds };
  data.putTopic(updated);
  return jsonResponse(topicView(data, updated));
}

// Roles attach only to a private, non-General topic, and only roles that belong
// to the topic's group count (T-0116).
function setTopicRoles(data: MockData, topic: MockTopic, request: MockHttpRequest): Response {
  if (topic.visibility !== 'private' || topic.isGeneral) {
    return badRequest('not_private', 'Only private topics have roles');
  }
  const body = readJsonBody(request.init);
  const roleIds = unique(readStringArray(body.roleIds));
  const rawApprover = body.approverRoleId;
  if (rawApprover !== null && rawApprover !== undefined && typeof rawApprover !== 'string') {
    return badRequest('invalid_request', 'approverRoleId must be a string or null');
  }
  const approverRoleId = typeof rawApprover === 'string' ? rawApprover : null;
  if (
    roleIds.some((roleId) => data.findGroupRole(roleId)?.groupId !== topic.groupId) ||
    (approverRoleId !== null && data.findGroupRole(approverRoleId)?.groupId !== topic.groupId)
  ) {
    return badRequest('invalid_request', 'Roles must belong to the topic\u2019s group');
  }
  const updated = { ...topic, roleIds, approverRoleId };
  data.putTopic(updated);
  return jsonResponse(topicView(data, updated));
}

function topicMembers(data: MockData, topic: MockTopic): { userId: string; name: string }[] {
  if (topic.visibility !== 'private') {
    const group = data.findGroup(topic.groupId);
    return (group?.members ?? []).map((member) => ({
      userId: member.userId,
      name: member.name,
    }));
  }
  return topic.memberIds.map((userId) => ({ userId, name: personName(data, userId) }));
}

function readOwner(data: MockData, value: unknown): MockTopicOwner | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.kind !== 'user' && record.kind !== 'ai') return undefined;
  if (typeof record.id !== 'string') return undefined;
  return {
    kind: record.kind,
    id: record.id,
    name: record.kind === 'user' ? personName(data, record.id) : aiName(data, record.id),
  };
}

function isTopicKind(value: unknown): value is TopicKind {
  return typeof value === 'string' && (TOPIC_KINDS as readonly string[]).includes(value);
}

function isTopicStatus(value: unknown): value is TopicStatus {
  return typeof value === 'string' && (TOPIC_STATUSES as readonly string[]).includes(value);
}

function glyphForTopic(name: string): string {
  const first = [...name.trim()][0] ?? 'G';
  return first.toUpperCase();
}

function personName(data: MockData, userId: string): string {
  return data.people.find((person) => person.id === userId)?.name ?? 'Someone';
}

function aiName(data: MockData, aiId: string): string {
  return data.ais.find((ai) => ai.id === aiId)?.name ?? 'An AI';
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
