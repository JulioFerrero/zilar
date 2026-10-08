import { describe, expect, it, vi } from 'vitest';
import type { CandidateProcess, StoppedProcess } from './processes';
import {
  parsePsElapsed,
  runSweep,
  sweepCandidates,
  sweepFailedLine,
  sweepLine,
  worktreeForCommand,
  type SweepDeps,
  type SweepOptions,
  type SweepRow,
} from './sweeper';

const WORKTREE = '/Users/julio/personal-projects/zilar-T-0099';
const LOOKALIKE = '/Users/julio/personal-projects/zilar-T-00990';
const MAIN_REPO = '/Users/julio/personal-projects/zilar';

function row(pid: number, minutes: number, command: string): SweepRow {
  return { pid, elapsedMs: minutes * 60_000, command };
}

function options(overrides: Partial<SweepOptions> = {}): SweepOptions {
  return {
    worktreeRoots: [WORKTREE],
    blockedWorktrees: [],
    maxAgeMs: 25 * 60_000,
    protectedPids: [1, 2],
    ...overrides,
  };
}

describe('parsePsElapsed', () => {
  it('parses mm:ss, hh:mm:ss and d-hh:mm:ss', () => {
    const output = [
      '  123 04:31 /usr/bin/node /w/zilar-T-0099/node_modules/.bin/vitest run',
      '  456 1:02:33 node tsc --build',
      '  789 2-03:04:05 /w/zilar-T-0099/node_modules/.bin/turbo run test',
    ].join('\n');
    expect(parsePsElapsed(output)).toEqual([
      {
        pid: 123,
        elapsedMs: 271_000,
        command: '/usr/bin/node /w/zilar-T-0099/node_modules/.bin/vitest run',
      },
      { pid: 456, elapsedMs: 3_753_000, command: 'node tsc --build' },
      {
        pid: 789,
        elapsedMs: 183_845_000,
        command: '/w/zilar-T-0099/node_modules/.bin/turbo run test',
      },
    ]);
  });

  it('skips blank lines and lines with a bad elapsed time', () => {
    const output = ['', '  111 04:31 vitest', '  222 not-a-time vitest', 'garbage'].join('\n');
    expect(parsePsElapsed(output)).toEqual([{ pid: 111, elapsedMs: 271_000, command: 'vitest' }]);
  });
});

describe('worktreeForCommand', () => {
  it('matches a worktree path but never a lookalike sibling', () => {
    expect(worktreeForCommand(`node ${WORKTREE}/node_modules/.bin/vitest`, [WORKTREE])).toBe(
      WORKTREE,
    );
    expect(worktreeForCommand(`node ${LOOKALIKE}/node_modules/.bin/vitest`, [WORKTREE])).toBe(
      undefined,
    );
    expect(worktreeForCommand(`node ${MAIN_REPO}/vitest`, [WORKTREE])).toBe(undefined);
  });

  it('matches a root that ends a token', () => {
    expect(worktreeForCommand(`vitest --root ${WORKTREE}`, [WORKTREE])).toBe(WORKTREE);
  });
});

describe('sweepCandidates', () => {
  it('picks an old vitest running in a worktree', () => {
    const rows = [row(10, 30, `node ${WORKTREE}/node_modules/.bin/vitest run`)];
    expect(sweepCandidates(rows, options()).map((entry) => entry.pid)).toEqual([10]);
  });

  it('does not pick a young one', () => {
    const rows = [row(10, 5, `node ${WORKTREE}/node_modules/.bin/vitest run`)];
    expect(sweepCandidates(rows, options())).toEqual([]);
  });

  it('picks a young one when its worktree is blocked', () => {
    const rows = [row(10, 5, `node ${WORKTREE}/node_modules/.bin/vitest run`)];
    expect(
      sweepCandidates(rows, options({ blockedWorktrees: [WORKTREE] })).map((entry) => entry.pid),
    ).toEqual([10]);
  });

  it('picks old tsc, tsgo and turbo but not unrelated commands', () => {
    const rows = [
      row(11, 30, `node ${WORKTREE}/node_modules/.bin/tsc --build`),
      row(12, 30, `node ${WORKTREE}/node_modules/.bin/tsgo`),
      row(13, 30, `node ${WORKTREE}/node_modules/.bin/turbo run test`),
      row(14, 30, `node ${WORKTREE}/apps/server/src/index.ts`),
    ];
    expect(sweepCandidates(rows, options()).map((entry) => entry.pid)).toEqual([11, 12, 13]);
  });

  it('never picks an opencode process', () => {
    const rows = [row(10, 30, `opencode ${WORKTREE}/node_modules/.bin/vitest`)];
    expect(sweepCandidates(rows, options())).toEqual([]);
  });

  it('never picks a process outside the worktrees', () => {
    const rows = [row(10, 30, `node ${MAIN_REPO}/node_modules/.bin/vitest run`)];
    expect(sweepCandidates(rows, options())).toEqual([]);
  });

  it('never picks a protected pid', () => {
    const rows = [row(10, 30, `node ${WORKTREE}/node_modules/.bin/vitest run`)];
    expect(sweepCandidates(rows, options({ protectedPids: [10] }))).toEqual([]);
  });
});

