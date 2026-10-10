import type { ServerDatabase } from '../db/client';
import type { ToolRunner } from './types';

export type { ToolRunner, ToolRunResult } from './types';

// T-0103: versioned tool code per AI and topic. A tool belongs to one AI
// and one topic (`groupId` + `topicId`, or both null for the personal chat
// with the owner). History is append-only: `saveToolVersion` and
// `revertTool` only insert into `ai_tool_versions`; no function here ever
// updates or deletes a version row.

export interface SaveToolVersionInput {
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  name: string;
  description: string;
  source: string;
  hosts: string[];
  message: string;
  userId: string;
}

// One tool as the list returns it: no source. `hosts` and `lastRunStatus`
// come from the current version and the newest run row. `approvedHosts`
// is the human-approved set (T-0132): the sandbox may only contact the
// intersection of declared `hosts` and this set.
export interface PublicTool {
  id: string;
  aiId: string;
  groupId: string | null;
  /** The topic the tool belongs to. Null for personal-chat tools. */
  topicId: string | null;
  name: string;
  description: string;
  currentVersion: number;
  hosts: string[];
  /** Hosts a human approved via `tool.approve_hosts` (default empty). */
  approvedHosts: string[];
  lastRunStatus: 'ok' | 'error' | null;
  updatedAt: Date;
}

// One tool with its current source, as `getTool` returns it.
export interface ToolDetail extends PublicTool {
  source: string;
}

export interface PublicToolVersion {
  id: string;
  toolId: string;
  version: number;
  message: string;
  hosts: string[];
  createdBy: string;
  createdAt: Date;
}

export interface ToolVersionDetail extends PublicToolVersion {
  source: string;
}

export interface PublicToolRun {
  id: string;
  toolId: string;
  version: number;
  trigger: 'manual' | 'routine' | 'ai';
  status: 'ok' | 'error';
  errorKind: string | null;
  durationMs: number;
  fetchCount: number;
  outputText: string | null;
  createdAt: Date;
}

export interface SaveToolVersionResult {
  tool: ToolDetail;
  version: ToolVersionDetail;
  /** True when source and hosts matched the current version, so no new row
   *  was written. */
  unchanged: boolean;
  /** `created: true` when the tool row was inserted by this call. */
  created: boolean;
}

export interface RevertToolInput {
  toolId: string;
  toVersion: number;
  userId: string;
  message?: string;
}

export interface RunToolVersionDeps {
  db: ServerDatabase;
  runner: ToolRunner;
}

export interface RunToolVersionInput {
  toolId: string;
  version?: number;
  input?: unknown;
  trigger: 'manual' | 'routine' | 'ai';
}

export {
  getTool,
  getVersion,
  listRuns,
  listTools,
  listToolsForAi,
  listVersions,
  MAX_RUN_OUTPUT_BYTES,
  MAX_RUNS_PER_TOOL,
  MAX_TOOLS_PER_TOPIC,
  MAX_VERSIONS_PER_TOOL,
  ToolServiceError,
} from './queries';
export {
  deleteTool,
  deleteToolsForAiInGroupEffect,
  deleteToolsForAiInTopicEffect,
  revertTool,
  saveToolVersion,
} from './mutations';
export { approveToolHosts, revokeToolHosts } from './hosts';
export { runToolVersion } from './runner';
