import { makeToolsApi } from '@zilar/client-core';
import { callApi } from '@/lib/effect/api-client';

export type {
  MyRoutine,
  Routine,
  ToolDetail,
  ToolListItem,
  ToolRun,
  ToolRunResult,
  ToolVersion,
  ToolVersionDetail,
} from '@zilar/api-contract';

const api = makeToolsApi(callApi);

export const {
  listAiTools: listAiToolDetails,
  listGroupTools: listGroupToolDetails,
  listTopicTools: listTopicToolDetails,
  getTool: getToolDetail,
  listToolVersions,
  getToolVersion,
  listToolRuns,
  revertTool,
  runToolNow,
  deleteTool,
  listMyRoutines,
  listAiRoutines,
  listGroupRoutines,
  pauseRoutine,
  resumeRoutine,
  deleteRoutine,
} = api;
