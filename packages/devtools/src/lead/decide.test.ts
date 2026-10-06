import { describe, expect, it } from 'vitest';
import {
  applyRecordPatch,
  AUTOFIX_LIMIT,
  decide,
  QUOTA_ESCALATE_MS,
  QUOTA_RETRY_MS,
  type Action,
  type DecideInput,
  type FindingCounts,
  type RecordPatch,
} from './decide';
import { newTaskRecord, type TaskRecord } from './types';

const WORKTREE = '/Users/julio/personal-projects/zilar-T-0038';

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
    prereviewPermissions: [],
    taskStatus: 'in-progress',
    taskFilePresent: true,
    blockedText: '',
    head: 'abc123',
    prereviewFilePresent: false,
    prereviewVerdict: '',
    prereviewCounts: undefined,
    prereviewSessionState: 'none',
    prereviewQuotaError: false,
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
        permissions: [{ id: 'per_1', action: 'shell', commands: ['rm -rf dist'] }],
      }),
    );
    expect(actions).toContainEqual({
      kind: 'reply-permission',
      session: 'worker',
      requestId: 'per_1',
      decision: 'once',
    });
    expect(escalations(actions)).toEqual([]);
  });

  it('rejects a push with a message', () => {
    const actions = decide(
      base({
        permissions: [{ id: 'per_2', action: 'shell', commands: ['git push --force'] }],
      }),
    );
    const reply = actions.find((action) => action.kind === 'reply-permission');
    expect(reply).toMatchObject({ requestId: 'per_2', decision: 'reject' });
    expect((reply as { message?: string }).message ?? '').toMatch(/lead/i);
    expect(escalations(actions)).toEqual([]);
  });

  it('escalates an unknown command once, then stays quiet', () => {
    const first = decide(
      base({ permissions: [{ id: 'per_3', action: 'shell', commands: ['npx expo install x'] }] }),
    );
    const lines = escalations(first);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^LEAD: PERMISSION T-0038 per_3/);

    const updated = applyAll(base().record, first);
    const second = decide(
      base({
        record: updated,
        permissions: [{ id: 'per_3', action: 'shell', commands: ['npx expo install x'] }],
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
  it('falls back in place on the free model with a quota error', () => {
    const actions = decide(
      base({
        quotaError: true,
        record: record({ model: 'opencode/muse-spark-1.3-contributor-free' }),
      }),
    );
    expect(actions).toContainEqual({
      kind: 'fallback-model',
      session: 'worker',
      model: 'meta/muse-spark-1.3-contributor',
    });
    expect(escalations(actions)).toEqual([
      'LEAD: FALLBACK T-0038 free Muse failed or rate-limited, worker continues on paid Muse',
    ]);
    expect(actions.some((action) => action.kind === 'send-prompt')).toBe(false);
  });

  it('names DeepSeek flash when the DeepSeek model falls back', () => {
    const actions = decide(
      base({
        quotaError: true,
        record: record({ model: 'deepseek/deepseek-flash' }),
      }),
    );
    expect(actions).toContainEqual({
      kind: 'fallback-model',
      session: 'worker',
      model: 'meta/muse-spark-1.3-contributor',
    });
    expect(escalations(actions)).toEqual([
      'LEAD: FALLBACK T-0038 DeepSeek flash failed or rate-limited, worker continues on paid Muse',
    ]);
  });

  it('keeps the resume path on the paid model', () => {
    const actions = decide(
      base({
        quotaError: true,
        record: record({ model: 'meta/muse-spark-1.3-contributor' }),
      }),
    );
    expect(actions.some((action) => action.kind === 'fallback-model')).toBe(false);
    expect(actions).toContainEqual({ kind: 'send-prompt', template: 'resume' });
    expect(escalations(actions)[0]).toContain('QUOTA T-0038');
  });

  it('re-prompts and escalates on the first quota error', () => {
    const paid = record({ model: 'meta/muse-spark-1.3-contributor' });
    const actions = decide(base({ quotaError: true, record: paid }));
    expect(actions).toContainEqual({ kind: 'send-prompt', template: 'resume' });
    expect(escalations(actions)).toHaveLength(1);
    expect(escalations(actions)[0]).toContain('QUOTA T-0038');
  });

  it('does nothing again a minute later', () => {
    const paid = record({ model: 'meta/muse-spark-1.3-contributor' });
    const first = decide(base({ quotaError: true, record: paid }));
    const updated = applyAll(paid, first);
    const second = decide(base({ now: 1_000_000 + 60_000, record: updated, quotaError: true }));
    expect(second.filter((action) => action.kind !== 'record')).toEqual([]);
  });

  it('retries after 10 minutes without re-escalating', () => {
    const paid = record({ model: 'meta/muse-spark-1.3-contributor' });
    const first = decide(base({ quotaError: true, record: paid }));
    const updated = applyAll(paid, first);
    const later = decide(
      base({ now: 1_000_000 + QUOTA_RETRY_MS + 1, record: updated, quotaError: true }),
    );
    expect(later).toContainEqual({ kind: 'send-prompt', template: 'resume' });
    expect(escalations(later)).toEqual([]);
  });

  it('escalates again after an hour', () => {
    const paid = record({ model: 'meta/muse-spark-1.3-contributor' });
    const first = decide(base({ quotaError: true, record: paid }));
    const updated = applyAll(paid, first);
    const later = decide(
      base({ now: 1_000_000 + QUOTA_ESCALATE_MS + 1, record: updated, quotaError: true }),
    );
    expect(escalations(later)).toHaveLength(1);
  });

  it('quota handling only applies to todo/in-progress', () => {
    const paid = record({ model: 'meta/muse-spark-1.3-contributor' });
    const actions = decide(
      base({ quotaError: true, taskStatus: 'review', sessionState: 'idle', record: paid }),
    );
    expect(actions.some((action) => action.kind === 'send-prompt')).toBe(false);
  });

  it('falls back in place for a planned task on the free model with a quota error', () => {
    const actions = decide(
      base({
        taskStatus: 'planned',
        quotaError: true,
        sessionState: 'idle',
        record: record({ model: 'opencode/muse-spark-1.3-contributor-free' }),
      }),
    );
    expect(actions).toContainEqual({
      kind: 'fallback-model',
      session: 'worker',
      model: 'meta/muse-spark-1.3-contributor',
    });
    expect(escalations(actions)).toEqual([
      'LEAD: FALLBACK T-0038 free Muse failed or rate-limited, worker continues on paid Muse',
    ]);
  });

  it('does nothing for a planned task on the paid model with a quota error', () => {
    const actions = decide(
      base({
        taskStatus: 'planned',
        quotaError: true,
        sessionState: 'idle',
        record: record({ model: 'meta/muse-spark-1.3-contributor' }),
      }),
    );
    expect(actions).toEqual([]);
  });

  it('does nothing for a planned task on the free model without a quota error', () => {
    const actions = decide(
      base({
        taskStatus: 'planned',
        quotaError: false,
        sessionState: 'idle',
        record: record({ model: 'opencode/muse-spark-1.3-contributor-free' }),
      }),
    );
    expect(actions).toEqual([]);
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

  describe('automatic fix rounds', () => {
    const packet = (counts: FindingCounts | undefined, rounds: number) =>
      base({
        ...reviewBase,
        head: 'deadbee',
        record: record({
          prereview: { sessionId: 'ses_pre', head: 'deadbee', startedAt: 'x' },
          autoFixRounds: rounds,
        }),
        prereviewSessionState: 'idle',
        prereviewFilePresent: true,
        prereviewVerdict: 'Verdict: needs work',
        prereviewCounts: counts,
      });

    it('sends must-fix and should-fix findings back to the worker', () => {
      const actions = decide(packet({ mustFix: 1, shouldFix: 2, nit: 3, followUp: 0 }, 0));
      expect(actions).toContainEqual({ kind: 'send-prompt', template: 'autofix' });
      expect(escalations(actions)).toEqual([
        'LEAD: AUTOFIX T-0038 round 1 (must-fix 1, should-fix 2)',
      ]);
      const next = applyAll(record(), actions);
      expect(next.autoFixRounds).toBe(1);
      expect(next.packetReadyForHead).toBe('deadbee');
    });

    it('stops after the round limit and hands the packet to the lead', () => {
      const actions = decide(
        packet({ mustFix: 1, shouldFix: 0, nit: 0, followUp: 0 }, AUTOFIX_LIMIT),
      );
      expect(actions.some((action) => action.kind === 'send-prompt')).toBe(false);
      expect(escalations(actions)[0]).toContain('PACKET READY T-0038 [NEEDS LEAD after 2');
    });

    it('announces a clean packet with only nits as CLEAN', () => {
      const actions = decide(packet({ mustFix: 0, shouldFix: 0, nit: 2, followUp: 0 }, 1));
      expect(actions.some((action) => action.kind === 'send-prompt')).toBe(false);
      expect(escalations(actions)[0]).toContain(
        'PACKET READY T-0038 [CLEAN after 1 auto round(s), nit 2]',
      );
    });

    it('starts no auto round for follow-ups alone and names them in the tag', () => {
      const actions = decide(packet({ mustFix: 0, shouldFix: 0, nit: 2, followUp: 1 }, 0));
      expect(actions.some((action) => action.kind === 'send-prompt')).toBe(false);
      expect(escalations(actions)).toHaveLength(1);
      expect(escalations(actions)[0]).toContain('PACKET READY T-0038 [CLEAN, nit 2, follow-up 1]');
    });

    it('still starts an auto round for should-fix when follow-ups are present', () => {
      const actions = decide(packet({ mustFix: 0, shouldFix: 1, nit: 0, followUp: 1 }, 0));
      expect(actions).toContainEqual({ kind: 'send-prompt', template: 'autofix' });
      expect(escalations(actions)).toEqual([
        'LEAD: AUTOFIX T-0038 round 1 (must-fix 0, should-fix 1)',
      ]);
    });

    it('names follow-ups on the NEEDS LEAD tag after the round limit', () => {
      const actions = decide(
        packet({ mustFix: 0, shouldFix: 1, nit: 0, followUp: 1 }, AUTOFIX_LIMIT),
      );
      expect(actions.some((action) => action.kind === 'send-prompt')).toBe(false);
      expect(escalations(actions)[0]).toContain(
        'PACKET READY T-0038 [NEEDS LEAD after 2 auto round(s): must-fix 0, should-fix 1, follow-up 1]',
      );
    });

    it('asks the lead to read the packet when the counts line is missing', () => {
      const actions = decide(packet(undefined, 0));
      expect(actions.some((action) => action.kind === 'send-prompt')).toBe(false);
      expect(escalations(actions)[0]).toContain('[no counts line, read it]');
    });
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

  it('falls back in place when a fix round hits a quota error on the free model', () => {
    const actions = decide(
      base({
        ...reviewBase,
        head: 'deadbee',
        quotaError: true,
        record: record({
          model: 'opencode/muse-spark-1.3-contributor-free',
          prereview: { sessionId: 'ses_pre', head: 'deadbee', startedAt: 'x' },
        }),
        prereviewSessionState: 'idle',
        prereviewFilePresent: true,
        prereviewVerdict: 'Verdict: needs work',
        prereviewCounts: { mustFix: 1, shouldFix: 0, nit: 0, followUp: 0 },
      }),
    );
    expect(actions).toContainEqual({
      kind: 'fallback-model',
      session: 'worker',
      model: 'meta/muse-spark-1.3-contributor',
    });
    expect(escalations(actions)).toEqual([
      'LEAD: FALLBACK T-0038 free Muse failed or rate-limited, worker continues on paid Muse',
    ]);
    expect(actions.some((action) => action.kind === 'send-prompt')).toBe(false);
  });

  it('falls back in place when a fix round hits a quota error on DeepSeek flash', () => {
    const actions = decide(
      base({
        ...reviewBase,
        head: 'deadbee',
        quotaError: true,
        record: record({
          model: 'deepseek/deepseek-flash',
          prereview: { sessionId: 'ses_pre', head: 'deadbee', startedAt: 'x' },
        }),
        prereviewSessionState: 'idle',
        prereviewFilePresent: false,
      }),
    );
    expect(actions).toContainEqual({
      kind: 'fallback-model',
      session: 'worker',
      model: 'meta/muse-spark-1.3-contributor',
    });
    expect(escalations(actions)).toEqual([
      'LEAD: FALLBACK T-0038 DeepSeek flash failed or rate-limited, worker continues on paid Muse',
    ]);
  });

  it('does not fall back in review without a quota error', () => {
    const actions = decide(
      base({
        ...reviewBase,
        head: 'deadbee',
        quotaError: false,
        record: record({ model: 'opencode/muse-spark-1.3-contributor-free' }),
      }),
    );
    expect(actions.some((action) => action.kind === 'fallback-model')).toBe(false);
    expect(actions).toContainEqual({ kind: 'start-prereview', head: 'deadbee' });
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

describe('decide pre-review sessions', () => {
  const reviewed = (overrides: Partial<DecideInput> = {}): DecideInput =>
    base({
      taskStatus: 'review',
      sessionState: 'idle',
      head: 'deadbee',
      record: record({
        prereview: { sessionId: 'ses_pre', head: 'deadbee', startedAt: 'x' },
      }),
      prereviewSessionState: 'running',
      ...overrides,
    });

  it('answers a pre-review allow with the pre-review session', () => {
    const actions = decide(
      reviewed({
        prereviewPermissions: [{ id: 'per_pre', action: 'shell', commands: ['rm -rf dist'] }],
      }),
    );
    expect(actions).toContainEqual({
      kind: 'reply-permission',
      session: 'prereview',
      requestId: 'per_pre',
      decision: 'once',
    });
  });

  it('escalates a pre-review unknown once, tagged as pre-review', () => {
    const permission = { id: 'per_pre', action: 'shell', commands: ['npx foo'] };
    const first = decide(reviewed({ prereviewPermissions: [permission] }));
    const lines = escalations(first);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^LEAD: PERMISSION T-0038 pre-review per_pre/);
    const updated = applyAll(reviewed().record, first);
    expect(
      escalations(decide(reviewed({ record: updated, prereviewPermissions: [permission] }))),
    ).toEqual([]);
  });

  it('escalates a pre-review that sits idle without PREREVIEW.md, once', () => {
    const first = decide(reviewed({ prereviewSessionState: 'idle', prereviewFilePresent: false }));
    const lines = escalations(first);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('PRE-REVIEW STALLED T-0038');
    const updated = applyAll(reviewed().record, first);
    expect(
      escalations(
        decide(
          reviewed({ record: updated, prereviewSessionState: 'idle', prereviewFilePresent: false }),
        ),
      ),
    ).toEqual([]);
  });

  it('does not stall-escalate while the pre-review is still running', () => {
    expect(escalations(decide(reviewed({ prereviewFilePresent: false })))).toEqual([]);
  });

  it('falls back the pre-review in place on a quota error with the free model', () => {
    const actions = decide(
      reviewed({
        prereviewSessionState: 'idle',
        prereviewFilePresent: false,
        prereviewQuotaError: true,
      }),
    );
    expect(actions).toContainEqual({
      kind: 'fallback-model',
      session: 'prereview',
      model: 'meta/muse-spark-1.3-contributor',
    });
    expect(escalations(actions)).toEqual([
      'LEAD: FALLBACK T-0038 pre-review continues on paid Muse',
    ]);
  });

  it('falls back a quota-hit pre-review whose session summarizes as running', () => {
    const actions = decide(
      reviewed({
        prereviewSessionState: 'running',
        prereviewFilePresent: false,
        prereviewQuotaError: true,
      }),
    );
    expect(actions).toContainEqual({
      kind: 'fallback-model',
      session: 'prereview',
      model: 'meta/muse-spark-1.3-contributor',
    });
    expect(escalations(actions)).toEqual([
      'LEAD: FALLBACK T-0038 pre-review continues on paid Muse',
    ]);
  });

  it('does not fall back a pre-review already on the paid model', () => {
    const paid = record({
      prereview: {
        sessionId: 'ses_pre',
        head: 'deadbee',
        startedAt: 'x',
        model: 'meta/muse-spark-1.3-contributor',
      },
    });
    const actions = decide(
      reviewed({
        record: paid,
        prereviewSessionState: 'idle',
        prereviewFilePresent: false,
        prereviewQuotaError: true,
      }),
    );
    expect(actions.some((action) => action.kind === 'fallback-model')).toBe(false);
    expect(escalations(actions)).toEqual([
      'LEAD: PRE-REVIEW STALLED T-0038 (idle, no PREREVIEW.md)',
    ]);
  });
});
