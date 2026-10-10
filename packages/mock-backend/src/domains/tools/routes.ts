// Tool routes (T-0941): list by AI, group or topic, detail, versions, one
// version, runs, plus the revert, run and delete mutations, mirroring web's
// `toolRoutes`. The mock has one user (owner), so every read and write
// succeeds; an unknown or deleted tool id answers the server's 404.

import { currentUser } from '../../data/people';
import type { MockRun, MockTool, MockToolVersion } from './seed';
import type { MockData } from '../../state';
import {
  errorResponse,
  jsonResponse,
  noContent,
  readJsonBody,
  type MockHttpRequest,
} from '../../http/shared';

const RUNS_LIMIT = 20;

export function handleTools(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, first, second] = request.segments;
  if (first !== undefined && second !== undefined && request.method === 'GET') {
    if (head === 'ais' && second === 'tools' && request.segments.length === 3) {
      return jsonResponse(listRows(data, (tool) => tool.aiId === first));
    }
    if (head === 'groups' && second === 'tools' && request.segments.length === 3) {
      return jsonResponse(listRows(data, (tool) => tool.groupId === first));
    }
    if (head === 'topics' && second === 'tools' && request.segments.length === 3) {
      return jsonResponse(listRows(data, (tool) => tool.topicId === first));
    }
  }
  if (head !== 'tools' || first === undefined) {
    return undefined;
  }
  const tool = data.tools.find((item) => item.id === first && !item.deleted);
  if (tool === undefined) {
    return errorResponse('not_found', 'Tool not found', 404);
  }
  if (second === undefined && request.method === 'GET') {
    return jsonResponse(toolDetailRow(data, tool));
  }
  if (second === 'versions' && request.method === 'GET') {
    if (request.segments.length === 3) {
      return jsonResponse(versionRows(tool));
    }
    if (request.segments.length === 4) {
      return versionDetail(tool, request.segments[3]);
    }
    return undefined;
  }
  if (second === 'runs' && request.method === 'GET') {
    return jsonResponse(runRows(data, tool.id));
  }
  if (second === 'revert' && request.method === 'POST') {
    return revertTool(data, tool, request);
  }
  if (second === 'run' && request.method === 'POST') {
    return runTool(data, tool);
  }
  if (second === undefined && request.method === 'DELETE') {
    // Idempotent, like the server: the tool's routines go with it.
    tool.deleted = true;
    for (const routine of data.routines) {
      if (routine.toolId === tool.id) {
        routine.deleted = true;
      }
    }
    return noContent();
  }
  return undefined;
}

function listRows(data: MockData, keep: (tool: MockTool) => boolean): readonly unknown[] {
  return data.tools
    .filter((tool) => !tool.deleted && keep(tool))
    .map((tool) => toolListRow(data, tool));
}

function currentVersionOf(tool: MockTool): MockToolVersion {
  const version = tool.versions[tool.versions.length - 1];
  if (version === undefined) {
    throw new Error('mock tools always carry versions');
  }
  return version;
}

function lastRunStatusOf(data: MockData, toolId: string): 'ok' | 'error' | null {
  const runs = runRows(data, toolId);
  return runs[0]?.status ?? null;
}

function runRows(data: MockData, toolId: string): readonly MockRun[] {
  return data.runs
    .filter((run) => run.toolId === toolId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, RUNS_LIMIT);
}

function toolListRow(data: MockData, tool: MockTool): Record<string, unknown> {
  const current = currentVersionOf(tool);
  return {
    id: tool.id,
    aiId: tool.aiId,
    groupId: tool.groupId,
    topicId: tool.topicId,
    name: tool.name,
    description: tool.description,
    currentVersion: current.version,
    hosts: current.hosts,
    approvedHosts: tool.approvedHosts,
    lastRunStatus: lastRunStatusOf(data, tool.id),
    updatedAt: current.createdAt,
    scope: tool.groupId === null ? 'personal' : 'group',
  };
}

function toolDetailRow(data: MockData, tool: MockTool): Record<string, unknown> {
  const current = currentVersionOf(tool);
  return { ...toolListRow(data, tool), source: current.source };
}

function versionRows(tool: MockTool): readonly unknown[] {
  return [...tool.versions].reverse().map((version) => ({
    id: version.id,
    toolId: tool.id,
    version: version.version,
    message: version.message,
    hosts: version.hosts,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
  }));
}

function versionDetail(tool: MockTool, raw: string | undefined): Response {
  const wanted = Number(raw);
  const version = tool.versions.find((item) => item.version === wanted);
  if (version === undefined) {
    return errorResponse('not_found', 'Tool version not found', 404);
  }
  return jsonResponse({
    id: version.id,
    toolId: tool.id,
    version: version.version,
    source: version.source,
    hosts: version.hosts,
    message: version.message,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
  });
}

function revertTool(data: MockData, tool: MockTool, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const wanted = typeof body.version === 'number' ? body.version : 0;
  const old = tool.versions.find((item) => item.version === wanted);
  if (old === undefined) {
    return errorResponse('not_found', 'Tool version not found', 404);
  }
  const created: MockToolVersion = {
    id: `tool-mock-${data.nextToolSequence}`,
    version: currentVersionOf(tool).version + 1,
    source: old.source,
    hosts: [...old.hosts],
    message: `Revert to v${old.version}`,
    createdBy: currentUser.id,
    createdAt: new Date().toISOString(),
  };
  data.nextToolSequence += 1;
  tool.versions.push(created);
  return jsonResponse({
    id: created.id,
    toolId: tool.id,
    version: created.version,
    message: created.message,
    hosts: created.hosts,
    createdBy: created.createdBy,
    createdAt: created.createdAt,
    toolName: tool.name,
  });
}

function runTool(data: MockData, tool: MockTool): Response {
  const current = currentVersionOf(tool);
  const run = {
    id: `run-mock-${data.nextRunSequence}`,
    toolId: tool.id,
    version: current.version,
    trigger: 'manual' as const,
    status: 'ok' as const,
    errorKind: null,
    durationMs: 42,
    fetchCount: current.hosts.length,
    outputText: `mock output of ${tool.name} v${current.version}`,
    createdAt: new Date().toISOString(),
  };
  data.nextRunSequence += 1;
  data.runs.push(run);
  return jsonResponse({
    ok: true as const,
    output: { text: run.outputText },
    logs: '',
    durationMs: run.durationMs,
    fetchCount: run.fetchCount,
  });
}
