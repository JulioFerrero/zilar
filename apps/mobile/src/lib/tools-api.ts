import { API_URL } from './auth';

/**
 * The tools and routines read API (`GET /api/ais/:id/tools` and
 * `GET /api/ais/:id/routines`), the mobile twin of the web client in
 * `apps/web/src/lib/tools.ts`. The wire contract lives in
 * `apps/server/src/tools/routes.ts` and `apps/server/src/routines/routes.ts`.
 *
 * Mobile validates the boundary with type guards, like `approvals-api.ts`
 * and `ais-api.ts`. `ToolsApiError` keeps the server's `code` and `status`,
 * so the sections can branch on the error (404 = empty list, like web).
 */

export type ToolLastRunStatus = 'ok' | 'error';

export interface ToolListItem {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  name: string;
  description: string;
  currentVersion: number;
  hosts: string[];
  approvedHosts?: string[];
  lastRunStatus: ToolLastRunStatus | null;
  updatedAt: string;
  scope?: 'personal' | 'group';
}

export type RoutineStatus = 'active' | 'paused' | 'needs_approval';

export type RoutinePausedReason = 'user' | 'failures' | 'hosts_changed';

export type RoutineLastStatus = 'ok' | 'error' | 'skipped';

export interface Routine {
  id: string;
  aiId?: string;
  groupId?: string | null;
  topicId?: string | null;
  toolId?: string;
  title: string;
  toolName: string;
  schedule: unknown;
  status: RoutineStatus;
  pausedReason: RoutinePausedReason | null;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: RoutineLastStatus | null;
  approvedHosts: string[];
  scope?: 'personal' | 'group';
}

export interface ToolsApi {
  listAiTools(aiId: string): Promise<ToolListItem[]>;
  listAiRoutines(aiId: string): Promise<Routine[]>;
}

/**
 * The routine mutations (T-0212). Kept separate from `ToolsApi` so the
 * read-only sections keep depending on the two list methods only.
 */
export interface RoutineActionsApi {
  pauseRoutine(id: string): Promise<Routine>;
  resumeRoutine(id: string): Promise<Routine>;
  deleteRoutine(id: string): Promise<void>;
}

/** The full API the AI edit screen works against: lists plus mutations. */
export type AiToolsApi = ToolsApi & RoutineActionsApi;

export class ToolsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ToolsApiError';
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item): item is string => isString(item));
}

function isToolLastRunStatus(value: unknown): value is ToolLastRunStatus {
  return value === 'ok' || value === 'error';
}

function parseToolListItem(value: unknown): ToolListItem | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const aiId = value['aiId'];
  const groupId = value['groupId'];
  const topicId = value['topicId'];
  const name = value['name'];
  const description = value['description'];
  const currentVersion = value['currentVersion'];
  const hosts = value['hosts'];
  const approvedHosts = value['approvedHosts'];
  const lastRunStatus = value['lastRunStatus'];
  const updatedAt = value['updatedAt'];
  const scope = value['scope'];
  if (
    !isString(id) ||
    !isString(aiId) ||
    !isString(name) ||
    !isString(description) ||
    typeof currentVersion !== 'number' ||
    !isStringArray(hosts) ||
    !isString(updatedAt)
  ) {
    return null;
  }
  if (groupId !== null && !isString(groupId)) return null;
  if (topicId !== null && !isString(topicId)) return null;
  if (lastRunStatus !== null && !isToolLastRunStatus(lastRunStatus)) return null;
  if (approvedHosts !== undefined && !isStringArray(approvedHosts)) return null;
  if (scope !== undefined && scope !== 'personal' && scope !== 'group') return null;
  return {
    id,
    aiId,
    groupId,
    topicId,
    name,
    description,
    currentVersion,
    hosts,
    ...(approvedHosts === undefined ? {} : { approvedHosts }),
    lastRunStatus,
    updatedAt,
    ...(scope === 'personal' || scope === 'group' ? { scope } : {}),
  };
}

function isRoutineStatus(value: unknown): value is RoutineStatus {
  return value === 'active' || value === 'paused' || value === 'needs_approval';
}

function isRoutinePausedReason(value: unknown): value is RoutinePausedReason {
  return value === 'user' || value === 'failures' || value === 'hosts_changed';
}

