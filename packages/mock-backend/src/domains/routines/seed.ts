// The routines seed (T-0941): one active routine and one paused routine, ported
// from web's `seedRoutines`. `aiId` uses the unified row id from
// `data/people.ts` (`ai-dev-1`); the tool ids match the tools domain's seed.
import type { MockSeed } from '../../data';

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

/** One active routine (morning prices) and one paused routine (standup notes). */
export function seedRoutines(): readonly MockRoutine[] {
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

export function seedRoutinesTable(): Partial<MockSeed> {
  return { routines: seedRoutines() };
}
