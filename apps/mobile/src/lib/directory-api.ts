import { API_URL } from './auth';
import type { TokenProvider } from './chat-api';

/**
 * The public directory API (directory search, lookup by handle, public
 * join, the visibility PATCH on one group and the handle check), the mobile
 * `apps/web/src/lib/api.ts` (T-0164). The wire contract lives in
 * `apps/server/src/directory/routes.ts` (public groups and channels only,
 * never users or private groups; 20 per page with a cursor; reads are rate
 * limited 30 per 10 minutes) and the visibility route in
 * `apps/server/src/groups/`.
 *
 * Mobile has no zod, so — like `chat-api.ts` — the boundary is validated
 * with type guards. `DirectoryApiError` keeps the server's `code` and
 * `status`, so screens can branch on the error without parsing the message
 * again (404 = unknown or private, 409 = full / handle taken, 429 = rate
 * limited).
 */

export type DirectoryKind = 'group' | 'channel';

export interface DirectoryEntry {
  id: string;
  kind: DirectoryKind;
  title: string;
  handle: string;
  description: string | null;
  memberCount: number;
  joined: boolean;
  avatarUrl?: string | undefined;
}

export interface DirectoryPage {
  entries: DirectoryEntry[];
  next: string | null;
}

export interface SearchDirectoryInput {
  q?: string;
  kind?: DirectoryKind;
  cursor?: string;
}

export interface PublicJoinResult {
  groupId: string;
  alreadyMember: boolean;
}

export type GroupVisibility = 'private' | 'public';

export interface GroupVisibilityState {
  visibility: GroupVisibility;
  handle: string | null;
}

export interface SetGroupVisibilityInput {
  visibility: GroupVisibility;
  handle?: string;
}

export type HandleCheckReason = 'invalid' | 'reserved' | 'taken';

export interface HandleCheck {
  available: boolean;
  reason?: HandleCheckReason | undefined;
}

export interface DirectoryApi {
  searchDirectory(input?: SearchDirectoryInput): Promise<DirectoryPage>;
  lookupGroupByHandle(handle: string): Promise<DirectoryEntry>;
  joinPublicGroup(groupId: string): Promise<PublicJoinResult>;
  /**
   * Reads the visibility slice of one group (`GET /api/groups/:id`, owner
   * truth). The mobile `GroupDetail` parser drops `visibility`/`handle`, so
   * the visibility sheet reads them here instead of changing `chat-api.ts`.
   */
  getGroupVisibility(groupId: string): Promise<GroupVisibilityState>;
  setGroupVisibility(groupId: string, input: SetGroupVisibilityInput): Promise<void>;
  checkGroupHandle(handle: string): Promise<HandleCheck>;
}

export class DirectoryApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'DirectoryApiError';
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

function isDirectoryKind(value: unknown): value is DirectoryKind {
  return value === 'group' || value === 'channel';
}

function parseDirectoryEntry(value: unknown): DirectoryEntry | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const kind = value['kind'];
  const title = value['title'];
  const handle = value['handle'];
  const description = value['description'];
  const memberCount = value['memberCount'];
  const joined = value['joined'];
  const avatarUrl = value['avatarUrl'];
  if (
    !isString(id) ||
    !isDirectoryKind(kind) ||
    !isString(title) ||
    !isString(handle) ||
    (description !== null && !isString(description)) ||
    typeof memberCount !== 'number' ||
    typeof joined !== 'boolean' ||
    (avatarUrl !== undefined && !isString(avatarUrl))
  ) {
    return null;
  }
  return {
    id,
    kind,
    title,
    handle,
    description,
    memberCount,
    joined,
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
  };
}

function parseDirectoryPage(value: unknown): DirectoryPage | null {
  if (!isRecord(value) || !Array.isArray(value['entries'])) return null;
  const entries: DirectoryEntry[] = [];
  for (const entry of value['entries']) {
    const parsed = parseDirectoryEntry(entry);
    if (parsed === null) return null;
    entries.push(parsed);
  }
  const next = value['next'];
  if (next !== null && !isString(next)) return null;
  return { entries, next };
}

