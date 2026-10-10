// The tools and runs seed (T-0941): two tools with version history and their
// two runs, ported from web's `seedTools`/`seedRuns`. `aiId` uses the unified
// row id from `data/people.ts` (`ai-dev-1`); group and topic ids match the
// chat/topic seeds (`g-devteam`, `t-devteam-bug`). Routines live in their own
// domain folder but share this schema's `groupId`/`topicId` keys.
import type { MockSeed } from '../../data';
import { currentUser } from '../../data/people';

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

export function seedTools(): readonly MockTool[] {
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

export function seedRuns(): readonly MockRun[] {
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

export function seedToolsAndRuns(): Partial<MockSeed> {
  return { tools: seedTools(), runs: seedRuns() };
}
