import type { Routine, ToolListItem } from '../lib/tools-api';

/**
 * Mock tools and routines API for the AI edit screen (T-0189). Two tools
 * (one with hosts and approved hosts, one with no hosts and never run)
 * and two routines (one active, one paused with reason `failures`).
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
];

/** A `ToolsApi` backed by the mock data, for offline UI work and screenshots. */
export function createMockToolsApi(): {
  listAiTools(aiId: string): Promise<ToolListItem[]>;
  listAiRoutines(aiId: string): Promise<Routine[]>;
} {
  return {
    async listAiTools() {
      return [...TOOLS];
    },
    async listAiRoutines() {
      return [...ROUTINES];
    },
  };
}
