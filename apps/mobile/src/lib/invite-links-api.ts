import { API_URL } from './auth';
import type { TokenProvider } from './chat-api';

/**
 * Group invite links (T-0136), the mobile twin of the web client
 * (`apps/web/src/lib/api.ts`, "Group invite links" + "Join by link"): create,
 * list and revoke shareable group links for owners/admins, plus the
 * join-by-link preview and join. The wire contract lives in
 * `apps/server/src/invite-links/{routes,service}.ts` (T-0115).
 *
 * Mobile has no zod, so — like `topics-api.ts` — the boundary is validated
 * with type guards: malformed rows return null and throw `invalid_response`.
 * The token is shown once at creation in `url` and never stored — the list
 * carries hints, labels, uses and state, never tokens.
 */

export interface GroupInviteLink {
  id: string;
  label: string | null;
  tokenHint: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
}

export interface CreatedInviteLink {
  id: string;
  /** The raw token, shown once. Never stored, logged or audited. */
  token: string;
  url: string;
}

export interface CreateGroupInviteLinkInput {
  label?: string;
  expiresInHours?: number;
  maxUses?: number;
}

export interface JoinPreview {
  groupTitle: string;
  memberCount: number;
  alreadyMember: boolean;
  groupId?: string;
  // T-0144: the group's kind, so the join screen reads "Join channel" for a
  // channel. Optional so older servers still parse (treated as a group).
  kind?: 'group' | 'channel';
}

export interface JoinResult {
  groupId: string;
  alreadyMember: boolean;
}

export interface InviteLinksApi {
  createGroupInviteLink(
    groupId: string,
    input?: CreateGroupInviteLinkInput,
  ): Promise<CreatedInviteLink>;
  listGroupInviteLinks(groupId: string): Promise<GroupInviteLink[]>;
  revokeGroupInviteLink(groupId: string, linkId: string): Promise<void>;
  previewJoinLink(token: string): Promise<JoinPreview>;
  joinByLink(token: string): Promise<JoinResult>;
}

export class InviteLinksApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'InviteLinksApiError';
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

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' ? value : undefined;
}

function parseInviteLink(value: unknown): GroupInviteLink | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const tokenHint = value['tokenHint'];
  const uses = value['uses'];
  const revoked = value['revoked'];
  const createdAt = value['createdAt'];
  if (
    !isString(id) ||
    !isString(tokenHint) ||
    typeof uses !== 'number' ||
    typeof revoked !== 'boolean' ||
    !isString(createdAt)
  ) {
    return null;
  }
  const label = nullableString(value['label']);
  const maxUses = nullableNumber(value['maxUses']);
  const expiresAt = nullableString(value['expiresAt']);
  if (label === undefined || maxUses === undefined || expiresAt === undefined) {
    return null;
  }
  return { id, label, tokenHint, uses, maxUses, expiresAt, revoked, createdAt };
}

function parseCreatedInviteLink(value: unknown): CreatedInviteLink | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const token = value['token'];
  const url = value['url'];
  if (!isString(id) || !isString(token) || !isString(url)) return null;
  return { id, token, url };
}

function parseJoinPreview(value: unknown): JoinPreview | null {
  if (!isRecord(value)) return null;
  const groupTitle = value['groupTitle'];
  const memberCount = value['memberCount'];
  const alreadyMember = value['alreadyMember'];
  if (
    !isString(groupTitle) ||
    typeof memberCount !== 'number' ||
    typeof alreadyMember !== 'boolean'
  ) {
    return null;
  }
  const groupId = value['groupId'];
  if (groupId !== undefined && !isString(groupId)) return null;
  // T-0144: the preview kind ("Join channel" vs "Join the group"). Optional
  // so older servers still parse; malformed rejects the preview.
  const rawKind = value['kind'];
  let kind: 'group' | 'channel' | undefined;
  if (rawKind !== undefined) {
    if (rawKind !== 'group' && rawKind !== 'channel') return null;
    kind = rawKind;
  }
  return {
    groupTitle,
    memberCount,
    alreadyMember,
    ...(groupId === undefined ? {} : { groupId }),
    ...(kind === undefined ? {} : { kind }),
  };
}

function parseJoinResult(value: unknown): JoinResult | null {
  if (!isRecord(value)) return null;
  const groupId = value['groupId'];
  const alreadyMember = value['alreadyMember'];
  if (!isString(groupId) || typeof alreadyMember !== 'boolean') return null;
  return { groupId, alreadyMember };
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
    throw new InviteLinksApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new InviteLinksApiError(response.status, code, message);
  }
  return body;
}

