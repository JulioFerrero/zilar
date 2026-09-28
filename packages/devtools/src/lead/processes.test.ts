import { describe, expect, it } from 'vitest';
import {
  type CandidateProcess,
  type FindProcsDeps,
  findProcessesInWorktree,
  type StopProcessesDeps,
  stopWorktreeProcesses,
} from './processes';

const WORKTREE = '/Users/julio/personal-projects/galena-T-0099';
const LOOKALIKE = '/Users/julio/personal-projects/galena-T-00990';
const MAIN_REPO = '/Users/julio/personal-projects/galena';

function findDeps(overrides: Partial<FindProcsDeps> = {}): FindProcsDeps {
  return {
    lsof: () => '',
    ps: () => '',
    currentPid: 1,
    parentPid: 2,
    ...overrides,
  };
}

describe('findProcessesInWorktree', () => {
  it('matches processes whose cwd is exactly the worktree', () => {
    const lsof = `p100\nn${WORKTREE}\np101\nn/tmp/elsewhere\n`;
    // `ps` here intentionally does not list pid 100 to exercise the path where
    // the process is only visible through its cwd: we still report the pid,
    // and the command field falls back to the cwd itself.
    const ps = '101 bash\n';
    const result = findProcessesInWorktree(WORKTREE, findDeps({ lsof: () => lsof, ps: () => ps }));
    expect(result.map((entry) => entry.pid)).toEqual([100]);
    expect(result[0]?.command).toBe(WORKTREE);
  });

  it('matches processes whose cwd is inside the worktree', () => {
    const lsof = `p200\nn${WORKTREE}/apps/web\np201\nn${WORKTREE}\n`;
    const result = findProcessesInWorktree(
      WORKTREE,
      findDeps({ lsof: () => lsof, ps: () => '200 vite\n201 bash\n' }),
    );
    expect(result.map((entry) => entry.pid).sort()).toEqual([200, 201]);
  });

  it('matches processes whose command starts with the worktree path', () => {
    const ps = `300 ${WORKTREE}/apps/web/node_modules/.bin/vite dev\n301 /usr/local/bin/node /elsewhere/server.js\n`;
    const result = findProcessesInWorktree(WORKTREE, findDeps({ ps: () => ps }));
    expect(result.map((entry) => entry.pid)).toEqual([300]);
  });

  it('does not match look-alike paths (galena-T-0099 vs galena-T-00990)', () => {
    const lsof = `p400\nn${LOOKALIKE}\np401\nn${WORKTREE}\n`;
    const ps = `400 bash\n401 bash\n`;
    const result = findProcessesInWorktree(WORKTREE, findDeps({ lsof: () => lsof, ps: () => ps }));
    expect(result.map((entry) => entry.pid)).toEqual([401]);
  });

  it('does not match the main repo path or anything outside the worktree', () => {
    const lsof = `p500\nn${MAIN_REPO}\np501\nn${MAIN_REPO}/apps\np502\nn${WORKTREE}/sub\n`;
    const ps = `500 bash\n501 bash\n502 bash\n`;
    const result = findProcessesInWorktree(WORKTREE, findDeps({ lsof: () => lsof, ps: () => ps }));
    expect(result.map((entry) => entry.pid)).toEqual([502]);
  });

  it('skips the lead process and its parent', () => {
    const lsof = `p1\nn${WORKTREE}\np2\nn${WORKTREE}\np3\nn${WORKTREE}\n`;
    const ps = '1 lead\n2 node\n3 bash\n';
    const result = findProcessesInWorktree(WORKTREE, findDeps({ lsof: () => lsof, ps: () => ps }));
    expect(result.map((entry) => entry.pid)).toEqual([3]);
  });

  it('skips non-positive pids defensively', () => {
    const lsof = `p0\nn${WORKTREE}\np-7\nn${WORKTREE}\n`;
    const result = findProcessesInWorktree(WORKTREE, findDeps({ lsof: () => lsof, ps: () => '' }));
    expect(result).toEqual([]);
  });

  it('deduplicates pids that show up in both lsof and ps', () => {
    const lsof = `p700\nn${WORKTREE}\n`;
    const ps = `700 ${WORKTREE}/node server.js\n`;
    const result = findProcessesInWorktree(WORKTREE, findDeps({ lsof: () => lsof, ps: () => ps }));
    expect(result).toHaveLength(1);
    // ps command wins because it includes the cwd path; useful for the print.
    expect(result[0]?.command).toBe(`${WORKTREE}/node server.js`);
  });
});

