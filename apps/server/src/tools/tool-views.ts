import type { RunRow, ToolRow, VersionRow } from './queries';
import type { PublicToolRun, PublicToolVersion, ToolDetail, ToolVersionDetail } from './service';

export function toToolDetail(
  tool: ToolRow,
  current: VersionRow,
  lastRunStatus: 'ok' | 'error' | null,
): ToolDetail {
  return {
    id: tool.id,
    aiId: tool.aiId,
    groupId: tool.groupId,
    topicId: tool.topicId,
    name: tool.name,
    description: tool.description,
    currentVersion: tool.currentVersion,
    hosts: current.hosts,
    approvedHosts: [...(tool.approvedHosts ?? [])],
    source: current.source,
    lastRunStatus,
    updatedAt: tool.updatedAt,
  };
}

export function toPublicVersion(row: VersionRow): PublicToolVersion {
  return {
    id: row.id,
    toolId: row.toolId,
    version: row.version,
    message: row.message,
    hosts: row.hosts,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export function toVersionDetail(row: VersionRow): ToolVersionDetail {
  return { ...toPublicVersion(row), source: row.source };
}

export function toPublicRun(row: RunRow): PublicToolRun {
  return {
    id: row.id,
    toolId: row.toolId,
    version: row.version,
    trigger: row.trigger,
    status: row.status,
    errorKind: row.errorKind,
    durationMs: row.durationMs,
    fetchCount: row.fetchCount,
    outputText: row.outputText,
    createdAt: row.createdAt,
  };
}
