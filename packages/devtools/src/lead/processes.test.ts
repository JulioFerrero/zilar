import { describe, expect, it } from 'vitest';
import {
  type CandidateProcess,
  executableBasename,
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

describe('executableBasename', () => {
  it('returns the first whitespace-delimited token, stripped of its directory', () => {
    expect(executableBasename('node /foo/server.js')).toBe('node');
    expect(executableBasename('/usr/bin/node /elsewhere/server.js')).toBe('node');
    expect(executableBasename(`${WORKTREE}/apps/web/node_modules/.bin/vite dev`)).toBe('vite');
  });

  it('strips leading env assignments before taking the basename', () => {
    expect(executableBasename(`FOO=secret BAR=x node server.js`)).toBe('node');
    expect(executableBasename(`FOO=secret ${WORKTREE}/node_modules/.bin/vite`)).toBe('vite');
  });

  it('returns the empty string for a blank command', () => {
    expect(executableBasename('')).toBe('');
    expect(executableBasename('   ')).toBe('');
  });

  it('never returns argv: only the first token (the executable)', () => {
    // We deliberately lose everything after the first whitespace. Args often
    // carry secrets (`--token=…`, `-e PASSWORD=…`); there is no safe way to
    // scrub them, so we don't try.
    expect(executableBasename('node --token=sk-abc-secret server.js')).toBe('node');
    // `env VAR=val cmd …` is a common pattern that we cannot decode without
    // running a shell. The first token is `env`, which is what gets printed
    // — fine, because the dangerous values (`VAR=val`, `cmd`, …) never
    // appear in the log.
    expect(executableBasename('env FOO=secret node server.js')).toBe('env');
    expect(executableBasename('/bin/bash -c "rm -rf /"')).toBe('bash');
  });
});

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

  it('matches interpreter-first commands with the worktree path after the binary', () => {
    // The worktree path appears in argv, not as the executable's leading
    // token. The whole command line is scanned, exact-prefixed.
    const ps = `300 node ${WORKTREE}/apps/server/src/index.ts\n`;
    const result = findProcessesInWorktree(WORKTREE, findDeps({ ps: () => ps }));
    expect(result.map((entry) => entry.pid)).toEqual([300]);
  });

  it('matches the worktree path appearing later in the command line', () => {
    const ps = `301 /usr/local/bin/node --inspect ${WORKTREE}/packages/x/server.js --port 8082\n`;
    const result = findProcessesInWorktree(WORKTREE, findDeps({ ps: () => ps }));
    expect(result.map((entry) => entry.pid)).toEqual([301]);
  });

  it('matches processes whose command starts with the worktree path', () => {
    const ps = `302 ${WORKTREE}/apps/web/node_modules/.bin/vite dev\n303 /usr/local/bin/node /elsewhere/server.js\n`;
    const result = findProcessesInWorktree(WORKTREE, findDeps({ ps: () => ps }));
    expect(result.map((entry) => entry.pid)).toEqual([302]);
  });

  it('does not match look-alike paths (galena-T-0099 vs galena-T-00990)', () => {
    const lsof = `p400\nn${LOOKALIKE}\np401\nn${WORKTREE}\n`;
    const ps = `400 bash\n401 bash\n`;
    const result = findProcessesInWorktree(WORKTREE, findDeps({ lsof: () => lsof, ps: () => ps }));
    expect(result.map((entry) => entry.pid)).toEqual([401]);
  });

  it('does not match commands that mention the look-alike path', () => {
    // galena-T-00990 ends in `0`, so the exact-prefixed needle
    // `galena-T-0099/` never appears inside it.
    const ps = `410 node ${LOOKALIKE}/apps/server/src/index.ts\n411 node ${LOOKALIKE}subpath\n`;
    const result = findProcessesInWorktree(WORKTREE, findDeps({ ps: () => ps }));
    expect(result.map((entry) => entry.pid)).toEqual([]);
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
    const alive = new Set<number>([1000, 1001]);
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

  it('sends SIGTERM to each candidate, returns the executable basename only', async () => {
    const signals: { pid: number; signal: 'SIGTERM' | 'SIGKILL' }[] = [];
    // Before SIGTERM the candidate is alive; after SIGTERM it is gone.
    const alive = new Set<number>([1000, 1001]);
    const stopped = await stopWorktreeProcesses(
      candidates,
      clockDeps({
        kill: (pid, signal) => {
          signals.push({ pid, signal });
          alive.delete(pid);
        },
        exited: (pid) => !alive.has(pid),
      }),
    );
    expect(signals).toEqual([
      { pid: 1000, signal: 'SIGTERM' },
      { pid: 1001, signal: 'SIGTERM' },
    ]);
    expect(stopped).toEqual([
      { pid: 1000, command: 'node', survived: false },
      { pid: 1001, command: 'bash', survived: false },
    ]);
  });

  it('sends SIGKILL after the deadline when the process is still alive', async () => {
    const signals: { pid: number; signal: 'SIGTERM' | 'SIGKILL' }[] = [];
    const stopped = await stopWorktreeProcesses(
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
    // Survived because the probe says the pid is still alive.
    expect(stopped).toEqual([{ pid: 2000, command: 'stuck', survived: true }]);
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

  it('does not report a candidate that was already gone before TERM', async () => {
    // The pre-TERM probe says pid 4000 is dead: we don't kill, don't log.
    const stopped = await stopWorktreeProcesses(
      [{ pid: 4000, command: 'gone' }],
      clockDeps({ exited: () => true }),
    );
    expect(stopped).toEqual([]);
  });

  it('reports survived=true when SIGTERM throws and the pid is still alive afterwards', async () => {
    const stopped = await stopWorktreeProcesses([{ pid: 5000, command: 'permission-denied' }], {
      kill: () => {
        throw new Error('EPERM');
      },
      now: () => 0,
      sleep: async () => undefined,
      exited: () => false,
    });
    expect(stopped).toEqual([{ pid: 5000, command: 'permission-denied', survived: true }]);
  });

  it('never includes argv or env assignments in the printed command', async () => {
    // The first token after env stripping is the executable; we drop everything
    // else. No `--token=…`, no `FOO=secret`, no `--inspect=0.0.0.0:9229`.
    const cmd = `FOO=secret BAR=also-secret node --token=sk-abc ${WORKTREE}/apps/server/src/index.ts --port 8082`;
    const alive = new Set<number>([6000]);
    const stopped = await stopWorktreeProcesses([{ pid: 6000, command: cmd }], {
      kill: (pid) => {
        alive.delete(pid);
      },
      now: () => 0,
      sleep: async () => undefined,
      exited: (pid) => !alive.has(pid),
    });
    expect(stopped[0]?.command).toBe('node');
    expect(stopped[0]?.command).not.toContain('FOO=secret');
    expect(stopped[0]?.command).not.toContain('BAR=also-secret');
    expect(stopped[0]?.command).not.toContain('sk-abc');
    expect(stopped[0]?.command).not.toContain('apps/server');
    expect(stopped[0]?.command).not.toContain('8082');
  });

  it('reports multiple processes with mixed survive/exit outcomes', async () => {
    // 1111 dies on TERM (gone); 7777 ignores TERM and KILL (survived);
    // 9999 ignores TERM and KILL (survived).
    const alive = new Set<number>([1111, 7777, 9999]);
    let nowMs = 0;
    const stopped = await stopWorktreeProcesses(
      [
        { pid: 1111, command: 'node' },
        { pid: 7777, command: 'vite' },
        { pid: 9999, command: 'bash' },
      ],
      {
        kill: (pid) => {
          if (pid === 1111) {
            alive.delete(pid);
          }
        },
        now: () => nowMs,
        // Advance the clock past the 5 s deadline so SIGKILL fires without
        // hitting real timers.
        sleep: async (ms) => {
          nowMs += ms;
        },
        exited: (pid) => !alive.has(pid),
      },
    );
    expect(stopped).toEqual([
      { pid: 1111, command: 'node', survived: false },
      { pid: 7777, command: 'vite', survived: true },
      { pid: 9999, command: 'bash', survived: true },
    ]);
  });
});
