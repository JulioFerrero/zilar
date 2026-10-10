import { describe, expect, it } from 'vitest';

import type { Routine, ToolListItem } from './tools-api';
import {
  hostsLine,
  nextRunText,
  routineLastText,
  routineStatusText,
  toolLastRunText,
} from './routines-format';

function tool(overrides: Partial<ToolListItem> = {}): ToolListItem {
  return {
    id: 'tool-1',
    aiId: 'ai-1',
    groupId: null,
    topicId: null,
    name: 'Morning briefing',
    description: 'Fetches the overnight headlines.',
    currentVersion: 3,
    hosts: ['news.example.com', 'api.example.com'],
    approvedHosts: ['news.example.com', 'api.example.com'],
    lastRunStatus: 'ok',
    updatedAt: '2026-10-03T10:00:00.000Z',
    ...overrides,
  };
}

function routine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: 'routine-1',
    aiId: 'ai-1',
    groupId: null,
    topicId: null,
    toolId: 'tool-1',
    title: 'Weekday briefing',
    toolName: 'Morning briefing',
    schedule: { kind: 'interval', everyMinutes: 360 },
    status: 'active',
    pausedReason: null,
    nextRunAt: '2026-10-04T09:00:00.000Z',
    lastRunAt: '2026-10-03T09:00:00.000Z',
    lastStatus: 'ok',
    approvedHosts: [],
    ...overrides,
  };
}

describe('hostsLine', () => {
  it('reads no sites for an empty list and joins hosts otherwise', () => {
    expect(hostsLine([])).toBe('no sites');
    expect(hostsLine(['news.example.com'])).toBe('news.example.com');
    expect(hostsLine(['news.example.com', 'api.example.com'])).toBe(
      'news.example.com, api.example.com',
    );
  });
});

describe('toolLastRunText', () => {
  it('reads never run when the tool never ran', () => {
    const text = toolLastRunText(tool({ lastRunStatus: null }));
    expect(text.startsWith('never run · ')).toBe(true);
    expect(text).toContain(new Date('2026-10-03T10:00:00.000Z').toLocaleDateString());
  });

  it('reads the last run status otherwise', () => {
    expect(toolLastRunText(tool({ lastRunStatus: 'ok' })).startsWith('last run ok · ')).toBe(true);
    expect(toolLastRunText(tool({ lastRunStatus: 'error' })).startsWith('last run error · ')).toBe(
      true,
    );
  });
});

describe('routineStatusText', () => {
  it('words every routine status', () => {
    expect(routineStatusText(routine({ status: 'active' }))).toBe('active');
    expect(routineStatusText(routine({ status: 'paused' }))).toBe('paused');
    expect(routineStatusText(routine({ status: 'needs_approval' }))).toBe('needs approval');
  });
});

describe('nextRunText', () => {
  it('prefixes the next run date', () => {
    expect(nextRunText(routine())).toBe(
      `next ${new Date('2026-10-04T09:00:00.000Z').toLocaleString()}`,
    );
  });
});

describe('routineLastText', () => {
  it('reads never run when the routine never ran', () => {
    expect(routineLastText(routine({ lastStatus: null, lastRunAt: null }))).toBe('never run');
  });

  it('reads the last status with its date when known', () => {
    expect(routineLastText(routine())).toBe(
      `last ok · ${new Date('2026-10-03T09:00:00.000Z').toLocaleString()}`,
    );
    expect(routineLastText(routine({ lastStatus: 'skipped', lastRunAt: null }))).toBe(
      'last skipped',
    );
  });
});
