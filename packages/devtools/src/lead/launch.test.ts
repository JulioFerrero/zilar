import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeOpenCodeClient } from './client';
import { launchTask } from './launch';
import type { GitRunner } from './git';
import { promptsDir } from './prompts';
import { loadState } from './state';

const TASK_MD = (model: string): string =>
  [
    '---',
    'id: T-0099',
    'title: Demo',
    'status: todo',
    'milestone: tooling',
    'branch: task/T-0099-demo',
    `model: ${model}`,
    'depends_on: []',
    'estimate: 1 day',
    '---',
    '',
    '# T-0099',
    '',
  ].join('\n');

function setupRepo(model = 'opencode-go/muse-spark-1.3-contributor'): {
  repoRoot: string;
  statePath: string;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-launch-'));
  const repoRoot = path.join(dir, 'galena');
  fs.mkdirSync(path.join(repoRoot, 'work'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'work', 'T-0099-demo.md'), TASK_MD(model));
  return { repoRoot, statePath: path.join(dir, 'state.json') };
}

function stubRunner(calls: string[][]): GitRunner {
  return {
    run: (cwd, args) => {
      calls.push([cwd, ...args]);
      return { ok: true, stdout: '' };
    },
  };
}

describe('launchTask', () => {
  it('creates the worktree, session, prompt, and state record', async () => {
    const { repoRoot, statePath } = setupRepo();
    const client = new FakeOpenCodeClient();
    const gitCalls: string[][] = [];

    const { sessionId, worktree } = await launchTask('T-0099', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
      runner: stubRunner(gitCalls),
    });

    // Sibling worktree on the task branch from main.
    expect(worktree).toBe(path.join(path.dirname(repoRoot), 'galena-T-0099'));
    expect(gitCalls[0]?.slice(1)).toEqual([
      'worktree',
      'add',
      '-q',
      worktree,
      '-b',
      'task/T-0099-demo',
      'main',
    ]);
    // Session with the split model and the base rules.
    expect(client.created).toHaveLength(1);
    expect(client.created[0]?.options.model).toEqual({
      providerID: 'opencode-go',
      id: 'muse-spark-1.3-contributor',
    });
    expect(client.created[0]?.options.directory).toBe(worktree);
    expect(client.created[0]?.options.permissions.length).toBeGreaterThan(20);
    // The worker prompt names the task, file, worktree, and branch.
    const prompt = client.prompted.find((entry) => entry.sessionId === sessionId)?.text ?? '';
    expect(prompt).toContain('work/T-0099-demo.md');
    expect(prompt).toContain(worktree);
    expect(prompt).toContain('task/T-0099-demo');
    // State record for the autopilot to watch.
    const record = loadState(statePath).tasks['T-0099'];
    expect(record).toMatchObject({ task: 'T-0099', sessionId, worktree, role: 'worker' });
  });

  it('appends extra rules after the base ones', async () => {
    const { repoRoot, statePath } = setupRepo();
    const client = new FakeOpenCodeClient();
    const extraFile = path.join(path.dirname(statePath), 'extra.json');
    fs.writeFileSync(
      extraFile,
      JSON.stringify([{ action: 'shell', resource: 'docker ps*', effect: 'allow' }]),
    );
    await launchTask('T-0099', extraFile, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
      runner: stubRunner([]),
    });
    const permissions = client.created[0]?.options.permissions ?? [];
    expect(permissions[permissions.length - 1]).toMatchObject({
      resource: 'docker ps*',
      effect: 'allow',
    });
  });

  it('refuses the V4 Pro model', async () => {
    const { repoRoot, statePath } = setupRepo('opencode-go/deepseek-v4-pro');
    await expect(
      launchTask('T-0099', undefined, {
        repoRoot,
        client: new FakeOpenCodeClient(),
        promptsDirPath: promptsDir(),
        statePath,
        runner: stubRunner([]),
      }),
    ).rejects.toThrow(/V4 Pro/);
  });

  it('rejects a task file without a model', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-launch-'));
    const repoRoot = path.join(dir, 'galena');
    fs.mkdirSync(path.join(repoRoot, 'work'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, 'work', 'T-0099-demo.md'),
      '---\nid: T-0099\nbranch: task/x\nstatus: todo\n---\n',
    );
    await expect(
      launchTask('T-0099', undefined, {
        repoRoot,
        client: new FakeOpenCodeClient(),
        promptsDirPath: promptsDir(),
        statePath: path.join(dir, 'state.json'),
        runner: stubRunner([]),
      }),
    ).rejects.toThrow(/model/);
  });
});