describe('runSweep', () => {
  const PS_OUTPUT = [
    '  321 30:00 node ' + `${WORKTREE}/node_modules/.bin/vitest run`,
    '  654 02:00 node ' + `${WORKTREE}/node_modules/.bin/vitest run`,
  ].join('\n');

  function deps(stop: SweepDeps['stop']): SweepDeps {
    return { ps: () => PS_OUTPUT, stop };
  }

  const runOptions = {
    ...options(),
    taskByWorktree: new Map([[WORKTREE, 'T-0099']]),
    dryRun: false,
  };

  it('stops only the picked candidates and maps them to tasks', async () => {
    const stop = vi.fn(async (candidates: CandidateProcess[]): Promise<StoppedProcess[]> =>
      candidates.map((candidate) => ({
        pid: candidate.pid,
        command: candidate.command.includes('vitest') ? 'vitest' : 'node',
        survived: false,
      })),
    );
    const outcome = await runSweep(runOptions, deps(stop));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(outcome.candidates).toEqual([
      { pid: 321, task: 'T-0099', basename: 'node', elapsedMs: 1_800_000 },
    ]);
    expect(outcome.stopped).toEqual([
      { pid: 321, task: 'T-0099', basename: 'vitest', elapsedMs: 1_800_000 },
    ]);
  });

  it('lists candidates in dry-run and stops nothing', async () => {
    const stop = vi.fn(async (): Promise<StoppedProcess[]> => []);
    const outcome = await runSweep({ ...runOptions, dryRun: true }, deps(stop));
    expect(stop).not.toHaveBeenCalled();
    expect(outcome.candidates.map((entry) => entry.pid)).toEqual([321]);
    expect(outcome.stopped).toEqual([]);
  });

  it('does not stop anything when nothing qualifies', async () => {
    const stop = vi.fn(async (): Promise<StoppedProcess[]> => []);
    const outcome = await runSweep(
      { ...runOptions, worktreeRoots: [MAIN_REPO] },
      { ps: () => PS_OUTPUT, stop },
    );
    expect(stop).not.toHaveBeenCalled();
    expect(outcome).toEqual({ candidates: [], stopped: [], survivors: [] });
  });

  it('does not count survivors as stopped', async () => {
    const stop = async (candidates: CandidateProcess[]): Promise<StoppedProcess[]> =>
      candidates.map((candidate) => ({
        pid: candidate.pid,
        command: 'vitest',
        survived: true,
      }));
    const outcome = await runSweep(runOptions, { ps: () => PS_OUTPUT, stop });
    expect(outcome.stopped).toEqual([]);
  });

  it('puts a survivor in survivors and not in stopped', async () => {
    const stop = async (candidates: CandidateProcess[]): Promise<StoppedProcess[]> =>
      candidates.map((candidate) => ({
        pid: candidate.pid,
        command: 'vitest',
        survived: candidate.pid === 321,
      }));
    const outcome = await runSweep(runOptions, { ps: () => PS_OUTPUT, stop });
    expect(outcome.survivors).toEqual([
      { pid: 321, task: 'T-0099', basename: 'vitest', elapsedMs: 1_800_000 },
    ]);
    expect(outcome.stopped).toEqual([]);
  });

  it('returns no survivors in dry-run', async () => {
    const stop = vi.fn(async (): Promise<StoppedProcess[]> => []);
    const outcome = await runSweep({ ...runOptions, dryRun: true }, deps(stop));
    expect(outcome.survivors).toEqual([]);
  });
});

describe('sweepLine', () => {
  it('formats task, basename and minutes', () => {
    expect(
      sweepLine([
        { pid: 1, task: 'T-0099', basename: 'vitest', elapsedMs: 30 * 60_000 },
        { pid: 2, task: 'T-0100', basename: 'tsc', elapsedMs: 90_000 },
      ]),
    ).toBe('LEAD: SWEPT 2 process(es): T-0099:vitest:30m, T-0100:tsc:2m');
  });
});

describe('sweepFailedLine', () => {
  it('formats task, basename and minutes for survivors', () => {
    expect(
      sweepFailedLine([
        { pid: 1, task: 'T-0099', basename: 'vitest', elapsedMs: 30 * 60_000 },
        { pid: 2, task: 'T-0100', basename: 'tsc', elapsedMs: 90_000 },
      ]),
    ).toBe('LEAD: SWEEP FAILED 2 process(es) survived SIGKILL: T-0099:vitest:30m, T-0100:tsc:2m');
  });
});
