import { describe, expect, it } from 'vitest';
import {
  applyRecordPatch,
  decide,
  QUOTA_ESCALATE_MS,
  QUOTA_RETRY_MS,
  type Action,
  type DecideInput,
  type RecordPatch,
} from './decide';
import { newTaskRecord, type TaskRecord } from './types';

const WORKTREE = '/Users/julio/personal-projects/galena-T-0038';

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    ...newTaskRecord({
      task: 'T-0038',
      sessionId: 'ses_test',
      worktree: WORKTREE,
      model: 'opencode-go/muse-spark-1.3-contributor',
      role: 'worker',
      startedAt: '2026-09-28T00:00:00.000Z',
    }),
    ...overrides,
  };
}

function base(overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    now: 1_000_000,
    task: 'T-0038',
    worktree: WORKTREE,
    record: record(),
    sessionState: 'running',
    quotaError: false,
    questionRunning: false,
    questionText: '',
    questionIds: [],
    permissions: [],
    taskStatus: 'in-progress',
    taskFilePresent: true,
    blockedText: '',
    head: 'abc123',
    prereviewFilePresent: false,
    prereviewVerdict: '',
    prereviewSessionState: 'none',
    ...overrides,
  };
}

function escalations(actions: Action[]): string[] {
  return actions.filter((action) => action.kind === 'escalate').map((action) => action.line);
}

// Folds every { kind: 'record' } action's patch into the record, the way the
// autopilot tick does when it applies decide()'s output.
function applyAll(start: TaskRecord, actions: Action[]): TaskRecord {
  return actions
    .filter((action): action is { kind: 'record'; patch: RecordPatch } => action.kind === 'record')
    .map((action) => action.patch)
    .reduce(applyRecordPatch, start);
}

describe('decide permissions', () => {
  it('replies once to an allowed command', () => {
    const actions = decide(
      base({
        permissions: [{ id: 'per_1', action: 'shell', command: 'rm -rf dist' }],
      }),
    );
    expect(actions).toContainEqual({
      kind: 'reply-permission',
      requestId: 'per_1',
      decision: 'once',
    });
    expect(escalations(actions)).toEqual([]);
  });

  it('rejects a push with a message', () => {
    const actions = decide(
      base({
        permissions: [{ id: 'per_2', action: 'shell', command: 'git push --force' }],
      }),
    );
    const reply = actions.find((action) => action.kind === 'reply-permission');
    expect(reply).toMatchObject({ requestId: 'per_2', decision: 'reject' });
    expect((reply as { message?: string }).message ?? '').toMatch(/lead/i);
    expect(escalations(actions)).toEqual([]);
  });

  it('escalates an unknown command once, then stays quiet', () => {
    const first = decide(
      base({ permissions: [{ id: 'per_3', action: 'shell', command: 'npx expo install x' }] }),
    );
    const lines = escalations(first);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^LEAD: PERMISSION T-0038 per_3/);

    const updated = applyAll(base().record, first);
    const second = decide(
      base({
        record: updated,
        permissions: [{ id: 'per_3', action: 'shell', command: 'npx expo install x' }],
      }),
    );
    expect(escalations(second)).toEqual([]);
  });
});

describe('decide question tool', () => {
  it('escalates a running question with its text', () => {
    const actions = decide(
      base({
        questionRunning: true,
        questionText: 'Which simulator?',
        questionIds: ['call_q1'],
      }),
    );
    const lines = escalations(actions);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('QUESTION T-0038');
    expect(lines[0]).toContain('Which simulator?');
  });
});

describe('decide quota backoff', () => {
  it('re-prompts and escalates on the first quota error', () => {
    const actions = decide(base({ quotaError: true }));
    expect(actions).toContainEqual({ kind: 'send-prompt', template: 'resume' });
    expect(escalations(actions)).toHaveLength(1);
    expect(escalations(actions)[0]).toContain('QUOTA T-0038');
  });

  it('does nothing again a minute later', () => {
    const first = decide(base({ quotaError: true }));
    const updated = applyAll(base().record, first);
    const second = decide(base({ now: 1_000_000 + 60_000, record: updated, quotaError: true }));
    expect(second.filter((action) => action.kind !== 'record')).toEqual([]);
  });

  it('retries after 10 minutes without re-escalating', () => {
    const first = decide(base({ quotaError: true }));
    const updated = applyAll(base().record, first);
    const later = decide(
      base({ now: 1_000_000 + QUOTA_RETRY_MS + 1, record: updated, quotaError: true }),
    );
    expect(later).toContainEqual({ kind: 'send-prompt', template: 'resume' });
    expect(escalations(later)).toEqual([]);
  });

  it('escalates again after an hour', () => {
    const first = decide(base({ quotaError: true }));
    const updated = applyAll(base().record, first);
    const later = decide(
      base({ now: 1_000_000 + QUOTA_ESCALATE_MS + 1, record: updated, quotaError: true }),
    );
    expect(escalations(later)).toHaveLength(1);
  });

  it('quota handling only applies to todo/in-progress', () => {
    const actions = decide(base({ quotaError: true, taskStatus: 'review', sessionState: 'idle' }));
    expect(actions.some((action) => action.kind === 'send-prompt')).toBe(false);
  });
});

