import {
  ToolsApiError,
  type AiToolsApi,
  type Routine,
  type ToolDetail,
  type ToolListItem,
  type ToolRun,
  type ToolRunResult,
  type ToolVersion,
  type ToolVersionDetail,
} from '../lib/tools-api';

/**
 * Mock tools and routines API for the AI edit screen (T-0189, actions in
 * T-0212). Two tools (one with hosts and approved hosts, one with no hosts
 * and never run) and three routines: one active, one paused with reason
 * `failures`, and one awaiting re-approval (resume answers `needs_approval`,
 * like the server).
 */

const UPDATED_AT = '2026-10-03T10:00:00.000Z';
const NEXT_RUN_AT = '2026-10-04T09:00:00.000Z';
const LAST_RUN_AT = '2026-10-03T09:00:00.000Z';

const TOOLS: ToolListItem[] = [
  {
    id: 'tool-1',
    aiId: 'ai-1',
    groupId: null,
    topicId: null,
    name: 'Morning briefing',
    description: 'Fetches the overnight headlines and summarizes them.',
    currentVersion: 3,
    hosts: ['news.example.com', 'api.example.com'],
    approvedHosts: ['news.example.com', 'api.example.com'],
    lastRunStatus: 'ok',
    updatedAt: UPDATED_AT,
    scope: 'personal',
  },
  {
    id: 'tool-2',
    aiId: 'ai-1',
    groupId: null,
    topicId: null,
    name: 'Draft helper',
    description: 'Drafts replies from the last messages in the chat.',
    currentVersion: 1,
    hosts: [],
    lastRunStatus: null,
    updatedAt: UPDATED_AT,
    scope: 'personal',
  },
];

const ROUTINES: Routine[] = [
  {
    id: 'routine-1',
    aiId: 'ai-1',
    groupId: null,
    topicId: null,
    toolId: 'tool-1',
    title: 'Weekday briefing',
    toolName: 'Morning briefing',
    schedule: {
      kind: 'daily',
      time: '09:00',
      timezone: 'Europe/Madrid',
      weekdays: [1, 2, 3, 4, 5],
    },
    status: 'active',
    pausedReason: null,
    nextRunAt: NEXT_RUN_AT,
    lastRunAt: LAST_RUN_AT,
    lastStatus: 'ok',
    approvedHosts: ['news.example.com', 'api.example.com'],
    scope: 'personal',
  },
  {
    id: 'routine-2',
    aiId: 'ai-1',
    groupId: null,
    topicId: null,
    toolId: 'tool-2',
    title: 'Hourly drafts',
    toolName: 'Draft helper',
    schedule: { kind: 'interval', everyMinutes: 60 },
    status: 'paused',
    pausedReason: 'failures',
    nextRunAt: NEXT_RUN_AT,
    lastRunAt: LAST_RUN_AT,
    lastStatus: 'error',
    approvedHosts: [],
    scope: 'personal',
  },
  {
    id: 'routine-3',
    aiId: 'ai-1',
    groupId: null,
    topicId: null,
    toolId: 'tool-1',
    title: 'Hosts changed digest',
    toolName: 'Morning briefing',
    schedule: { kind: 'interval', everyMinutes: 720 },
    status: 'needs_approval',
    pausedReason: 'hosts_changed',
    nextRunAt: NEXT_RUN_AT,
    lastRunAt: LAST_RUN_AT,
    lastStatus: 'skipped',
    approvedHosts: ['news.example.com'],
    scope: 'personal',
  },
];

const TOOL_SOURCES: Record<string, string> = {
  'tool-1:3':
    'export async function run(ctx) {\n  const headlines = await ctx.fetch("https://news.example.com/overnight");\n  return summarize(headlines);\n}',
  'tool-1:2':
    'export async function run(ctx) {\n  const headlines = await ctx.fetch("https://news.example.com/overnight");\n  return headlines;\n}',
  'tool-1:1': 'export async function run(ctx) {\n  return "good morning";\n}',
  'tool-2:1': 'export async function run(ctx) {\n  return draftReply(ctx.messages);\n}',
};

