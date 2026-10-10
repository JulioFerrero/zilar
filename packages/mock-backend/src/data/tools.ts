// The tools and routines seed (T-0941): two tools with version history and two
// routines, ported from web's `seedTools`/`seedRoutines`/`seedRuns`. `aiId`
// uses the unified row id from `data/people.ts` (`ai-dev-1`); group and topic
// ids match the chat/topic seeds (`g-devteam`, `t-devteam-bug`).

import { currentUser } from './people';

/** One tool with its version history, mirroring the server's `ai_tools` rows. */
export interface MockTool {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  name: string;
  description: string;
  approvedHosts: string[];
  versions: MockToolVersion[];
  deleted: boolean;
}

export interface MockToolVersion {
  id: string;
  version: number;
  source: string;
  hosts: string[];
  message: string;
  createdBy: string;
  createdAt: string;
}

/** One routine row, mirroring the server's `routines` (no tool source). */
export interface MockRoutine {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  toolId: string;
  title: string;
  schedule: unknown;
  status: 'active' | 'paused' | 'needs_approval';
  pausedReason: 'user' | 'failures' | 'hosts_changed' | null;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: 'ok' | 'error' | 'skipped' | null;
  approvedHosts: string[];
  deleted: boolean;
}

/** One recorded run row, mirroring the server's `ai_tool_runs`. */
export interface MockRun {
  id: string;
  toolId: string;
  version: number;
  trigger: 'manual' | 'routine' | 'ai';
  status: 'ok' | 'error';
  errorKind: string | null;
  durationMs: number;
  fetchCount: number;
  outputText: string | null;
  createdAt: string;
}

export function seedTools(): MockTool[] {
  return [
    {
      id: 'tool-mock-prices',
      aiId: 'ai-dev-1',
      groupId: 'g-devteam',
      topicId: 't-devteam-bug',
      name: 'prices',
      description: 'Fetches the morning prices.',
      approvedHosts: ['api.example.com'],
      versions: [
        {
          id: 'tool-mock-prices-v1',
          version: 1,
          source: 'export function run() {\n  return fetchPrices(["gold"]);\n}',
          hosts: [],
          message: 'First version',
          createdBy: currentUser.id,
          createdAt: '2026-09-28T09:00:00.000Z',
        },
        {
          id: 'tool-mock-prices-v2',
          version: 2,
          source:
            'export function run(input) {\n  const symbols = input?.symbols ?? ["gold", "BTC"];\n  return fetchPrices(symbols);\n}',
          hosts: ['api.example.com', 'prices.example.com'],
          message: 'Add the price host',
          createdBy: currentUser.id,
          createdAt: '2026-09-29T09:00:00.000Z',
        },
      ],
      deleted: false,
    },
    {
      id: 'tool-mock-notes',
      aiId: 'ai-dev-1',
      groupId: 'g-devteam',
      topicId: 't-devteam-general',
      name: 'notes',
      description: 'Formats the standup notes.',
      approvedHosts: [],
      versions: [
        {
          id: 'tool-mock-notes-v1',
          version: 1,
          source: 'export function run(input) {\n  return formatNotes(input);\n}',
          hosts: [],
          message: 'First version',
          createdBy: currentUser.id,
          createdAt: '2026-09-27T09:00:00.000Z',
        },
        {
          id: 'tool-mock-notes-v2',
          version: 2,
          source: 'export function run(input) {\n  return formatNotes(input, { trim: true });\n}',
          hosts: [],
          message: 'Trim long lines',
          createdBy: currentUser.id,
          createdAt: '2026-09-28T09:00:00.000Z',
        },
      ],
      deleted: false,
    },
  ];
}

/** One active routine (morning prices) and one paused routine (standup notes). */
export function seedRoutines(): MockRoutine[] {
  return [
    {
      id: 'routine-mock-morning',
      aiId: 'ai-dev-1',
      groupId: 'g-devteam',
      topicId: 't-devteam-bug',
      toolId: 'tool-mock-prices',
      title: 'Morning prices',
      schedule: {
        kind: 'daily',
        time: '09:00',
        timezone: 'Europe/Madrid',
        weekdays: [1, 2, 3, 4, 5],
      },
      status: 'active',
      pausedReason: null,
      nextRunAt: '2026-10-01T09:00:00.000Z',
      lastRunAt: '2026-09-30T09:00:00.000Z',
      lastStatus: 'ok',
      approvedHosts: ['api.example.com'],
      deleted: false,
    },
    {
      id: 'routine-mock-standup',
      aiId: 'ai-dev-1',
      groupId: 'g-devteam',
      topicId: 't-devteam-general',
      toolId: 'tool-mock-notes',
      title: 'Standup notes',
      schedule: { kind: 'interval', everyMinutes: 1440 },
      status: 'paused',
      pausedReason: 'user',
      nextRunAt: '2026-10-01T09:30:00.000Z',
      lastRunAt: '2026-09-29T09:30:00.000Z',
      lastStatus: 'ok',
      approvedHosts: [],
      deleted: false,
    },
  ];
}

export function seedRuns(): MockRun[] {
  return [
    {
      id: 'run-mock-1',
      toolId: 'tool-mock-prices',
      version: 2,
      trigger: 'routine',
      status: 'ok',
      errorKind: null,
      durationMs: 240,
      fetchCount: 2,
      outputText: 'gold 4300, BTC 114000',
      createdAt: '2026-09-30T09:00:00.000Z',
    },
    {
      id: 'run-mock-2',
      toolId: 'tool-mock-prices',
      version: 1,
      trigger: 'manual',
      status: 'error',
      errorKind: 'fetch_failed',
      durationMs: 1200,
      fetchCount: 0,
      outputText: null,
      createdAt: '2026-09-29T10:00:00.000Z',
    },
  ];
}
