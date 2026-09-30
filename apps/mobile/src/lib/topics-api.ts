import type { TopicKind, TopicOwner, TopicStatus, TopicVisibility } from '@galena/chat-core';

/**
 * The mobile twin of the web topics client (`apps/web/src/lib/api.ts`): list,
 * create and patch topics, read members, plus the group's
 * `membersCanCreateTopics` switch. The wire contract lives in
 * `apps/server/src/topics/{routes,service,access}` (T-0108/T-0109/T-0110).
 *
 * Mobile has no zod, so — like `chat-api.ts` — the boundary is validated with
 * type guards. Unknown enum values fall back safely (a mid-rollout server can
 * send a kind the bundle does not know), and malformed rows are dropped, never
 * rendered.
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
}

export interface TopicMember {
  userId: string;
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
  setMembersCanCreateTopics(groupId: string, allowed: boolean): Promise<boolean>;
}

export class TopicsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'TopicsApiError';
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isString(value) ? value : undefined;
}

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

function parseTopicOwner(value: unknown): TopicOwner | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const kind = value['kind'];
  const id = value['id'];
  const name = value['name'];
  if ((kind === 'user' || kind === 'ai') && isString(id) && isString(name)) {
    return { kind, id, name };
  }
  return undefined;
}

function parseTopicAi(value: unknown): TopicAi | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const name = value['name'];
  if (!isString(id) || !isString(name)) return null;
  return { id, name };
}

/** A topic row the viewer may see: malformed rows return null and are dropped. */
export function parseTopic(value: unknown): Topic | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const groupId = value['groupId'];
  const name = value['name'];
  const glyph = value['glyph'];
  const chatJid = value['chatJid'];
  const isGeneral = value['isGeneral'];
  const archived = value['archived'];
  const memberCount = value['memberCount'];
  const ais = value['ais'];
  if (
    !isString(id) ||
    !isString(groupId) ||
    !isString(name) ||
    !isString(glyph) ||
    !isString(chatJid) ||
    typeof isGeneral !== 'boolean' ||
    typeof archived !== 'boolean' ||
    typeof memberCount !== 'number' ||
    !Array.isArray(ais)
  ) {
    return null;
  }
  const owner = parseTopicOwner(value['owner']);
  const linkUrl = nullableString(value['linkUrl']);
  const linkLabel = nullableString(value['linkLabel']);
  if (owner === undefined || linkUrl === undefined || linkLabel === undefined) {
    return null;
  }
  const parsedAis: TopicAi[] = [];
  for (const entry of ais) {
    const ai = parseTopicAi(entry);
    if (ai === null) return null;
    parsedAis.push(ai);
  }
  return {
    id,
    groupId,
    name,
    glyph,
    chatJid,
    visibility: parseTopicVisibility(value['visibility']),
    kind: parseTopicKind(value['kind']),
    status: parseTopicStatus(value['status']),
    owner,
    linkUrl,
    linkLabel,
    isGeneral,
    archived,
    memberCount,
    ais: parsedAis,
  };
}

function parseTopicMember(value: unknown): TopicMember | null {
  if (!isRecord(value)) return null;
  const userId = value['userId'];
  const name = value['name'];
  if (!isString(userId) || !isString(name)) return null;
  return { userId, name };
}

/**
 * The topics of one `/api/chats` group entry: entries that parse as topics
 * are kept (malformed ones dropped); an older server omits `topics` entirely,
 * so the result is empty for it and the group keeps its single legacy row.
 */
export function chatEntryTopics(entry: unknown): Topic[] {
  if (!isRecord(entry) || !Array.isArray(entry['topics'])) {
    return [];
  }
  const topics: Topic[] = [];
  for (const raw of entry['topics']) {
    const topic = parseTopic(raw);
    if (topic !== null) {
      topics.push(topic);
    }
  }
  return topics;
}

async function request(
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  } catch {
    throw new TopicsApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new TopicsApiError(response.status, code, message);
  }
  return body;
}

/** The production `TopicsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createTopicsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): TopicsApi {
  const withToken = async (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> => {
    const token = await getToken();
    if (token === undefined) {
      throw new TopicsApiError(401, 'unauthorized', 'No session');
    }
    const body = await request(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      throw new TopicsApiError(200, 'invalid_response', 'The server sent an unexpected response');
    }
    return parsed;
  };

  const json = (
    input: CreateTopicInput | PatchTopicInput | { userId: string } | { aiId: string },
  ): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

  return {
    async createTopic(groupId, input) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/topics`,
        json(input),
        parseTopic,
      );
      return body as Topic;
    },
    async getTopic(id) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}`,
        { method: 'GET' },
        parseTopic,
      );
      return body as Topic;
    },
    async patchTopic(id, input) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}`,
        { ...json(input), method: 'PATCH' },
        parseTopic,
      );
      return body as Topic;
    },
    async archiveTopic(id) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}/archive`,
        { method: 'POST' },
        parseTopic,
      );
      return body as Topic;
    },
    async listTopicMembers(id) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}/members`,
        { method: 'GET' },
        (value) => {
          if (!isRecord(value) || !Array.isArray(value['members'])) return null;
          const members: TopicMember[] = [];
          for (const entry of value['members']) {
            const member = parseTopicMember(entry);
            if (member === null) return null;
            members.push(member);
          }
          return members;
        },
      );
      return body as TopicMember[];
    },
    async addTopicMember(id, userId) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}/members`,
        json({ userId }),
        parseTopic,
      );
      return body as Topic;
    },
    async removeTopicMember(id, userId) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
        parseTopic,
      );
      return body as Topic;
    },
    async listTopicAis(id) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}/ais`,
        { method: 'GET' },
        (value) => {
          if (!isRecord(value) || !Array.isArray(value['ais'])) return null;
          const ais: TopicAi[] = [];
          for (const entry of value['ais']) {
            const ai = parseTopicAi(entry);
            if (ai === null) return null;
            ais.push(ai);
          }
          return ais;
        },
      );
      return body as TopicAi[];
    },
    async addTopicAi(id, aiId) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}/ais`,
        json({ aiId }),
        parseTopic,
      );
      return body as Topic;
    },
    async removeTopicAi(id, aiId) {
      const body = await withToken(
        `/api/topics/${encodeURIComponent(id)}/ais/${encodeURIComponent(aiId)}`,
        { method: 'DELETE' },
        parseTopic,
      );
      return body as Topic;
    },
    // The group's `membersCanCreateTopics` switch (T-0108). Optional on the
    // wire so older servers still parse; treated as off.
    async setMembersCanCreateTopics(groupId, allowed) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ membersCanCreateTopics: allowed }),
        },
        (value) => {
          if (!isRecord(value)) return null;
          const flag = value['membersCanCreateTopics'];
          return typeof flag === 'boolean' ? flag : false;
        },
      );
      return body as boolean;
    },
  };
}

/** The first glyph letter, uppercased, for a new topic the user just named. */
export function glyphForTopicName(name: string): string {
  const first = [...name.trim()][0] ?? 'G';
  return first.toUpperCase();
}
