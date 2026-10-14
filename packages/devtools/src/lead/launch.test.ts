import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeOpenCodeClient } from './client';
import { RealGitRunner } from './git';
import { launchTask } from './launch';
import { promptsDir } from './prompts';
import { loadState } from './state';

const TASK = 'T-0099';
const BRANCH = `task/${TASK}-demo`;
const FILE = `${TASK}-demo.md`;

const TASK_FILE = [
  '---',
  `id: ${TASK}`,
  'title: Demo',
  'status: in-progress',
  'milestone: tooling',
  `branch: ${BRANCH}`,
  'model: opencode/muse-spark-1.3-contributor-free',
  'effort: low',
  'depends_on: []',
  'estimate: 0.2 day',
  '---',
  '',
  '# T-0099',
  '',
  'The spec body.',
  '',
].join('\n');

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

// A main checkout whose task spec is left uncommitted (`committed: false`) or
// committed on main (`committed: true`). No board row and no spec commit at
// launch in the untracked case — the shape T-1420 introduces.
function setup(committed: boolean): { dir: string; repoRoot: string; statePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-launch-'));
  const repoRoot = path.join(dir, 'zilar');
  fs.mkdirSync(repoRoot, { recursive: true });
  git(dir, ['init', '--bare', '-q', path.join(dir, 'origin.git')]);
  git(repoRoot, ['init', '-b', 'main', '-q']);
  git(repoRoot, ['config', 'user.email', 'test@example.com']);
  git(repoRoot, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(repoRoot, 'work'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'work', 'BOARD.md'), '# Board\n');
  if (committed) {
    fs.writeFileSync(path.join(repoRoot, 'work', FILE), TASK_FILE);
  }
  git(repoRoot, ['add', '.']);
  git(repoRoot, ['commit', '-qm', 'init']);
  if (!committed) {
    fs.writeFileSync(path.join(repoRoot, 'work', FILE), TASK_FILE);
  }
  return { dir, repoRoot, statePath: path.join(dir, 'state.json') };
}

function launch(
  repoRoot: string,
  statePath: string,
): Promise<{ sessionId: string; worktree: string }> {
  return launchTask(
    { task: TASK, extraRulesFile: undefined, base: undefined },
    {
      repoRoot,
      client: new FakeOpenCodeClient(),
      promptsDirPath: promptsDir(),
      statePath,
      runner: new RealGitRunner(),
    },
  );
}

describe('launchTask from an uncommitted spec', () => {
  it('commits the spec on the task branch and leaves main clean', async () => {
    const { dir, repoRoot, statePath } = setup(false);
    const { worktree } = await launch(repoRoot, statePath);

    // The branch carries the spec in its own commit.
    expect(git(worktree, ['log', '-1', '--format=%s']).trim()).toBe(`${TASK}: spec`);
    expect(git(worktree, ['show', '--name-only', '--format=', 'HEAD'])).toContain(`work/${FILE}`);
    expect(git(worktree, ['cat-file', '-e', `HEAD:work/${FILE}`])).toBe('');

    // Main no longer holds the uncommitted spec and has no new commit.
    expect(fs.existsSync(path.join(repoRoot, 'work', FILE))).toBe(false);
    expect(git(repoRoot, ['status', '--porcelain']).trim()).toBe('');
    expect(git(repoRoot, ['log', '--format=%s']).trim()).toBe('init');

    // The task is tracked so the readers find its worktree copy.
    expect(loadState(statePath).tasks[TASK]?.worktree).toBe(worktree);
    expect(worktree).toBe(path.join(dir, `zilar-${TASK}`));
  });

  it('keeps a spec already committed on main without an extra commit', async () => {
    const { repoRoot, statePath } = setup(true);
    const { worktree } = await launch(repoRoot, statePath);

    expect(git(worktree, ['rev-parse', 'HEAD']).trim()).toBe(
      git(repoRoot, ['rev-parse', 'HEAD']).trim(),
    );
    expect(fs.existsSync(path.join(repoRoot, 'work', FILE))).toBe(true);
    expect(git(repoRoot, ['status', '--porcelain']).trim()).toBe('');
  });
});
