import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { schemaIssues, stateFileSchema, taskFrontMatterSchema } from './types';

describe('stateFileSchema', () => {
  const fullTask = {
    task: 'T-1000',
    sessionId: 'ses_full',
    worktree: '/tmp/full',
    model: 'opencode-go/muse-spark-1.3-contributor',
    role: 'worker',
    startedAt: '2026-10-07T00:00:00.000Z',
    switchedAt: '2026-10-07T01:00:00.000Z',
    nudgesSent: 2,
    lastQuotaRetryAt: 111,
    lastQuotaEscalatedAt: 222,
    prereview: {
      sessionId: 'ses_prereview',
      head: 'a'.repeat(40),
      startedAt: '2026-10-07T02:00:00.000Z',
      model: 'opencode/muse-spark-1.3-contributor-free',
    },
    packetReadyForHead: 'b'.repeat(40),
    prereviewStalledEscalated: true,
    autoFixRounds: 3,
    escalatedPermissionIds: ['perm_1', 'perm_2'],
    escalatedQuestionIds: ['q_1'],
    stalledEscalated: true,
    blockedEscalatedText: 'blocked text',
    lastEscalation: '2026-10-07T03:00:00.000Z',
  };

  const minimalTask = {
    task: 'T-1001',
    sessionId: 'ses_min',
    worktree: '/tmp/min',
    model: 'auto',
    role: 'prereview',
    startedAt: '2026-10-07T00:00:00.000Z',
  };

  const doctor = {
    sessionId: 'ses_doctor',
    head: 'c'.repeat(40),
    since: 'd'.repeat(40),
    startedAt: '2026-10-07T00:00:00.000Z',
    reportedForHead: 'e'.repeat(40),
    stalledReportedForHead: 'f'.repeat(40),
    model: 'meta/muse-spark-1.3-contributor',
  };

  it('round-trips the state file with defaults and drops unknown keys', () => {
    const decoded = Schema.decodeUnknownSync(stateFileSchema)({
      version: 1,
      tasks: {
        'T-1000': fullTask,
        'T-1001': { ...minimalTask, unknownExtra: 'drop me' },
      },
      doctor,
    });

    expect(decoded.version).toBe(1);
    expect(Object.keys(decoded.tasks)).toEqual(['T-1000', 'T-1001']);

    const full = decoded.tasks['T-1000']!;
    expect(full).toMatchObject(fullTask);
    expect(full.prereview).toEqual(fullTask.prereview);
    expect(full.packetReadyForHead).toBe(fullTask.packetReadyForHead);
    expect(full.lastEscalation).toBe(fullTask.lastEscalation);
    expect(full.escalatedPermissionIds).toEqual(['perm_1', 'perm_2']);

    const minimal = decoded.tasks['T-1001']!;
    expect(minimal.task).toBe('T-1001');
    expect(minimal.role).toBe('prereview');
    expect(minimal.nudgesSent).toBe(0);
    expect(minimal.prereviewStalledEscalated).toBe(false);
    expect(minimal.autoFixRounds).toBe(0);
    expect(minimal.escalatedPermissionIds).toEqual([]);
    expect(minimal.escalatedQuestionIds).toEqual([]);
    expect(minimal.stalledEscalated).toBe(false);
    expect(minimal.switchedAt).toBeUndefined();
    expect(minimal.prereview).toBeUndefined();
    expect(minimal.packetReadyForHead).toBeUndefined();
    expect(minimal.lastEscalation).toBeUndefined();
    expect('unknownExtra' in minimal).toBe(false);

    expect(decoded.doctor).toEqual(doctor);
  });
});

describe('taskFrontMatterSchema', () => {
  it('accepts effort: default', () => {
    const decoded = Schema.decodeUnknownSync(taskFrontMatterSchema)({
      id: 'T-0038',
      branch: 'task/x',
      model: 'auto',
      status: 'todo',
      effort: 'default',
    });

    expect(decoded.effort).toBe('default');
  });

  it('rejects effort: huge with a message naming effort', () => {
    const result = Schema.decodeUnknownResult(taskFrontMatterSchema)({
      id: 'T-0038',
      branch: 'task/x',
      model: 'auto',
      status: 'todo',
      effort: 'huge',
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      const detail = schemaIssues(result.failure)
        .map((issue) => `${issue.path || 'front matter'}: ${issue.message}`)
        .join('; ');
      expect(detail).toContain('effort');
    }
  });
});
