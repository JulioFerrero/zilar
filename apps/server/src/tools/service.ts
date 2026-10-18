import type { ServerDatabase } from '../db/client';
import type { ToolRunner } from './types';

export type { ToolRunner, ToolRunResult } from './types';

// Versioned tool code per AI and topic; history is append-only — nothing updates or deletes a version row.

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

// No source; `hosts` and `lastRunStatus` come from the current version and newest run, `approvedHosts` from the human.
export interface PublicTool {
  id: string;
  aiId: string;
  groupId: string | null;
  // The topic the tool belongs to. Null for personal-chat tools.
  topicId: string | null;
  name: string;
  description: string;
  currentVersion: number;
  hosts: string[];
  // Hosts a human approved via `tool.approve_hosts` (default empty).
  approvedHosts: string[];
  lastRunStatus: 'ok' | 'error' | null;
  updatedAt: Date;
}

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
  // True when source and hosts matched, so no new row was written.
  unchanged: boolean;
  // `created: true` when the tool row was inserted by this call.
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
} from './deletes';
export { revertTool, saveToolVersion } from './mutations';
export { approveToolHosts, revokeToolHosts } from './hosts';
export { runToolVersion } from './runner';
