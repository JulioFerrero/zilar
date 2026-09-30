import { API_URL } from './auth';
import type { Me } from './auth-api';
import { parseTopic, type Topic } from './topics-api';

export type { Me };

/**
 * The server APIs the real chat store needs, validated by hand at the boundary
 * (mobile has no zod, so this follows the `auth-api.ts` type-guard style). The
 * session token comes from a `TokenProvider` so tests can inject a fake.
 */

export interface Contact {
  userId: string;
  name: string;
  jid: string;
  avatarUrl?: string;
}

export type ChatEntry =
  | { kind: 'dm'; chatJid: string; title: string; userId: string; avatarUrl?: string }
  | {
      kind: 'group';
      chatJid: string;
      title: string;
      groupId: string;
      memberCount: number;
      role: GroupRole;
      // T-0108: a group entry may carry its visible `topics` (archived
      // excluded). Optional so older servers still parse; the store maps such
      // a group to one row per topic (General keeps the old chat id).
      // Validated `Topic` rows (T-0139), malformed wire rows dropped.
      topics?: Topic[];
    };

export type GroupRole = 'owner' | 'admin' | 'member';

export interface GroupMember {
  userId: string;
  name: string;
  role: GroupRole;
  // T-0116: the custom group roles this member holds, shown as chips. Absent
  // on payloads from an older server (treated as none).
  roles: { id: string; name: string }[];
}

/** The group detail the new-topic sheet reads (people + roles + AIs). */
export interface GroupDetail {
  id: string;
  title: string;
  createdBy: string;
  membersCanCreateTopics?: boolean;
  members: GroupMember[];
  ais: GroupAi[];
}

/** One AI in the group, so the sheet can offer the viewer's own unticked. */
export interface GroupAi {
  aiId: string;
  jid: string;
  name: string;
  ownerId: string;
}

export interface XmppToken {
  jid: string;
  token: string;
  expiresAt: string;
  service: string;
  domain: string;
  mucDomain: string;
}

/** Reads the bearer session token from secure storage. */
export type TokenProvider = () => Promise<string | undefined>;

export interface ChatApi {
  getMe(): Promise<Me>;
  getChats(): Promise<ChatEntry[]>;
  getContacts(): Promise<Contact[]>;
  getGroup(groupId: string): Promise<GroupDetail>;
  getXmppToken(): Promise<XmppToken>;
}

export class ChatApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ChatApiError';
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

function optionalString(value: unknown): string | undefined {
  return isString(value) ? value : undefined;
}

function parseMe(value: unknown): Me | null {
  if (!isRecord(value)) return null;
  const { id, email, name } = value;
  const jid = value['jid'];
  if (!isString(id) || !isString(email) || !isString(name)) return null;
  return { id, email, name, jid: isString(jid) ? jid : null };
}

function parseContact(value: unknown): Contact | null {
  if (!isRecord(value)) return null;
  const userId = value['userId'];
  const name = value['name'];
  const jid = value['jid'];
  if (!isString(userId) || !isString(name) || !isString(jid)) return null;
  const avatarUrl = optionalString(value['avatarUrl']);
  return { userId, name, jid, ...(avatarUrl === undefined ? {} : { avatarUrl }) };
}

function isGroupRole(value: unknown): value is GroupRole {
  return value === 'owner' || value === 'admin' || value === 'member';
}

function parseChatEntry(value: unknown): ChatEntry | null {
  if (!isRecord(value)) return null;
  const kind = value['kind'];
  const chatJid = value['chatJid'];
  const title = value['title'];
  if (!isString(chatJid) || !isString(title)) return null;
  if (kind === 'dm') {
    const userId = value['userId'];
    if (!isString(userId)) return null;
    const avatarUrl = optionalString(value['avatarUrl']);
    return {
      kind: 'dm',
      chatJid,
      title,
      userId,
      ...(avatarUrl === undefined ? {} : { avatarUrl }),
    };
  }
  if (kind === 'group') {
    const groupId = value['groupId'];
    const memberCount = value['memberCount'];
    const role = value['role'];
    if (!isString(groupId) || typeof memberCount !== 'number' || !isGroupRole(role)) return null;
    // T-0139: keep the server's `topics` on the entry (validated with
    // `parseTopic`, the same shape the topics API uses — never trust the
    // wire; malformed rows are dropped, never rendered), so the store maps
    // a General-only group to its topic row. Absent on older servers
    // (still parses, as before).
    const rawTopics = value['topics'];
    let topics: Topic[] | undefined;
    if (rawTopics !== undefined) {
      if (!Array.isArray(rawTopics)) return null;
      topics = [];
      for (const raw of rawTopics) {
        const topic = parseTopic(raw);
        if (topic !== null) {
          topics.push(topic);
        }
      }
    }
    return {
      kind: 'group',
      chatJid,
      title,
      groupId,
      memberCount,
      role,
      ...(topics === undefined ? {} : { topics }),
    };
  }
  return null;
}