function parsePublicJoinResult(value: unknown): PublicJoinResult | null {
  if (!isRecord(value)) return null;
  const groupId = value['groupId'];
  const alreadyMember = value['alreadyMember'];
  if (!isString(groupId) || typeof alreadyMember !== 'boolean') return null;
  return { groupId, alreadyMember };
}

function parseGroupVisibility(value: unknown): GroupVisibilityState | null {
  if (!isRecord(value)) return null;
  const visibility = value['visibility'];
  const handle = value['handle'];
  // Older servers omit both: treated as private with no handle.
  if (visibility !== undefined && visibility !== 'private' && visibility !== 'public') return null;
  if (handle !== undefined && handle !== null && !isString(handle)) return null;
  return {
    visibility: visibility === 'public' ? 'public' : 'private',
    handle: isString(handle) ? handle : null,
  };
}

function isHandleCheckReason(value: unknown): value is HandleCheckReason {
  return value === 'invalid' || value === 'reserved' || value === 'taken';
}

function parseHandleCheck(value: unknown): HandleCheck | null {
  if (!isRecord(value)) return null;
  const available = value['available'];
  const reason = value['reason'];
  if (typeof available !== 'boolean') return null;
  if (reason !== undefined && !isHandleCheckReason(reason)) return null;
  return { available, ...(reason === undefined ? {} : { reason }) };
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
    throw new DirectoryApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new DirectoryApiError(response.status, code, message);
  }
  return body;
}

/** The exact PATCH body the server's visibility route accepts. */
export function buildVisibilityBody(input: SetGroupVisibilityInput): Record<string, unknown> {
  return input.visibility === 'public' && input.handle !== undefined
    ? { visibility: 'public', handle: input.handle }
    : { visibility: input.visibility };
}

/** The production `DirectoryApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createDirectoryApi(
  getToken: TokenProvider,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): DirectoryApi {
  const withToken = async (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> => {
    const token = await getToken();
    if (token === undefined) {
      throw new DirectoryApiError(401, 'unauthorized', 'No session');
    }
    const body = await request(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      throw new DirectoryApiError(
        200,
        'invalid_response',
        'The server sent an unexpected response',
      );
    }
    return parsed;
  };

  return {
    async searchDirectory(input = {}) {
      const params = new URLSearchParams();
      if (input.q !== undefined && input.q !== '') {
        params.set('q', input.q);
      }
      if (input.kind !== undefined) {
        params.set('kind', input.kind);
      }
      if (input.cursor !== undefined && input.cursor !== '') {
        params.set('cursor', input.cursor);
      }
      const suffix = params.size === 0 ? '' : `?${params.toString()}`;
      const body = await withToken(
        `/api/directory${suffix}`,
        { method: 'GET' },
        parseDirectoryPage,
      );
      return body as DirectoryPage;
    },
    async lookupGroupByHandle(handle) {
      const body = await withToken(
        `/api/groups/by-handle/${encodeURIComponent(handle)}`,
        { method: 'GET' },
        parseDirectoryEntry,
      );
      return body as DirectoryEntry;
    },
    async joinPublicGroup(groupId) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/join`,
        { method: 'POST' },
        parsePublicJoinResult,
      );
      return body as PublicJoinResult;
    },
    async getGroupVisibility(groupId) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}`,
        { method: 'GET' },
        parseGroupVisibility,
      );
      return body as GroupVisibilityState;
    },
    async setGroupVisibility(groupId, input) {
      await withToken(
        `/api/groups/${encodeURIComponent(groupId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildVisibilityBody(input)),
        },
        (value) => (isRecord(value) ? value : null),
      );
    },
    async checkGroupHandle(handle) {
      const params = new URLSearchParams();
      params.set('handle', handle);
      params.set('kind', 'group');
      const body = await withToken(
        `/api/handles/check?${params.toString()}`,
        { method: 'GET' },
        parseHandleCheck,
      );
      return body as HandleCheck;
    },
  };
}