/** The production `InviteLinksApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createInviteLinksApi(
  getToken: TokenProvider,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): InviteLinksApi {
  const withToken = async (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> => {
    const token = await getToken();
    if (token === undefined) {
      throw new InviteLinksApiError(401, 'unauthorized', 'No session');
    }
    const body = await request(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      throw new InviteLinksApiError(
        200,
        'invalid_response',
        'The server sent an unexpected response',
      );
    }
    return parsed;
  };

  return {
    async createGroupInviteLink(groupId, input = {}) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/invite-links`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        parseCreatedInviteLink,
      );
      return body as CreatedInviteLink;
    },
    async listGroupInviteLinks(groupId) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/invite-links`,
        { method: 'GET' },
        (value) => {
          if (!isRecord(value) || !Array.isArray(value['links'])) return null;
          const links: GroupInviteLink[] = [];
          for (const entry of value['links']) {
            const link = parseInviteLink(entry);
            if (link === null) return null;
            links.push(link);
          }
          return links;
        },
      );
      return body as GroupInviteLink[];
    },
    async revokeGroupInviteLink(groupId, linkId) {
      await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/invite-links/${encodeURIComponent(linkId)}`,
        { method: 'DELETE' },
        () => ({}),
      );
    },
    async previewJoinLink(token) {
      const body = await withToken(
        `/api/join/${encodeURIComponent(token)}`,
        { method: 'GET' },
        parseJoinPreview,
      );
      return body as JoinPreview;
    },
    async joinByLink(token) {
      const body = await withToken(
        `/api/join/${encodeURIComponent(token)}`,
        { method: 'POST' },
        parseJoinResult,
      );
      return body as JoinResult;
    },
  };
}

/**
 * Extracts the join token from a link the user pastes or opens. Accepts the
 * custom scheme (`galena://join/<token>`), the web URL shape
 * (`https://host/j/<token>`), and a bare 64-hex token. Returns undefined for
 * anything else, so random clipboard text never reaches the server.
 */
export function extractJoinToken(raw: string): string | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  if (/^[0-9a-f]{64}$/i.test(text)) {
    return text.toLowerCase();
  }
  let parsed: URL | undefined;
  try {
    parsed = new URL(text);
  } catch {
    return undefined;
  }
  if (parsed.protocol === 'galena:' && parsed.hostname.toLowerCase() === 'join') {
    const token = parsed.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
    return /^[0-9a-f]{64}$/i.test(token) ? token.toLowerCase() : undefined;
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    const segments = parsed.pathname.split('/').filter((segment) => segment !== '');
    // The web URL shape (`/j/<token>`, T-0115) and the mobile deep-link path
    // (`/join/<token>`): both carry a bare 64-hex token.
    if (
      segments.length === 2 &&
      (segments[0]?.toLowerCase() === 'j' || segments[0]?.toLowerCase() === 'join')
    ) {
      const token = segments[1] ?? '';
      return /^[0-9a-f]{64}$/i.test(token) ? token.toLowerCase() : undefined;
    }
  }
  return undefined;
}

const INVITE_LINK_FAILURE_MESSAGE = 'This link does not work';
const INVITE_LINK_RETRY_MESSAGE = 'Too many attempts. Try again later.';
/**
 * The neutral join failure text (T-0115): invalid, expired, revoked and full
 * links all read the same, so failures never reveal why; rate-limit answers
 * get a friendly retry text. The token must never appear in error text, so
 * callers must pass only the error code/status, never the token.
 */
export function joinFailureMessage(error: { status: number; code: string }): string {
  if (error.status === 429 || error.code === 'rate_limited') {
    return INVITE_LINK_RETRY_MESSAGE;
  }
  return INVITE_LINK_FAILURE_MESSAGE;
}

export type GroupChatTarget =
  { kind: 'chat'; chatId: string } | { kind: 'group'; groupId: string } | { kind: 'list' };

/**
 * Resolves where a joined group opens: its General topic chat, else any of
 * its rows' group screen, else the chats list. Pure and UI-free (lives here
 * rather than the join view so store tests can import it without pulling in
 * `react-native`), so the route — which reads the chats fresh at call time —
 * and tests share it.
 */
export function resolveGroupChat(
  chats: { id: string; groupId?: string; topic?: { isGeneral?: boolean } }[],
  groupId: string,
): GroupChatTarget {
  const general = chats.find((chat) => chat.groupId === groupId && chat.topic?.isGeneral === true);
  if (general !== undefined) {
    return { kind: 'chat', chatId: general.id };
  }
  if (chats.some((chat) => chat.groupId === groupId)) {
    return { kind: 'group', groupId };
  }
  return { kind: 'list' };
}