const TOOL_VERSIONS: ToolVersion[] = [
  {
    id: 'tool-1-v3',
    toolId: 'tool-1',
    version: 3,
    message: 'Summarize the headlines',
    hosts: ['news.example.com', 'api.example.com'],
    createdBy: 'julio',
    createdAt: '2026-10-03T10:00:00.000Z',
  },
  {
    id: 'tool-1-v2',
    toolId: 'tool-1',
    version: 2,
    message: 'Add the API host',
    hosts: ['news.example.com', 'api.example.com'],
    createdBy: 'julio',
    createdAt: '2026-10-02T10:00:00.000Z',
  },
  {
    id: 'tool-1-v1',
    toolId: 'tool-1',
    version: 1,
    message: 'First draft',
    hosts: [],
    createdBy: 'julio',
    createdAt: '2026-10-01T10:00:00.000Z',
  },
  {
    id: 'tool-2-v1',
    toolId: 'tool-2',
    version: 1,
    message: 'First draft',
    hosts: [],
    createdBy: 'julio',
    createdAt: '2026-10-01T10:00:00.000Z',
  },
];

const TOOL_RUNS: ToolRun[] = [
  {
    id: 'run-1',
    toolId: 'tool-1',
    version: 3,
    trigger: 'manual',
    status: 'ok',
    errorKind: null,
    durationMs: 120,
    fetchCount: 1,
    outputText: 'Overnight headlines: markets up, weather clear.',
    createdAt: '2026-10-03T09:00:00.000Z',
  },
  {
    id: 'run-2',
    toolId: 'tool-1',
    version: 2,
    trigger: 'routine',
    status: 'error',
    errorKind: 'timeout',
    durationMs: 5000,
    fetchCount: 1,
    outputText: null,
    createdAt: '2026-10-02T09:00:00.000Z',
  },
  {
    id: 'run-3',
    toolId: 'tool-1',
    version: 3,
    trigger: 'manual',
    status: 'ok',
    errorKind: null,
    durationMs: 200,
    fetchCount: 2,
    outputText: `${'Headline digest line. '.repeat(120)}end.`,
    createdAt: '2026-10-03T08:00:00.000Z',
  },
];

