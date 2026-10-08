import { Data, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { errorFieldsOf } from './api-error-body';
import { API_URL } from './auth';

/**
 * The tools and routines read API (`GET /api/ais/:id/tools` and
 * `GET /api/ais/:id/routines`), the mobile twin of the web client in
 * `apps/web/src/lib/tools.ts`. The wire contract lives in
 * `apps/server/src/tools/routes.ts` and `apps/server/src/routines/routes.ts`.
 *
 * The boundary is validated with Effect Schema (T-0506 recipe): the request is
 * an Effect pipeline, cut back to a `Promise` at the edge with
 * `Effect.runPromise`. `ToolsApiError` keeps the server's `code` and `status`,
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

export type ToolRunTrigger = 'manual' | 'routine' | 'ai';

export type ToolRunStatus = 'ok' | 'error';

export interface ToolDetail extends ToolListItem {
  source: string;
}

export interface ToolVersion {
  id: string;
  toolId: string;
  version: number;
  message: string;
  hosts: string[];
  createdBy: string;
  createdAt: string;
  toolName?: string;
}

export interface ToolVersionDetail extends ToolVersion {
  source: string;
}

export interface ToolRun {
  id: string;
  toolId: string;
  version: number;
  trigger: ToolRunTrigger;
  status: ToolRunStatus;
  errorKind: string | null;
  durationMs: number;
  fetchCount: number;
  outputText: string | null;
  createdAt: string;
}

/**
 * The answer of `POST /tools/:id/run` (T-0219): either the tool's own ok
 * output or its own failure (`error.kind`/`message` plus logs). A failed
 * run is still a 200 from the server, so this is data, not an error.
 */
export type ToolRunResult =
  | {
      ok: true;
      output: { text: string; data?: unknown };
      logs: string;
      durationMs: number;
      fetchCount: number;
    }
  | {
      ok: false;
      error: { kind: string; message: string };
      logs: string;
      durationMs: number;
      fetchCount: number;
    };

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

export type RoutineStatus = 'active' | 'paused' | 'needs_approval';

export interface ToolsApi {
  listAiTools(aiId: string): Promise<ToolListItem[]>;
  listAiRoutines(aiId: string): Promise<Routine[]>;
}

/**
 * The read-only tool detail calls (T-0218): one tool with its current
 * source, its version history, one version with its source, recent runs.
 */
export interface ToolDetailsApi {
  getTool(id: string): Promise<ToolDetail>;
  listToolVersions(id: string): Promise<ToolVersion[]>;
  getToolVersion(id: string, version: number): Promise<ToolVersionDetail>;
  listToolRuns(id: string): Promise<ToolRun[]>;
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

/**
 * The tool mutations (T-0219): revert to an older version, run the current
 * version now, delete the tool. Kept separate like `RoutineActionsApi`.
 */
export interface ToolActionsApi {
  revertTool(id: string, version: number): Promise<ToolVersion>;
  runToolNow(id: string, input?: unknown): Promise<ToolRunResult>;
  deleteTool(id: string): Promise<void>;
}

/** The full API the AI edit screen works against: lists plus mutations. */
export type AiToolsApi = ToolsApi & RoutineActionsApi & ToolDetailsApi & ToolActionsApi;

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

const ToolListItemFields = {
  id: Schema.String,
  aiId: Schema.String,
  groupId: Schema.NullOr(Schema.String),
  topicId: Schema.NullOr(Schema.String),
  name: Schema.String,
  description: Schema.String,
  currentVersion: Schema.Number,
  hosts: Schema.mutable(Schema.Array(Schema.String)),
  approvedHosts: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  lastRunStatus: Schema.NullOr(Schema.Literals(['ok', 'error'])),
  updatedAt: Schema.String,
  scope: Schema.optional(Schema.Literals(['personal', 'group'])),
} as const;

const ToolListItemSchema = struct(ToolListItemFields);

const ToolDetailSchema = struct({ ...ToolListItemFields, source: Schema.String });

const ToolVersionFields = {
  id: Schema.String,
  toolId: Schema.String,
  version: Schema.Number,
  message: Schema.String,
  hosts: Schema.mutable(Schema.Array(Schema.String)),
  createdBy: Schema.String,
  createdAt: Schema.String,
  toolName: Schema.optional(Schema.String),
} as const;

const ToolVersionSchema = struct(ToolVersionFields);

const ToolVersionDetailSchema = struct({ ...ToolVersionFields, source: Schema.String });

const ToolRunSchema = struct({
  id: Schema.String,
  toolId: Schema.String,
  version: Schema.Number,
  trigger: Schema.Literals(['manual', 'routine', 'ai']),
  status: Schema.Literals(['ok', 'error']),
  errorKind: Schema.NullOr(Schema.String),
  durationMs: Schema.Number,
  fetchCount: Schema.Number,
  outputText: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});

const ToolRunOkSchema = struct({
  ok: Schema.Literal(true),
  output: struct({
    text: Schema.String,
    data: Schema.optional(Schema.Unknown),
  }),
  logs: Schema.String,
  durationMs: Schema.Number,
  fetchCount: Schema.Number,
});

const ToolRunFailSchema = struct({
  ok: Schema.Literal(false),
  error: struct({
    kind: Schema.String,
    message: Schema.String,
  }),
  logs: Schema.String,
  durationMs: Schema.Number,
  fetchCount: Schema.Number,
});

const ToolRunResultSchema = Schema.Union([ToolRunOkSchema, ToolRunFailSchema]);

const RoutineSchema = struct({
  id: Schema.String,
  aiId: Schema.optional(Schema.String),
  groupId: Schema.optional(Schema.NullOr(Schema.String)),
  topicId: Schema.optional(Schema.NullOr(Schema.String)),
  toolId: Schema.optional(Schema.String),
  title: Schema.String,
  toolName: Schema.String,
  schedule: Schema.Unknown,
  status: Schema.Literals(['active', 'paused', 'needs_approval']),
  pausedReason: Schema.NullOr(Schema.Literals(['user', 'failures', 'hosts_changed'])),
  nextRunAt: Schema.String,
  lastRunAt: Schema.NullOr(Schema.String),
  lastStatus: Schema.NullOr(Schema.Literals(['ok', 'error', 'skipped'])),
  approvedHosts: Schema.mutable(Schema.Array(Schema.String)),
  scope: Schema.optional(Schema.Literals(['personal', 'group'])),
});

// The lists are bare arrays (not envelopes); one bad row fails the whole
// list, exactly like the old hand-rolled `parseList`. `Array` is made
// mutable to keep the array types the API has always returned.
const ToolListSchema = Schema.mutable(Schema.Array(ToolListItemSchema));
const ToolVersionListSchema = Schema.mutable(Schema.Array(ToolVersionSchema));
const ToolRunListSchema = Schema.mutable(Schema.Array(ToolRunSchema));
const RoutineListSchema = Schema.mutable(Schema.Array(RoutineSchema));

function parseToolDetail(value: unknown): ToolDetail | null {
  const decoded = Schema.decodeUnknownExit(ToolDetailSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseToolVersion(value: unknown): ToolVersion | null {
  const decoded = Schema.decodeUnknownExit(ToolVersionSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseToolVersionDetail(value: unknown): ToolVersionDetail | null {
  const decoded = Schema.decodeUnknownExit(ToolVersionDetailSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseToolRunResult(value: unknown): ToolRunResult | null {
  const decoded = Schema.decodeUnknownExit(ToolRunResultSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseRoutine(value: unknown): Routine | null {
  const decoded = Schema.decodeUnknownExit(RoutineSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseToolList(value: unknown): ToolListItem[] | null {
  const decoded = Schema.decodeUnknownExit(ToolListSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseToolVersionList(value: unknown): ToolVersion[] | null {
  const decoded = Schema.decodeUnknownExit(ToolVersionListSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseToolRunList(value: unknown): ToolRun[] | null {
  const decoded = Schema.decodeUnknownExit(ToolRunListSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseRoutineList(value: unknown): Routine[] | null {
  const decoded = Schema.decodeUnknownExit(RoutineListSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

// DELETE answers 204 with no body; any 2xx body is accepted and ignored,
// exactly like the old hand validator.
function parseDelete(value: unknown): undefined | null {
  const decoded = Schema.decodeUnknownExit(Schema.Unknown)(value);
  return Exit.isSuccess(decoded) ? undefined : null;
}

// The internal failures, one per case. They carry no field beyond what the old
// `ToolsApiError` already surfaced; the `Promise` edge maps each back to that
// same error, status, code and message.
class ToolsNetworkError extends Data.TaggedError('ToolsNetworkError') {}
class ToolsRequestError extends Data.TaggedError('ToolsRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class ToolsUnauthorized extends Data.TaggedError('ToolsUnauthorized') {}
class ToolsInvalidResponse extends Data.TaggedError('ToolsInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, ToolsNetworkError | ToolsRequestError> {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetchImpl(`${apiUrl}${path}`, {
        ...init,
        signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...init.headers,
        },
      }),
    catch: () => new ToolsNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new ToolsRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `ToolsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createToolsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AiToolsApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    ToolsUnauthorized | ToolsNetworkError | ToolsRequestError | ToolsInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new ToolsUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new ToolsInvalidResponse();
    }
    return parsed;
  });

  const withToken = (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> =>
    Effect.runPromise(
      withTokenEffect(path, init, parse).pipe(
        Effect.catchTags({
          ToolsUnauthorized: () =>
            Effect.fail(new ToolsApiError(401, 'unauthorized', 'No session')),
          ToolsNetworkError: () =>
            Effect.fail(new ToolsApiError(0, 'network_error', 'Could not reach the server')),
          ToolsRequestError: (error) =>
            Effect.fail(new ToolsApiError(error.status, error.code, error.message)),
          ToolsInvalidResponse: () =>
            Effect.fail(
              new ToolsApiError(200, 'invalid_response', 'The server sent an unexpected response'),
            ),
        }),
      ),
    );

  return {
    async listAiTools(aiId) {
      const body = await withToken(
        `/api/ais/${encodeURIComponent(aiId)}/tools`,
        { method: 'GET' },
        parseToolList,
      );
      return body as ToolListItem[];
    },
    async listAiRoutines(aiId) {
      const body = await withToken(
        `/api/ais/${encodeURIComponent(aiId)}/routines`,
        { method: 'GET' },
        parseRoutineList,
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
    async getTool(id) {
      const body = await withToken(
        `/api/tools/${encodeURIComponent(id)}`,
        { method: 'GET' },
        parseToolDetail,
      );
      return body as ToolDetail;
    },
    async listToolVersions(id) {
      const body = await withToken(
        `/api/tools/${encodeURIComponent(id)}/versions`,
        { method: 'GET' },
        parseToolVersionList,
      );
      return body as ToolVersion[];
    },
    async getToolVersion(id, version) {
      const body = await withToken(
        `/api/tools/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(version))}`,
        { method: 'GET' },
        parseToolVersionDetail,
      );
      return body as ToolVersionDetail;
    },
    async listToolRuns(id) {
      const body = await withToken(
        `/api/tools/${encodeURIComponent(id)}/runs`,
        { method: 'GET' },
        parseToolRunList,
      );
      return body as ToolRun[];
    },
    async deleteRoutine(id) {
      await withToken(`/api/routines/${encodeURIComponent(id)}`, { method: 'DELETE' }, parseDelete);
    },
    async revertTool(id, version) {
      const body = await withToken(
        `/api/tools/${encodeURIComponent(id)}/revert`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ version }),
        },
        parseToolVersion,
      );
      return body as ToolVersion;
    },
    async runToolNow(id, input) {
      const body = await withToken(
        `/api/tools/${encodeURIComponent(id)}/run`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input === undefined ? {} : { input }),
        },
        parseToolRunResult,
      );
      return body as ToolRunResult;
    },
    async deleteTool(id) {
      await withToken(`/api/tools/${encodeURIComponent(id)}`, { method: 'DELETE' }, parseDelete);
    },
  };
}
