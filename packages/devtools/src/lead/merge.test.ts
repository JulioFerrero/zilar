import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RealGitRunner } from './git';
import { MergeError, mergeTask, type MergeOptions } from './merge';
import {
  executableBasename,
  stopWorktreeProcesses,
  type FindProcsDeps,
  type StopProcessesDeps,
} from './processes';

// A no-op process-stopping seam: tests pass these to keep `mergeTask` from
// touching the real `lsof`/`ps`/`process.kill`. The rebase-conflict and
// happy-path tests then override them to assert what was stopped. The
// signature must match `stopWorktreeProcesses` exactly: each candidate
// becomes a `survived: false` entry, so default tests don't see "could not
// stop" lines. The seams are typed as their non-optional shape because
// passing `undefined` would fail under `exactOptionalPropertyTypes`.
type FindProcsFn = NonNullable<MergeOptions['findProcs']>;
type StopProcsFn = NonNullable<MergeOptions['stopProcs']>;
type PrintFn = NonNullable<MergeOptions['print']>;
const noFindProcs: FindProcsFn = () => [];
const noStopProcs: StopProcsFn = async (candidates) =>
  candidates.map((entry) => ({
    pid: entry.pid,
    command: executableBasename(entry.command),
    survived: false,
  }));
const noFindProcsDeps: FindProcsDeps = {
  lsof: () => '',
  ps: () => '',
  currentPid: 0,
  parentPid: 0,
};
const noStopProcsDeps: StopProcessesDeps = {};
const noPrint: PrintFn = () => undefined;

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

const BOARD_FIXTURE = (task: string, file: string): string =>
  [
    '# Board',
    '',
    '## Active',
    '',
    '| ID | Title | Status |',
    '|---|---|---|',
    `| [${task}](${file}) | Demo | in-progress |`,
    '',
    '## Done',
    '',
    '| ID | Title | Merged |',
    '|---|---|---|',
    '| [T-0001](T-0001-x.md) | Old | 2026-09-27 |',
    '',
  ].join('\n');

const TASK_FILE = (status: string): string =>
  [
    '---',
    'id: T-0099',
    'title: Demo',
    `status: ${status}`,
    'milestone: tooling',
    'branch: task/T-0099-demo',
    'model: opencode-go/muse-spark-1.3-contributor',
    'depends_on: []',
    'estimate: 1 day',
    '---',
    '',
    '# T-0099',
    '',
  ].join('\n');

interface Harness {
  root: string;
  origin: string;
  worktree: string;
  branch: string;
  dropped: string[];
}

// A main checkout with an origin, a task branch in a linked worktree, and
// INDEPENDENT task-file copies: main's says `mainStatus`, the branch's says
// `branchStatus`. The merge must read the branch's copy.
function setup(mainStatus: string, branchStatus: string): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-merge-'));
  const origin = path.join(dir, 'origin.git');
  const root = path.join(dir, 'root');
  fs.mkdirSync(root, { recursive: true });
  git(dir, ['init', '--bare', '-q', origin]);
  git(root, ['init', '-b', 'main', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, 'work'), { recursive: true });
  fs.writeFileSync(path.join(root, 'work', 'BOARD.md'), BOARD_FIXTURE('T-0099', 'T-0099-demo.md'));
  fs.writeFileSync(path.join(root, 'work', 'T-0099-demo.md'), TASK_FILE(mainStatus));
  fs.writeFileSync(path.join(root, 'file.txt'), 'v1\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'init']);
  git(root, ['remote', 'add', 'origin', origin]);
  git(root, ['push', '-q', 'origin', 'main']);
  const branch = 'task/T-0099-demo';
  const worktree = path.join(dir, 'zilar-T-0099');
  git(root, ['worktree', 'add', '-q', worktree, '-b', branch, 'main']);
  git(worktree, ['config', 'user.email', 'test@example.com']);
  git(worktree, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(worktree, 'work', 'T-0099-demo.md'), TASK_FILE(branchStatus));
  git(worktree, ['add', 'work/T-0099-demo.md']);
  git(worktree, ['commit', '-qm', 'worker: status']);
  return { root, origin, worktree, branch, dropped: [] };
}