describe('decide stalls', () => {
  it('nudges twice, then escalates once', () => {
    const first = decide(base({ sessionState: 'idle' }));
    expect(first).toContainEqual({ kind: 'send-prompt', template: 'nudge' });
    const afterFirst = applyAll(base().record, first);

    const second = decide(base({ sessionState: 'idle', record: afterFirst }));
    expect(second).toContainEqual({ kind: 'send-prompt', template: 'nudge' });
    const afterSecond = applyAll(afterFirst, second);

    const third = decide(base({ sessionState: 'idle', record: afterSecond }));
    expect(escalations(third)).toHaveLength(1);
    expect(escalations(third)[0]).toContain('STALLED T-0038');
    const afterThird = applyAll(afterSecond, third);

    const fourth = decide(base({ sessionState: 'idle', record: afterThird }));
    expect(fourth.filter((action) => action.kind !== 'record')).toEqual([]);
  });

  it('does nothing while the worker is running', () => {
    expect(decide(base({ sessionState: 'running' }))).toEqual([]);
  });
});

describe('decide review', () => {
  const reviewBase = { taskStatus: 'review', sessionState: 'idle' as const };

  it('starts a pre-review once per HEAD', () => {
    const actions = decide(base({ ...reviewBase, head: 'deadbee' }));
    expect(actions).toContainEqual({ kind: 'start-prereview', head: 'deadbee' });
  });

  it('reports the packet when the pre-review is idle and PREREVIEW.md exists', () => {
    const actions = decide(
      base({
        ...reviewBase,
        head: 'deadbee',
        record: record({ prereview: { sessionId: 'ses_pre', head: 'deadbee', startedAt: 'x' } }),
        prereviewSessionState: 'idle',
        prereviewFilePresent: true,
        prereviewVerdict: 'Verdict: approved',
      }),
    );
    const lines = escalations(actions);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('PACKET READY T-0038');
    expect(lines[0]).toContain('Verdict: approved');
  });

  it('does not report the packet twice for the same HEAD', () => {
    const withPacket = record({
      prereview: { sessionId: 'ses_pre', head: 'deadbee', startedAt: 'x' },
      packetReadyForHead: 'deadbee',
    });
    const actions = decide(
      base({
        ...reviewBase,
        head: 'deadbee',
        record: withPacket,
        prereviewSessionState: 'idle',
        prereviewFilePresent: true,
        prereviewVerdict: 'Verdict: approved',
      }),
    );
    expect(escalations(actions)).toEqual([]);
  });

  it('waits while the pre-review is still running', () => {
    const actions = decide(
      base({
        ...reviewBase,
        head: 'deadbee',
        record: record({ prereview: { sessionId: 'ses_pre', head: 'deadbee', startedAt: 'x' } }),
        prereviewSessionState: 'running',
        prereviewFilePresent: false,
      }),
    );
    expect(actions).toEqual([]);
  });

  it('does nothing while the worker is still running', () => {
    expect(decide(base({ taskStatus: 'review', sessionState: 'running' }))).toEqual([]);
  });
});

describe('decide blocked', () => {
  it('escalates with the blocked text, once per text', () => {
    const blocked = base({ taskStatus: 'blocked', blockedText: 'Need the Apple account.\n' });
    const lines = escalations(decide(blocked));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('BLOCKED T-0038');
    expect(lines[0]).toContain('Need the Apple account.');

    const updated = applyAll(base().record, decide(blocked));
    expect(
      escalations(
        decide(base({ taskStatus: 'blocked', blockedText: blocked.blockedText, record: updated })),
      ),
    ).toEqual([]);
  });

  it('escalates again when the blocked text changes', () => {
    const updated = record({ blockedEscalatedText: 'old question' });
    const lines = escalations(
      decide(base({ taskStatus: 'blocked', blockedText: 'new question', record: updated })),
    );
    expect(lines).toHaveLength(1);
  });
});

describe('decide misc', () => {
  it('returns nothing without a task file', () => {
    expect(decide(base({ taskFilePresent: false })).length).toBe(0);
  });
});
