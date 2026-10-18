import { makeToolsApi, type Routine, type ToolListItem, type ToolRun } from '@zilar/client-core';
import { runApi } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

export type {
  MyRoutine,
  Routine,
  ToolDetail,
  ToolListItem,
  ToolRun,
  ToolRunResult,
  ToolVersion,
  ToolVersionDetail,
} from '@zilar/client-core';

export type ToolLastRunStatus = NonNullable<ToolListItem['lastRunStatus']>;
export type ToolRunTrigger = ToolRun['trigger'];
export type ToolRunStatus = ToolRun['status'];
export type RoutinePausedReason = NonNullable<Routine['pausedReason']>;
export type RoutineLastStatus = NonNullable<Routine['lastStatus']>;
export type RoutineStatus = Routine['status'];

type Tools = ReturnType<typeof makeToolsApi>;

export type ToolsApi = Pick<
  Tools,
  | 'listAiTools'
  | 'listAiRoutines'
  | 'listGroupTools'
  | 'listGroupRoutines'
  | 'listTopicTools'
  | 'listTopicRoutines'
>;
export type ToolDetailsApi = Pick<
  Tools,
  'getTool' | 'listToolVersions' | 'getToolVersion' | 'listToolRuns'
>;
export type ToolActionsApi = Pick<Tools, 'revertTool' | 'runToolNow' | 'deleteTool'>;
export type RoutineActionsApi = Pick<Tools, 'pauseRoutine' | 'resumeRoutine' | 'deleteRoutine'>;
export type MyRoutinesApi = Pick<Tools, 'listMyRoutines'>;
export type AiToolsApi = Tools;

export function createToolsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AiToolsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return makeToolsApi((call) => runApi(call(client)));
}
