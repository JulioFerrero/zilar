import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeOpenCodeClient } from './client';
import { PAID_MUSE } from './fallback';
import {
  applyDoctorRecordPatch,
  decideDoctor,
  DOCTOR_DEBOUNCE_MS,
  doctorReportInfo,
  doctorWorktreeFor,
  ensureDoctorWorktree,
  renderDoctorPrompt,
  startDoctorSession,
  type DecideDoctorInput,
  type DoctorAction,
} from './doctor';
import type { GitRunner } from './git';
import { promptsDir } from './prompts';

const HEAD = 'a'.repeat(40);
const SINCE = 'b'.repeat(40);
const FALLBACK = 'c'.repeat(40);

function base(overrides: Partial<DecideDoctorInput> = {}): DecideDoctorInput {
  return {
    now: 1_000_000,
    mainHead: HEAD,
    mainHeadCommitMs: 1_000_000 - DOCTOR_DEBOUNCE_MS - 1,
    doctor: undefined,
    sinceFallback: FALLBACK,
    sessionState: 'none',
    reportFilePresent: false,
    counts: undefined,
    verdict: '',
    quotaError: false,
    ...overrides,
  };
}

function audited(overrides: Partial<DecideDoctorInput> = {}): DecideDoctorInput {
  return base({
    doctor: {
      sessionId: 'ses_doc',
      head: HEAD,
      since: SINCE,
      startedAt: '2026-10-04T00:00:00.000Z',
      reportedForHead: undefined,
      stalledReportedForHead: undefined,
    },
    sessionState: 'idle',
    ...overrides,
  });
}

function escalations(actions: DoctorAction[]): string[] {
  return actions.filter((action) => action.kind === 'escalate').map((action) => action.line);
}

describe('decideDoctor start', () => {
  it('starts on a new quiet head with the fallback since', () => {
    const actions = decideDoctor(base());
    expect(actions).toContainEqual({ kind: 'start-doctor', head: HEAD, since: FALLBACK });
  });

  it('waits while the head is younger than 10 minutes', () => {
    const actions = decideDoctor(base({ mainHeadCommitMs: 1_000_000 - DOCTOR_DEBOUNCE_MS + 1 }));
    expect(actions).toEqual([]);
  });

  it('starts on the exact debounce boundary', () => {
    const actions = decideDoctor(base({ mainHeadCommitMs: 1_000_000 - DOCTOR_DEBOUNCE_MS }));
    expect(actions).toContainEqual({ kind: 'start-doctor', head: HEAD, since: FALLBACK });
  });

  it('does not start while the session is running', () => {
    const actions = decideDoctor(
      base({
        doctor: {
          sessionId: 'ses_old',
          head: 'd'.repeat(40),
          since: SINCE,
          startedAt: 'x',
          reportedForHead: undefined,
          stalledReportedForHead: undefined,
        },
        sessionState: 'running',
      }),
    );
    expect(actions).toEqual([]);
  });

  it('does not start for an already audited head', () => {
    const actions = decideDoctor(audited({ reportFilePresent: false }));
    expect(actions.some((action) => action.kind === 'start-doctor')).toBe(false);
  });

  it('audits a new head from the previous audited head', () => {
    const actions = decideDoctor(
      base({
        mainHead: 'e'.repeat(40),
        doctor: {
          sessionId: 'ses_old',
          head: HEAD,
          since: SINCE,
          startedAt: 'x',
          reportedForHead: HEAD,
          stalledReportedForHead: undefined,
        },
      }),
    );
    expect(actions).toContainEqual({ kind: 'start-doctor', head: 'e'.repeat(40), since: HEAD });
  });
});

