import { ApiError, runApi } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * The tools and routines API (`/api/ais/:id/tools`, `/api/ais/:id/routines`
 * and the tool and routine actions), the mobile twin of the web client in
 * `apps/web/src/lib/tools.ts`. A Promise port over the client derived from
 * the shared contract (`@zilar/api-contract`, `tools.ts` and `routines.ts`,
 * T-0893). `ToolsApiError` is the shared `ApiError`, which keeps the
 * server's `code` and `status`, so the sections can branch on the error
 * (404 = empty list, like web).
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

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const ToolsApiError = ApiError;
export type ToolsApiError = ApiError;

/** The production `AiToolsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createToolsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AiToolsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    async listAiTools(aiId) {
      return [...(await runApi(client.tools.listForAi({ params: { id: aiId } })))];
    },
    async listAiRoutines(aiId) {
      return [...(await runApi(client.routines.listForAi({ params: { id: aiId } })))];
    },
    pauseRoutine(id) {
      return runApi(client.routines.pause({ params: { id } }));
    },
    resumeRoutine(id) {
      return runApi(client.routines.resume({ params: { id } }));
    },
    getTool(id) {
      return runApi(client.tools.detail({ params: { id } }));
    },
    async listToolVersions(id) {
      return [...(await runApi(client.tools.versions({ params: { id } })))];
    },
    getToolVersion(id, version) {
      return runApi(client.tools.version({ params: { id, n: String(version) } }));
    },
    async listToolRuns(id) {
      return [...(await runApi(client.tools.runs({ params: { id } })))];
    },
    async deleteRoutine(id) {
      await runApi(client.routines.remove({ params: { id } }));
    },
    revertTool(id, version) {
      return runApi(client.tools.revert({ params: { id }, payload: { version } }));
    },
    runToolNow(id, input) {
      return runApi(
        client.tools.run({ params: { id }, payload: input === undefined ? {} : { input } }),
      );
    },
    async deleteTool(id) {
      await runApi(client.tools.remove({ params: { id } }));
    },
  };
}