function isRoutineLastStatus(value: unknown): value is RoutineLastStatus {
  return value === 'ok' || value === 'error' || value === 'skipped';
}

function parseRoutine(value: unknown): Routine | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const aiId = value['aiId'];
  const groupId = value['groupId'];
  const topicId = value['topicId'];
  const toolId = value['toolId'];
  const title = value['title'];
  const toolName = value['toolName'];
  const status = value['status'];
  const pausedReason = value['pausedReason'];
  const nextRunAt = value['nextRunAt'];
  const lastRunAt = value['lastRunAt'];
  const lastStatus = value['lastStatus'];
  const approvedHosts = value['approvedHosts'];
  const scope = value['scope'];
  if (
    !isString(id) ||
    !isString(title) ||
    !isString(toolName) ||
    !isRoutineStatus(status) ||
    !isString(nextRunAt) ||
    !isStringArray(approvedHosts)
  ) {
    return null;
  }
  if (aiId !== undefined && !isString(aiId)) return null;
  if (groupId !== undefined && groupId !== null && !isString(groupId)) return null;
  if (topicId !== undefined && topicId !== null && !isString(topicId)) return null;
  if (toolId !== undefined && !isString(toolId)) return null;
  if (pausedReason !== null && !isRoutinePausedReason(pausedReason)) return null;
  if (lastRunAt !== null && !isString(lastRunAt)) return null;
  if (lastStatus !== null && !isRoutineLastStatus(lastStatus)) return null;
  if (scope !== undefined && scope !== 'personal' && scope !== 'group') return null;
  return {
    id,
    ...(aiId === undefined ? {} : { aiId }),
    ...(groupId === undefined ? {} : { groupId }),
    ...(topicId === undefined ? {} : { topicId }),
    ...(toolId === undefined ? {} : { toolId }),
    title,
    toolName,
    schedule: value['schedule'],
    status,
    pausedReason,
    nextRunAt,
    lastRunAt,
    lastStatus,
    approvedHosts,
    ...(scope === 'personal' || scope === 'group' ? { scope } : {}),
  };
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
    throw new ToolsApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new ToolsApiError(response.status, code, message);
  }
  return body;
}

/** The production `ToolsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createToolsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AiToolsApi {
  const parseList = <T>(value: unknown, parseItem: (item: unknown) => T | null): T[] | null => {
    if (!Array.isArray(value)) return null;
    const parsed: T[] = [];
    for (const item of value) {
      const result = parseItem(item);
      if (result === null) return null;
      parsed.push(result);
    }
    return parsed;
  };
  const withToken = async (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> => {
    const token = await getToken();
    if (token === undefined) {
      throw new ToolsApiError(401, 'unauthorized', 'No session');
    }
    const body = await request(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      throw new ToolsApiError(200, 'invalid_response', 'The server sent an unexpected response');
    }
    return parsed;
  };

  return {
    async listAiTools(aiId) {
      const body = await withToken(
        `/api/ais/${encodeURIComponent(aiId)}/tools`,
        { method: 'GET' },
        (value) => parseList(value, parseToolListItem),
      );
      return body as ToolListItem[];
    },
    async listAiRoutines(aiId) {
      const body = await withToken(
        `/api/ais/${encodeURIComponent(aiId)}/routines`,
        { method: 'GET' },
        (value) => parseList(value, parseRoutine),
      );
      return body as Routine[];
    },
    async pauseRoutine(id) {
      const body = await withToken(
        `/api/routines/${encodeURIComponent(id)}/pause`,
        { method: 'POST' },
        parseRoutine,
      );
      return body as Routine;
    },
    async resumeRoutine(id) {
      const body = await withToken(
        `/api/routines/${encodeURIComponent(id)}/resume`,
        { method: 'POST' },
        parseRoutine,
      );
      return body as Routine;
    },
    async deleteRoutine(id) {
      const token = await getToken();
      if (token === undefined) {
        throw new ToolsApiError(401, 'unauthorized', 'No session');
      }
      await request(
        apiUrl,
        `/api/routines/${encodeURIComponent(id)}`,
        token,
        {
          method: 'DELETE',
        },
        fetchImpl,
      );
    },
  };
}