describe('decideDoctor escalate', () => {
  it('escalates once with counts', () => {
    const first = decideDoctor(
      audited({
        reportFilePresent: true,
        counts: { mustFix: 1, shouldFix: 2, nit: 3, followUp: 0 },
        verdict: 'Verdict: needs work, see findings',
      }),
    );
    const lines = escalations(first);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^LEAD: DOCTOR must-fix 1, should-fix 2, nit 3 since [0-9a-f]{7} \(/);
    expect(lines[0]).toContain('Verdict: needs work');
    expect(lines[0]).toContain(`since ${SINCE.slice(0, 7)}`);

    const record = applyDoctorRecordPatch(
      audited().doctor,
      first[1]?.kind === 'record-doctor' ? first[1].patch : {},
      'x',
    );
    const second = decideDoctor(
      audited({
        doctor: record,
        reportFilePresent: true,
        counts: { mustFix: 1, shouldFix: 2, nit: 3, followUp: 0 },
        verdict: 'Verdict: x',
      }),
    );
    expect(escalations(second)).toEqual([]);
  });

  it('escalates once as [no counts line, read it] when the counts line is missing', () => {
    const first = decideDoctor(
      audited({ reportFilePresent: true, counts: undefined, verdict: 'Verdict: read me' }),
    );
    const lines = escalations(first);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[no counts line, read it]');
    expect(lines[0]).toContain('Verdict: read me');

    const record = applyDoctorRecordPatch(
      audited().doctor,
      first[1]?.kind === 'record-doctor' ? first[1].patch : {},
      'x',
    );
    const second = decideDoctor(
      audited({ doctor: record, reportFilePresent: true, verdict: 'Verdict: read me' }),
    );
    expect(escalations(second)).toEqual([]);
  });

  it('escalates once as STALLED when idle without a report', () => {
    const first = decideDoctor(audited({ reportFilePresent: false }));
    const lines = escalations(first);
    expect(lines).toEqual(['LEAD: DOCTOR STALLED (idle, no DOCTOR.md)']);

    const record = applyDoctorRecordPatch(
      audited().doctor,
      first[1]?.kind === 'record-doctor' ? first[1].patch : {},
      'x',
    );
    const second = decideDoctor(audited({ doctor: record, reportFilePresent: false }));
    expect(escalations(second)).toEqual([]);
  });

  it('stays quiet while the doctor session runs on the audited head', () => {
    expect(
      decideDoctor(
        audited({ sessionState: 'running', reportFilePresent: false, quotaError: false }),
      ),
    ).toEqual([]);
  });

  it('stays quiet for unknown session states on the audited head', () => {
    expect(
      escalations(
        decideDoctor(
          audited({
            sessionState: 'unknown',
            reportFilePresent: true,
            counts: { mustFix: 0, shouldFix: 0, nit: 0, followUp: 0 },
            verdict: 'Verdict: ok',
          }),
        ),
      ),
    ).toEqual([]);
  });

  it('falls back in place on a quota error while on the free listing', () => {
    const actions = decideDoctor(audited({ quotaError: true, reportFilePresent: false }));
    expect(actions).toEqual([
      { kind: 'fallback-doctor', model: PAID_MUSE },
      { kind: 'escalate', line: 'LEAD: FALLBACK doctor continues on paid Muse' },
    ]);
    const lines = escalations(actions);
    expect(lines).toEqual(['LEAD: FALLBACK doctor continues on paid Muse']);
    expect(lines.some((line) => line.includes('STALLED'))).toBe(false);
  });

  it('takes the normal STALLED path on a quota error while already on paid', () => {
    const onPaid = audited().doctor;
    if (onPaid === undefined) {
      throw new Error('missing doctor record');
    }
    const actions = decideDoctor(
      audited({
        quotaError: true,
        reportFilePresent: false,
        doctor: { ...onPaid, model: PAID_MUSE },
      }),
    );
    expect(actions.some((action) => action.kind === 'fallback-doctor')).toBe(false);
    expect(escalations(actions)).toEqual(['LEAD: DOCTOR STALLED (idle, no DOCTOR.md)']);
  });

  it('keeps the STALLED path without a quota error', () => {
    expect(
      escalations(decideDoctor(audited({ quotaError: false, reportFilePresent: false }))),
    ).toEqual(['LEAD: DOCTOR STALLED (idle, no DOCTOR.md)']);
  });
});

// A GitRunner stub that records every call. Tests assert no call ever names
// a path other than the doctor worktree.
function stubRunner(worktrees: string[] = []): {
  calls: string[][];
  runner: GitRunner;
} {
  const calls: string[][] = [];
  return {
    calls,
    runner: {
      run: (cwd, args) => {
        calls.push([cwd, ...args]);
        if (args[0] === 'worktree' && args[1] === 'list') {
          return { ok: true, stdout: worktrees.map((entry) => `worktree ${entry}\n`).join('') };
        }
        return { ok: true, stdout: '' };
      },
    },
  };
}

function doctorDeps(
  repoRoot: string,
  runner: GitRunner,
  client: FakeOpenCodeClient,
): { client: FakeOpenCodeClient; runner: GitRunner; promptsDirPath: string; repoRoot: string } {
  return { client, runner, promptsDirPath: promptsDir(), repoRoot };
}