/** A `ToolsApi` backed by the mock data, for offline UI work and screenshots. */
export function createMockToolsApi(): AiToolsApi {
  const tools = [...TOOLS];
  const routines = ROUTINES.map((routine) => ({ ...routine }));
  const sources: Record<string, string> = { ...TOOL_SOURCES };
  const versions: ToolVersion[] = TOOL_VERSIONS.map((version) => ({
    ...version,
    hosts: [...version.hosts],
  }));
  const runs: ToolRun[] = TOOL_RUNS.map((run) => ({ ...run }));
  let nextMockRunId = runs.length + 1;
  const findRoutine = (id: string): Routine => {
    const routine = routines.find((item) => item.id === id);
    if (routine === undefined) {
      throw new ToolsApiError(404, 'not_found', 'Routine not found');
    }
    return routine;
  };
  return {
    async listAiTools() {
      return [...tools];
    },
    async listAiRoutines() {
      return routines.map((routine) => ({ ...routine }));
    },
    async getTool(id: string) {
      const tool = tools.find((item) => item.id === id);
      if (tool === undefined) {
        throw new ToolsApiError(404, 'not_found', 'Tool not found');
      }
      return { ...tool, source: sources[`${id}:${tool.currentVersion}`] ?? '' } as ToolDetail;
    },
    async listToolVersions(id: string) {
      const listed = versions
        .filter((version) => version.toolId === id)
        .map((version) => ({ ...version, hosts: [...version.hosts] }));
      if (listed.length === 0 && tools.every((tool) => tool.id !== id)) {
        throw new ToolsApiError(404, 'not_found', 'Tool not found');
      }
      return listed;
    },
    async getToolVersion(id: string, version: number) {
      const found = versions.find((item) => item.toolId === id && item.version === version);
      if (found === undefined) {
        throw new ToolsApiError(404, 'not_found', 'Tool version not found');
      }
      return {
        ...found,
        hosts: [...found.hosts],
        source: sources[`${id}:${version}`] ?? '',
      } as ToolVersionDetail;
    },
    async listToolRuns(id: string) {
      if (tools.every((tool) => tool.id !== id)) {
        throw new ToolsApiError(404, 'not_found', 'Tool not found');
      }
      return runs.filter((run) => run.toolId === id).map((run) => ({ ...run }));
    },
    async pauseRoutine(id: string) {
      const routine = findRoutine(id);
      if (routine.status === 'active') {
        routine.status = 'paused';
        routine.pausedReason = 'user';
      }
      return { ...routine };
    },
    async resumeRoutine(id: string) {
      const routine = findRoutine(id);
      if (routine.status === 'needs_approval') {
        throw new ToolsApiError(409, 'needs_approval', 'The routine needs re-approval');
      }
      if (routine.status === 'paused') {
        routine.status = 'active';
        routine.pausedReason = null;
      }
      return { ...routine };
    },
    async deleteRoutine(id: string) {
      const index = routines.findIndex((item) => item.id === id);
      if (index === -1) {
        throw new ToolsApiError(404, 'not_found', 'Routine not found');
      }
      routines.splice(index, 1);
    },
    async revertTool(id: string, version: number) {
      const tool = tools.find((item) => item.id === id);
      if (tool === undefined) {
        throw new ToolsApiError(404, 'not_found', 'Tool not found');
      }
      const source = versions.find((item) => item.toolId === id && item.version === version);
      if (source === undefined) {
        throw new ToolsApiError(404, 'not_found', 'Tool version not found');
      }
      const nextVersion = tool.currentVersion + 1;
      const reverted: ToolVersion = {
        id: `${id}-v${nextVersion}`,
        toolId: id,
        version: nextVersion,
        message: `Revert to v${version}`,
        hosts: [...source.hosts],
        createdBy: 'julio',
        createdAt: '2026-10-04T10:00:00.000Z',
      };
      versions.unshift(reverted);
      sources[`${id}:${nextVersion}`] = sources[`${id}:${version}`] ?? '';
      tool.currentVersion = nextVersion;
      return { ...reverted, hosts: [...reverted.hosts] };
    },
    async runToolNow(id: string, input?: unknown) {
      const tool = tools.find((item) => item.id === id);
      if (tool === undefined) {
        throw new ToolsApiError(404, 'not_found', 'Tool not found');
      }
      const failed = id === 'tool-2';
      const result: ToolRunResult = failed
        ? {
            ok: false,
            error: { kind: 'timeout', message: 'The tool took too long.' },
            logs: '',
            durationMs: 5000,
            fetchCount: 0,
          }
        : {
            ok: true,
            output: {
              text: `Ran ${tool.name}${input === undefined ? '' : ` with ${JSON.stringify(input)}`}.`,
            },
            logs: '',
            durationMs: 120,
            fetchCount: 1,
          };
      runs.unshift({
        id: `run-mock-${nextMockRunId++}`,
        toolId: id,
        version: tool.currentVersion,
        trigger: 'manual',
        status: result.ok ? 'ok' : 'error',
        errorKind: result.ok ? null : result.error.kind,
        durationMs: result.durationMs,
        fetchCount: result.fetchCount,
        outputText: result.ok ? result.output.text : null,
        createdAt: '2026-10-04T09:00:00.000Z',
      });
      return result;
    },
    async deleteTool(id: string) {
      const index = tools.findIndex((item) => item.id === id);
      if (index === -1) {
        throw new ToolsApiError(404, 'not_found', 'Tool not found');
      }
      tools.splice(index, 1);
      for (let at = versions.length - 1; at >= 0; at -= 1) {
        if (versions[at]?.toolId === id) {
          versions.splice(at, 1);
        }
      }
      for (const key of Object.keys(sources)) {
        if (key === id || key.startsWith(`${id}:`)) {
          delete sources[key];
        }
      }
      for (let at = runs.length - 1; at >= 0; at -= 1) {
        if (runs[at]?.toolId === id) {
          runs.splice(at, 1);
        }
      }
    },
  };
}