function parseGroupDetail(value: unknown): GroupDetail | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const title = value['title'];
  const createdBy = value['createdBy'];
  const members = value['members'];
  if (!isString(id) || !isString(title) || !isString(createdBy) || !Array.isArray(members)) {
    return null;
  }
  const parsed: GroupMember[] = [];
  for (const member of members) {
    if (!isRecord(member)) return null;
    const userId = member['userId'];
    const name = member['name'];
    const role = member['role'];
    if (!isString(userId) || !isString(name) || !isGroupRole(role)) return null;
    // T-0116: custom role chips. Absent on older servers (treated as none);
    // a malformed entry rejects the detail rather than rendering half of it.
    const roles: { id: string; name: string }[] = [];
    const rawRoles = member['roles'];
    if (rawRoles !== undefined) {
      if (!Array.isArray(rawRoles)) return null;
      for (const entry of rawRoles) {
        if (!isRecord(entry)) return null;
        const id = entry['id'];
        const roleName = entry['name'];
        if (!isString(id) || !isString(roleName)) return null;
        roles.push({ id, name: roleName });
      }
    }
    parsed.push({ userId, name, role, roles });
  }
  // T-0108: the plain-members-may-create switch. Optional so older servers
  // still parse (treated as off).
  const membersCanCreateTopics =
    value['membersCanCreateTopics'] === true
      ? true
      : value['membersCanCreateTopics'] === false
        ? false
        : undefined;
  // The group AIs ride along when present, so the new-topic sheet can offer
  // the viewer's own unticked; ignored when absent.
  const ais: GroupAi[] = [];
  const rawAis = value['ais'];
  if (Array.isArray(rawAis)) {
    for (const entry of rawAis) {
      if (!isRecord(entry)) return null;
      const aiId = entry['aiId'];
      const jid = entry['jid'];
      const name = entry['name'];
      const ownerId = entry['ownerId'];
      if (!isString(aiId) || !isString(jid) || !isString(name) || !isString(ownerId)) return null;
      ais.push({ aiId, jid, name, ownerId });
    }
  }
  return {
    id,
    title,
    createdBy,
    members: parsed,
    ais,
    ...(membersCanCreateTopics === undefined ? {} : { membersCanCreateTopics }),
  };
}

function parseXmppToken(value: unknown): XmppToken | null {
  if (!isRecord(value)) return null;
  const jid = value['jid'];
  const token = value['token'];
  const expiresAt = value['expiresAt'];
  const service = value['service'];
  const domain = value['domain'];
  const mucDomain = value['mucDomain'];
  if (
    !isString(jid) ||
    !isString(token) ||
    !isString(expiresAt) ||
    !isString(service) ||
    !isString(domain) ||
    !isString(mucDomain)
  ) {
    return null;
  }
  return { jid, token, expiresAt, service, domain, mucDomain };
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
    throw new ChatApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new ChatApiError(response.status, code, message);
  }
  return body;
}

/** The production `ChatApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createChatApi(
  getToken: TokenProvider,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ChatApi {
  const withToken = async (path: string, init: RequestInit, parse: (value: unknown) => unknown) => {
    const token = await getToken();
    if (token === undefined) {
      throw new ChatApiError(401, 'unauthorized', 'No session');
    }
    const body = await request(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      throw new ChatApiError(200, 'invalid_response', 'The server sent an unexpected response');
    }
    return parsed;
  };

  return {
    async getMe() {
      return (await withToken('/api/me', { method: 'GET' }, parseMe)) as Me;
    },
    async getChats() {
      const body = await withToken('/api/chats', { method: 'GET' }, (value) => {
        if (!isRecord(value) || !Array.isArray(value['chats'])) return null;
        const chats: ChatEntry[] = [];
        for (const entry of value['chats']) {
          const parsed = parseChatEntry(entry);
          if (parsed === null) return null;
          chats.push(parsed);
        }
        return chats;
      });
      return body as ChatEntry[];
    },
    async getContacts() {
      const body = await withToken('/api/contacts', { method: 'GET' }, (value) => {
        if (!Array.isArray(value)) return null;
        const contacts: Contact[] = [];
        for (const entry of value) {
          const parsed = parseContact(entry);
          if (parsed === null) return null;
          contacts.push(parsed);
        }
        return contacts;
      });
      return body as Contact[];
    },
    async getGroup(groupId) {
      return (await withToken(
        `/api/groups/${encodeURIComponent(groupId)}`,
        { method: 'GET' },
        parseGroupDetail,
      )) as GroupDetail;
    },
    async getXmppToken() {
      return (await withToken('/api/xmpp/token', { method: 'POST' }, parseXmppToken)) as XmppToken;
    },
  };
}