function options(harness: Harness, summary = 'Demo summary'): MergeOptions {
  return {
    root: harness.root,
    task: 'T-0099',
    file: 'T-0099-demo.md',
    worktree: harness.worktree,
    branch: harness.branch,
    summary,
    today: '2026-09-29',
    runner: new RealGitRunner(),
    readText: (file) => fs.readFileSync(file, 'utf8'),
    writeText: (file, text) => fs.writeFileSync(file, text),
    dropFromState: (task) => {
      harness.dropped.push(task);
    },
    // Override the production lsof/ps defaults so the tests don't touch the
    // real process table. `stopProcs` returns everything as `survived: false`
    // so the pre-flight, rebase, and happy-path tests don't see "could not
    // stop" lines.
    findProcs: noFindProcs,
    stopProcs: noStopProcs,
    findProcsDeps: noFindProcsDeps,
    stopProcsDeps: noStopProcsDeps,
    print: noPrint,
  };
}

describe('mergeTask pre-flight checks', () => {
  it('refuses a dirty worktree', async () => {
    const harness = setup('todo', 'merged');
    fs.writeFileSync(path.join(harness.worktree, 'dirty.txt'), 'x');
    await expect(mergeTask(options(harness))).rejects.toThrow(MergeError);
    await expect(mergeTask(options(harness))).rejects.toThrow(/worktree has uncommitted/);
  });

  it("refuses a task whose branch copy is not merged (even when main's copy is)", async () => {
    const harness = setup('merged', 'review');
    await expect(mergeTask(options(harness))).rejects.toThrow(/status is "review"/);
  });

  it("proceeds when the branch copy is merged even though main's copy is todo", async () => {
    const harness = setup('todo', 'merged');
    fs.writeFileSync(path.join(harness.worktree, 'feature.txt'), 'new\n');
    git(harness.worktree, ['add', '.']);
    git(harness.worktree, ['commit', '-qam', 'feature']);
    await mergeTask(options(harness));
    expect(fs.existsSync(path.join(harness.root, 'feature.txt'))).toBe(true);
  });

  it('refuses when main has uncommitted changes', async () => {
    const harness = setup('todo', 'merged');
    fs.writeFileSync(path.join(harness.root, 'uncommitted.txt'), 'x');
    await expect(mergeTask(options(harness))).rejects.toThrow(/main checkout has uncommitted/);
  });
});

describe('mergeTask rebase conflicts', () => {
  it('aborts and lists the conflicted files', async () => {
    const harness = setup('todo', 'merged');
    fs.writeFileSync(path.join(harness.worktree, 'file.txt'), 'branch change\n');
    git(harness.worktree, ['commit', '-qam', 'branch change']);
    fs.writeFileSync(path.join(harness.root, 'file.txt'), 'main change\n');
    git(harness.root, ['commit', '-qam', 'main change']);

    let error: unknown;
    try {
      await mergeTask(options(harness));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MergeError);
    expect(String((error as Error).message)).toContain('file.txt');

    // The rebase was aborted: the branch still holds its own commit.
    const log = spawnSync('git', ['log', '--oneline', '-1'], {
      cwd: harness.worktree,
      encoding: 'utf8',
    }).stdout.trim();
    expect(log).toContain('branch change');
    // And nothing was pushed or board-edited.
    expect(fs.readFileSync(path.join(harness.root, 'work', 'BOARD.md'), 'utf8')).toContain(
      '| [T-0099](T-0099-demo.md) | Demo | in-progress |',
    );
    expect(harness.dropped).toEqual([]);
  });
});

describe('mergeTask happy path', () => {
  it('rebases, fast-forwards, boards, pushes, and cleans up', async () => {
    const harness = setup('todo', 'merged');
    fs.writeFileSync(path.join(harness.worktree, 'feature.txt'), 'new\n');
    git(harness.worktree, ['add', '.']);
    git(harness.worktree, ['commit', '-qam', 'feature']);

    await mergeTask(options(harness));

    // Fast-forwarded: main holds the feature commit.
    expect(fs.existsSync(path.join(harness.root, 'feature.txt'))).toBe(true);
    // Board: moved from Active to the end of Done.
    const board = fs.readFileSync(path.join(harness.root, 'work', 'BOARD.md'), 'utf8');
    expect(board).not.toContain('| [T-0099](T-0099-demo.md) | Demo | in-progress |');
    expect(board).toContain('| [T-0099](T-0099-demo.md) | Demo summary | 2026-09-29 |');
    const doneSection = board.split('## Done')[1] as string;
    expect(doneSection.indexOf('T-0001')).toBeLessThan(doneSection.indexOf('T-0099'));
    // Pushed: the origin sees the feature commit.
    const originLog = spawnSync('git', ['log', '--format=%s', 'main'], {
      cwd: harness.origin,
      encoding: 'utf8',
    }).stdout;
    expect(originLog).toContain('feature');
    // Cleaned up: worktree removed, branch deleted, state dropped.
    expect(fs.existsSync(harness.worktree)).toBe(false);
    const branches = spawnSync('git', ['branch', '--list', harness.branch], {
      cwd: harness.root,
      encoding: 'utf8',
    }).stdout.trim();
    expect(branches).toBe('');
    expect(harness.dropped).toEqual(['T-0099']);
  });
});