describe('stopWorktreeProcesses', () => {
  const candidates: CandidateProcess[] = [
    { pid: 1000, command: `${WORKTREE}/node server.js` },
    { pid: 1001, command: 'bash' },
  ];

  function clockDeps(overrides: Partial<StopProcessesDeps> = {}): StopProcessesDeps {
    let nowMs = 1_000_000;
    let alive = new Set<number>([1000, 1001]);
    const signals: { pid: number; signal: 'SIGTERM' | 'SIGKILL' }[] = [];
    return {
      kill: (pid, signal) => {
        signals.push({ pid, signal });
      },
      now: () => nowMs,
      sleep: async (ms) => {
        nowMs += ms;
      },
      exited: (pid) => !alive.has(pid),
      ...overrides,
    };
  }

  it('sends SIGTERM to each candidate and prints a one-line summary', async () => {
    const signals: { pid: number; signal: 'SIGTERM' | 'SIGKILL' }[] = [];
    const stopped = await stopWorktreeProcesses(
      candidates,
      clockDeps({
        kill: (pid, signal) => signals.push({ pid, signal }),
        // Both processes exit on the first probe so the deadline is never hit.
        exited: () => true,
      }),
    );
    expect(signals).toEqual([
      { pid: 1000, signal: 'SIGTERM' },
      { pid: 1001, signal: 'SIGTERM' },
    ]);
    expect(stopped.map((entry) => entry.pid)).toEqual([1000, 1001]);
    expect(stopped[0]?.command.length).toBeLessThanOrEqual(80);
  });

  it('sends SIGKILL after the deadline when the process is still alive', async () => {
    const signals: { pid: number; signal: 'SIGTERM' | 'SIGKILL' }[] = [];
    await stopWorktreeProcesses(
      [{ pid: 2000, command: 'stuck' }],
      clockDeps({
        kill: (pid, signal) => signals.push({ pid, signal }),
        exited: () => false,
      }),
    );
    expect(signals).toEqual([
      { pid: 2000, signal: 'SIGTERM' },
      { pid: 2000, signal: 'SIGKILL' },
    ]);
  });

  it('does not SIGKILL when the process exits within the wait window', async () => {
    const signals: { pid: number; signal: 'SIGTERM' | 'SIGKILL' }[] = [];
    let alive = true;
    await stopWorktreeProcesses(
      [{ pid: 3000, command: 'quick' }],
      clockDeps({
        kill: (pid, signal) => signals.push({ pid, signal }),
        exited: () => !alive,
        sleep: async () => {
          alive = false;
        },
      }),
    );
    expect(signals).toEqual([{ pid: 3000, signal: 'SIGTERM' }]);
  });

  it('treats a SIGTERM that throws (already-gone race) as stopped', async () => {
    const signals: { pid: number; signal: 'SIGTERM' | 'SIGKILL' }[] = [];
    const stopped = await stopWorktreeProcesses([{ pid: 4000, command: 'gone' }], {
      kill: (pid, signal) => {
        if (signal === 'SIGTERM') {
          throw new Error('ESRCH');
        }
        signals.push({ pid, signal });
      },
      now: () => 0,
      sleep: async () => undefined,
      exited: () => true,
    });
    expect(signals).toEqual([]);
    expect(stopped).toEqual([{ pid: 4000, command: 'gone' }]);
  });

  it('truncates long commands to 80 characters', async () => {
    const longCommand = 'x'.repeat(200);
    const stopped = await stopWorktreeProcesses([{ pid: 5000, command: longCommand }], clockDeps());
    expect(stopped[0]?.command.length).toBe(80);
  });

  it('does not include environment variables in the command field', async () => {
    // ps prints the command line verbatim; we strip leading `KEY=value `
    // assignments before truncating so secrets never land in lead.log.
    const cmd = `FOO=secret BAR=also-secret ${WORKTREE}/node server.js`;
    const stopped = await stopWorktreeProcesses([{ pid: 6000, command: cmd }], clockDeps());
    expect(stopped[0]?.command).toBe(`${WORKTREE}/node server.js`);
    expect(stopped[0]?.command).not.toContain('FOO=secret');
    expect(stopped[0]?.command).not.toContain('BAR=also-secret');
  });
});