describe('startDoctorSession', () => {
  it('creates the worktree with the exact git commands and starts the session', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-doctor-'));
    const repoRoot = path.join(dir, 'zilar');
    fs.mkdirSync(repoRoot, { recursive: true });
    const worktree = path.join(dir, 'zilar-doctor');
    const { calls, runner } = stubRunner();
    const client = new FakeOpenCodeClient();

    const sessionId = await startDoctorSession(doctorDeps(repoRoot, runner, client), {
      head: HEAD,
      since: SINCE,
    });

    expect(calls).toContainEqual([repoRoot, 'worktree', 'add', '--detach', worktree, HEAD]);
    expect(client.created).toHaveLength(1);
    const created = client.created[0];
    expect(created?.sessionId).toBe(sessionId);
    expect(created?.options.directory).toBe(worktree);
    expect(created?.options.title).toBe(`doctor ${HEAD.slice(0, 7)}`);
    expect(created?.options.agent).toBe('build');
    expect(created?.options.model).toEqual({
      providerID: 'opencode',
      id: 'muse-spark-1.3-contributor-free',
    });
    expect(client.prompted).toHaveLength(1);
    expect(client.prompted[0]?.sessionId).toBe(sessionId);
    expect(client.prompted[0]?.text).toContain(worktree);
    expect(client.prompted[0]?.text).toContain(HEAD.slice(0, 7));
  });

  it('checks out the head and removes a stale DOCTOR.md when the worktree exists', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-doctor-'));
    const repoRoot = path.join(dir, 'zilar');
    fs.mkdirSync(repoRoot, { recursive: true });
    const worktree = path.join(dir, 'zilar-doctor');
    fs.mkdirSync(worktree, { recursive: true });
    fs.writeFileSync(path.join(worktree, 'DOCTOR.md'), 'stale\n');
    const { calls, runner } = stubRunner([worktree]);
    const client = new FakeOpenCodeClient();

    await startDoctorSession(doctorDeps(repoRoot, runner, client), {
      head: HEAD,
      since: SINCE,
    });

    expect(
      calls.some((call) => call[0] === repoRoot && call[1] === '-C' && call[2] === worktree),
    ).toBe(true);
    expect(calls).toContainEqual([repoRoot, '-C', worktree, 'checkout', '--detach', HEAD]);
    expect(fs.existsSync(path.join(worktree, 'DOCTOR.md'))).toBe(false);
  });

  it('refuses a non-worktree path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-doctor-'));
    const repoRoot = path.join(dir, 'zilar');
    fs.mkdirSync(repoRoot, { recursive: true });
    const worktree = path.join(dir, 'zilar-doctor');
    fs.mkdirSync(worktree, { recursive: true });
    const { runner } = stubRunner([]);
    const client = new FakeOpenCodeClient();

    await expect(
      startDoctorSession(doctorDeps(repoRoot, runner, client), { head: HEAD, since: SINCE }),
    ).rejects.toThrow(/not a worktree/);
    expect(client.created).toEqual([]);
  });

  it('never calls a git command on a path other than the doctor path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-doctor-'));
    const repoRoot = path.join(dir, 'zilar');
    fs.mkdirSync(repoRoot, { recursive: true });
    const worktree = path.join(dir, 'zilar-doctor');
    fs.mkdirSync(worktree, { recursive: true });
    fs.writeFileSync(path.join(worktree, 'DOCTOR.md'), 'stale\n');
    const { calls, runner } = stubRunner([worktree]);
    const client = new FakeOpenCodeClient();
    const sibling = path.join(dir, 'zilar-T-0099');
    fs.mkdirSync(sibling, { recursive: true });

    await startDoctorSession(doctorDeps(repoRoot, runner, client), {
      head: HEAD,
      since: SINCE,
    });

    for (const call of calls) {
      for (const arg of call) {
        expect(arg).not.toContain('zilar-T-0099');
      }
    }
    expect(doctorWorktreeFor(repoRoot)).toBe(worktree);
  });

  it('ensureDoctorWorktree throws when worktree add fails', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-doctor-'));
    const repoRoot = path.join(dir, 'zilar');
    fs.mkdirSync(repoRoot, { recursive: true });
    const failing: GitRunner = { run: () => ({ ok: false, stdout: '' }) };
    expect(() =>
      ensureDoctorWorktree(
        {
          client: new FakeOpenCodeClient(),
          runner: failing,
          promptsDirPath: promptsDir(),
          repoRoot,
        },
        HEAD,
      ),
    ).toThrow(/worktree add failed/);
  });
});

describe('doctorReportInfo', () => {
  it('reads counts and verdict through the shared parsers', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-doctor-report-'));
    expect(doctorReportInfo(dir)).toEqual({ present: false, verdict: '', counts: undefined });
    fs.writeFileSync(
      path.join(dir, 'DOCTOR.md'),
      '# Doctor\n\nCounts: must-fix=1, should-fix=2, nit=3\n\nVerdict: needs work\n',
    );
    expect(doctorReportInfo(dir)).toEqual({
      present: true,
      verdict: 'Verdict: needs work',
      counts: { mustFix: 1, shouldFix: 2, nit: 3, followUp: 0 },
    });
  });
});

describe('doctor prompt', () => {
  it('renders every placeholder with no {{ left', () => {
    const rendered = renderDoctorPrompt(promptsDir(), {
      head: HEAD,
      since: SINCE,
      worktree: '/tmp/zilar-doctor',
    });
    expect(rendered).not.toContain('{{');
    expect(rendered).toContain(HEAD);
    expect(rendered).toContain(SINCE);
    expect(rendered).toContain(HEAD.slice(0, 7));
    expect(rendered).toContain(SINCE.slice(0, 7));
    expect(rendered).toContain('/tmp/zilar-doctor');
    expect(rendered).toContain('DOCTOR.md');
    expect(rendered).toContain('Counts: must-fix=N, should-fix=N, nit=N');
    expect(rendered).toContain('Verdict:');
    expect(rendered).toContain('DO NOT');
    expect(rendered).toContain('question tool');
  });
});
