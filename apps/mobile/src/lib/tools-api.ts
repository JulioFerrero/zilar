import { runApi, type MyRoutine } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * Errors are the shared `ApiError`, so the sections branch on `status` (404 = empty list, like web).
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
 * A failed run is still a 200 from the server, so this is data, not an error.
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
  // optional so old servers still decode; `prompt` routines have no tool.
  kind?: 'tool' | 'prompt';
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
  listGroupTools(groupId: string): Promise<ToolListItem[]>;
  listGroupRoutines(groupId: string): Promise<Routine[]>;
  listTopicTools(topicId: string): Promise<ToolListItem[]>;
  listTopicRoutines(topicId: string): Promise<Routine[]>;
}

export interface ToolDetailsApi {
  getTool(id: string): Promise<ToolDetail>;
  listToolVersions(id: string): Promise<ToolVersion[]>;
  getToolVersion(id: string, version: number): Promise<ToolVersionDetail>;
  listToolRuns(id: string): Promise<ToolRun[]>;
}

export interface RoutineActionsApi {
  pauseRoutine(id: string): Promise<Routine>;
  resumeRoutine(id: string): Promise<Routine>;
  deleteRoutine(id: string): Promise<void>;
}

export interface ToolActionsApi {
  revertTool(id: string, version: number): Promise<ToolVersion>;
  runToolNow(id: string, input?: unknown): Promise<ToolRunResult>;
  deleteTool(id: string): Promise<void>;
}

/**
 * A `MyRoutine` carries the AI's name, picture and the chat JID the Ask key opens, so the screen renders without extra reads.
 */
export interface MyRoutinesApi {
  listMyRoutines(): Promise<MyRoutine[]>;
}

export type { MyRoutine };

export type AiToolsApi = ToolsApi &
  RoutineActionsApi &
  ToolDetailsApi &
  ToolActionsApi &
  MyRoutinesApi;

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
    async listGroupTools(groupId) {
      return [...(await runApi(client.tools.listForGroup({ params: { id: groupId } })))];
    },
    async listGroupRoutines(groupId) {
      return [...(await runApi(client.routines.listForGroup({ params: { id: groupId } })))];
    },
    async listTopicTools(topicId) {
      return [...(await runApi(client.tools.listForTopic({ params: { id: topicId } })))];
    },
    async listTopicRoutines(topicId) {
      return [...(await runApi(client.routines.listForTopic({ params: { id: topicId } })))];
    },
    async listMyRoutines() {
      return [...(await runApi(client.routines.listMine()))];
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
