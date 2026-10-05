import { describe, expect, it } from 'vitest';

import type { Routine, ToolListItem } from './tools-api';
import {
  describeRoutineSchedule,
  hostsLine,
  nextRunText,
  pausedReasonText,
  routineLastText,
  routineStatusText,
  toolLastRunText,
  truncateOutput,
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

describe('describeRoutineSchedule (T-0189, copy of web)', () => {
  it('words an hourly interval', () => {
    expect(describeRoutineSchedule({ kind: 'interval', everyMinutes: 60 })).toBe('every 1 hour');
    expect(describeRoutineSchedule({ kind: 'interval', everyMinutes: 360 })).toBe('every 6 hours');
  });

  it('words daily and multi-day intervals', () => {
    expect(describeRoutineSchedule({ kind: 'interval', everyMinutes: 1440 })).toBe('every 1 day');
    expect(describeRoutineSchedule({ kind: 'interval', everyMinutes: 10080 })).toBe('every 7 days');
  });

  it('words a minute interval that is not a whole hour', () => {
    expect(describeRoutineSchedule({ kind: 'interval', everyMinutes: 90 })).toBe(
      'every 90 minutes',
    );
  });

  it('words a daily schedule with all days', () => {
    expect(
      describeRoutineSchedule({ kind: 'daily', time: '09:00', timezone: 'Europe/Madrid' }),
    ).toBe('daily at 09:00 Europe/Madrid');
  });

  it('words a daily schedule with weekdays', () => {
    expect(
      describeRoutineSchedule({
        kind: 'daily',
        time: '09:00',
        timezone: 'Europe/Madrid',
        weekdays: [5, 1, 3],
      }),
    ).toBe('daily at 09:00 Europe/Madrid on Mon, Wed, Fri');
  });

  it('falls back to plain words for unknown shapes', () => {
    expect(describeRoutineSchedule(null)).toBe('on a schedule');
    expect(describeRoutineSchedule({ kind: 'weekly' })).toBe('on a schedule');
    expect(
      describeRoutineSchedule({ kind: 'daily', time: '25:00', timezone: 'Europe/Madrid' }),
    ).toBe('on a schedule');
    expect(describeRoutineSchedule({ kind: 'daily', time: '09:00', timezone: '' })).toBe(
      'on a schedule',
    );
    expect(describeRoutineSchedule({ kind: 'interval', everyMinutes: 30 })).toBe('on a schedule');
  });
});

describe('pausedReasonText (T-0189, copy of web)', () => {
  it('explains each paused reason with its next step', () => {
    expect(pausedReasonText('user', 'paused')).toBe('Paused by a person.');
    expect(pausedReasonText('failures', 'paused')).toContain('Ask the AI to fix it.');
    expect(pausedReasonText('hosts_changed', 'paused')).toContain(
      'Ask the AI to schedule it again',
    );
    expect(pausedReasonText(null, 'needs_approval')).toContain('Ask the AI to schedule it again');
    expect(pausedReasonText(null, 'active')).toBeNull();
  });
});

describe('truncateOutput (T-0189, copy of web)', () => {
  it('keeps short output whole and cuts long output', () => {
    expect(truncateOutput('ok')).toEqual({ preview: 'ok', truncated: false });
    const long = `x${'y'.repeat(3000)}`;
    const cut = truncateOutput(long);
    expect(cut.truncated).toBe(true);
    expect(cut.preview.endsWith('…')).toBe(true);
    expect(cut.preview.length).toBeLessThan(long.length);
  });
});

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