describe('mergeTask process cleanup', () => {
  it('stops worktree processes only after a successful merge, right before worktree-remove', async () => {
    const harness = setup('todo', 'merged');
    fs.writeFileSync(path.join(harness.worktree, 'feature.txt'), 'new\n');
    git(harness.worktree, ['add', '.']);
    git(harness.worktree, ['commit', '-qam', 'feature']);
    const order: string[] = [];
    const candidate = { pid: 4242, command: `${harness.worktree}/node server.js` };
    // Track which pids are still alive so the pre-TERM probe says yes, and
    // the kill transition makes them gone before the post-probe.
    const alive = new Set<number>([4242]);
    await mergeTask({
      ...options(harness),
      findProcs: () => {
        order.push('find');
        return [candidate];
      },
      // Delegate to the real stopWorktreeProcesses so the basename logic
      // runs: tests assert that only `node` is printed, never the full path
      // or argv.
      stopProcs: async (candidates) => {
        order.push('stop');
        return stopWorktreeProcesses(candidates, {
          kill: (pid) => {
            alive.delete(pid);
          },
          now: () => 0,
          sleep: async () => undefined,
          exited: (pid) => !alive.has(pid),
        });
      },
      print: (line) => {
        order.push(`print:${line}`);
      },
      runner: new (class extends RealGitRunner {
        override run(cwd: string, args: string[]): { ok: boolean; stdout: string } {
          // The exact operation order matters: stop happens after the push
          // and before the worktree-remove, so a failed merge never kills
          // the worker's dev servers.
          if (args[0] === 'push') {
            order.push('push');
          }
          if (args[0] === 'worktree' && args[1] === 'remove') {
            order.push('worktree-remove');
            // Stop happens before the worktree is gone.
            expect(fs.existsSync(harness.worktree)).toBe(true);
          }
          return super.run(cwd, args);
        }
      })(),
    });
    expect(order).toEqual(['push', 'find', 'stop', 'print:stop 4242 node', 'worktree-remove']);
  });

  it('prints "could not stop" for a pid that survived SIGKILL', async () => {
    const harness = setup('todo', 'merged');
    fs.writeFileSync(path.join(harness.worktree, 'feature.txt'), 'new\n');
    git(harness.worktree, ['add', '.']);
    git(harness.worktree, ['commit', '-qam', 'feature']);
    const lines: string[] = [];
    await mergeTask({
      ...options(harness),
      findProcs: () => [
        { pid: 11, command: '/bin/bash' },
        { pid: 22, command: `${harness.worktree}/node_modules/.bin/vite dev` },
      ],
      stopProcs: async (candidates) =>
        candidates.map((entry) => ({
          pid: entry.pid,
          command: executableBasename(entry.command),
          survived: entry.pid === 22,
        })),
      print: (line) => lines.push(line),
    });
    expect(lines).toEqual(['stop 11 bash', 'could not stop 22 vite']);
  });

  it('does not run process cleanup when the rebase conflicts', async () => {
    const harness = setup('todo', 'merged');
    fs.writeFileSync(path.join(harness.worktree, 'file.txt'), 'branch change\n');
    git(harness.worktree, ['commit', '-qam', 'branch change']);
    fs.writeFileSync(path.join(harness.root, 'file.txt'), 'main change\n');
    git(harness.root, ['commit', '-qam', 'main change']);
    let findCalled = false;
    await expect(
      mergeTask({
        ...options(harness),
        findProcs: () => {
          findCalled = true;
          return [];
        },
      }),
    ).rejects.toThrow(/rebase conflicted/);
    // A failed merge must not touch the worker's processes.
    expect(findCalled).toBe(false);
  });

  it('does not leak argv into the printed command', async () => {
    const harness = setup('todo', 'merged');
    fs.writeFileSync(path.join(harness.worktree, 'feature.txt'), 'new\n');
    git(harness.worktree, ['add', '.']);
    git(harness.worktree, ['commit', '-qam', 'feature']);
    const lines: string[] = [];
    await mergeTask({
      ...options(harness),
      findProcs: () => [
        {
          pid: 31,
          command: `FOO=secret node --token=sk-abc ${harness.worktree}/apps/server/src/index.ts --port 8082`,
        },
      ],
      print: (line) => lines.push(line),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('stop 31 node');
    expect(lines[0]).not.toContain('FOO=secret');
    expect(lines[0]).not.toContain('sk-abc');
    expect(lines[0]).not.toContain('apps/server');
    expect(lines[0]).not.toContain('8082');
  });

  it('prints "stop <pid> ?" when the executable name is empty (no trailing space)', async () => {
    const harness = setup('todo', 'merged');
    fs.writeFileSync(path.join(harness.worktree, 'feature.txt'), 'new\n');
    git(harness.worktree, ['add', '.']);
    git(harness.worktree, ['commit', '-qam', 'feature']);
    const lines: string[] = [];
    await mergeTask({
      ...options(harness),
      // An empty executable name (e.g. ps truncated it or a kernel thread).
      findProcs: () => [{ pid: 41, command: '' }],
      stopProcs: async (candidates) =>
        candidates.map((entry) => ({
          pid: entry.pid,
          command: executableBasename(entry.command),
          survived: false,
        })),
      print: (line) => lines.push(line),
    });
    expect(lines).toEqual(['stop 41 ?']);
    expect(lines[0]).not.toMatch(/ $/);
  });

  it('prints a clear line (no throw) when the process probe fails', async () => {
    const harness = setup('todo', 'merged');
    fs.writeFileSync(path.join(harness.worktree, 'feature.txt'), 'new\n');
    git(harness.worktree, ['add', '.']);
    git(harness.worktree, ['commit', '-qam', 'feature']);
    const lines: string[] = [];
    let stopCalled = false;
    await expect(
      mergeTask({
        ...options(harness),
        findProcs: () => {
          throw new Error('lsof not found');
        },
        stopProcs: async () => {
          stopCalled = true;
          return [];
        },
        print: (line) => lines.push(line),
      }),
    ).resolves.toBeUndefined();
    // One line, not a throw. The lead can read it and re-run.
    expect(lines).toEqual([
      'could not list worktree processes: lsof not found; re-run `lead merge T-0099` to finish removal',
    ]);
    // We didn't even try to stop anything: probe failed first.
    expect(stopCalled).toBe(false);
  });
});

describe('mergeTask gate', () => {
  it('runs the gate in the rebased worktree and merges when it passes', async () => {
    const harness = setup('todo', 'merged');
    fs.writeFileSync(path.join(harness.worktree, 'feature.txt'), 'new\n');
    git(harness.worktree, ['add', '.']);
    git(harness.worktree, ['commit', '-qam', 'feature']);
    const gated: string[] = [];

    await mergeTask({
      ...options(harness),
      gate: (worktree) => {
        gated.push(worktree);
        return { ok: true, output: '' };
      },
    });

    expect(gated).toEqual([harness.worktree]);
    expect(fs.existsSync(path.join(harness.root, 'feature.txt'))).toBe(true);
  });

  it('refuses to merge, and leaves main alone, when the gate fails', async () => {
    const harness = setup('todo', 'merged');
    fs.writeFileSync(path.join(harness.worktree, 'feature.txt'), 'new\n');
    git(harness.worktree, ['add', '.']);
    git(harness.worktree, ['commit', '-qam', 'feature']);

    await expect(
      mergeTask({
        ...options(harness),
        gate: () => ({ ok: false, output: 'FAIL  lint' }),
      }),
    ).rejects.toThrowError(/gate failed.*FAIL {2}lint/s);

    expect(fs.existsSync(path.join(harness.root, 'feature.txt'))).toBe(false);
    expect(fs.existsSync(harness.worktree)).toBe(true);
    expect(harness.dropped).toEqual([]);
  });
});
