import { ToolsApiError, type Routine, type ToolListItem, type AiToolsApi } from '../lib/tools-api';

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

/** A `ToolsApi` backed by the mock data, for offline UI work and screenshots. */
export function createMockToolsApi(): AiToolsApi {
  const tools = [...TOOLS];
  const routines = ROUTINES.map((routine) => ({ ...routine }));
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
  };
}
