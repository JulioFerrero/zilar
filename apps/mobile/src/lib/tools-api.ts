import { makeToolsApi, type Routine } from '@zilar/client-core';

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
export type AiToolsApi = Tools;
