import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeOpenCodeClient, type OpenCodeClient } from './client';
import { launchTask, startWorkerSession } from './launch';
import type { GitRunner } from './git';
import { promptsDir } from './prompts';
import { loadState } from './state';

// The order test stubs only the methods `startWorkerSession` calls; declare
// the shape here so the test doesn't have to duplicate the full interface.
type OpenCodeClientLike = Pick<
  OpenCodeClient,
  | 'createSession'
  | 'promptDetached'
  | 'interrupt'
  | 'tryInterrupt'
  | 'listMessages'
  | 'listPermissions'
  | 'replyPermission'
  | 'switchModel'
>;

const TASK_MD = (model: string, effort?: string): string =>
  [
    '---',
    'id: T-0099',
    'title: Demo',
    'status: todo',
    'milestone: tooling',
    'branch: task/T-0099-demo',
    `model: ${model}`,
    ...(effort === undefined ? [] : [`effort: ${effort}`]),
    'depends_on: []',
    'estimate: 1 day',
    '---',
    '',
    '# T-0099',
    '',
  ].join('\n');

function setupRepo(
  model = 'opencode-go/muse-spark-1.3-contributor',
  effort?: string,
): {
  repoRoot: string;
  statePath: string;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-launch-'));
  const repoRoot = path.join(dir, 'zilar');
  fs.mkdirSync(path.join(repoRoot, 'work'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'work', 'T-0099-demo.md'), TASK_MD(model, effort));
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
  it('uses the effort from the task front matter instead of the low default', async () => {
    const { repoRoot, statePath } = setupRepo('opencode-go/muse-spark-1.3-contributor', 'high');
    const client = new FakeOpenCodeClient();

    await launchTask('T-0099', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
      runner: stubRunner([]),
    });

    expect(client.created[0]?.options.model.variant).toBe('high');
  });

  it('resolves `auto` to DeepSeek flash with default effort off-peak', async () => {
    const { repoRoot, statePath } = setupRepo('auto');
    const client = new FakeOpenCodeClient();

    await launchTask('T-0099', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
      runner: stubRunner([]),
      now: () => new Date('2026-10-05T00:59:00.000Z'),
    });

    expect(client.created[0]?.options.model).toEqual({
      providerID: 'deepseek',
      id: 'deepseek-flash',
      variant: 'default',
    });
    expect(loadState(statePath).tasks['T-0099']?.model).toBe('deepseek/deepseek-flash');
  });

  it('resolves `auto` to the free Muse in DeepSeek peak hours', async () => {
    const { repoRoot, statePath } = setupRepo('auto');
    const client = new FakeOpenCodeClient();

    await launchTask('T-0099', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
      runner: stubRunner([]),
      now: () => new Date('2026-10-05T09:59:00.000Z'),
    });

    expect(client.created[0]?.options.model).toMatchObject({
      providerID: 'opencode',
      id: 'muse-spark-1.3-contributor-free',
    });
    expect(loadState(statePath).tasks['T-0099']?.model).toBe(
      'opencode/muse-spark-1.3-contributor-free',
    );
  });

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
    expect(worktree).toBe(path.join(path.dirname(repoRoot), 'zilar-T-0099'));
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
      variant: 'low',
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
    const repoRoot = path.join(dir, 'zilar');
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

describe('startWorkerSession', () => {
  // Swap the worker prompt for a broken one that leaves a placeholder
  // unfilled, then assert no session was created: the prompt is validated
  // BEFORE createSession, so a typo can't leave an orphan session.
  const original = fs.readFileSync(path.join(promptsDir(), 'worker.md'), 'utf8');

  afterEach(() => {
    fs.writeFileSync(path.join(promptsDir(), 'worker.md'), original);
  });

  it('does not call createSession when the prompt has unfilled placeholders', async () => {
    // Replace the prompt with one that does not consume the four required
    // placeholders. The renderer will not know to fill any of them, the
    // validator will refuse, and createSession must not run.
    fs.writeFileSync(path.join(promptsDir(), 'worker.md'), 'A prompt without placeholders.\n');
    const client = new FakeOpenCodeClient();
    await expect(
      startWorkerSession({
        client,
        promptsDirPath: promptsDir(),
        task: 'T-0099',
        file: 'T-0099-demo.md',
        worktree: '/tmp/zilar-T-0099',
        branch: 'task/T-0099-demo',
        title: 'T-0099',
        model: { providerID: 'opencode-go', id: 'muse-spark-1.3-contributor' },
        rules: [],
        template: 'worker',
      }),
    ).rejects.toThrow(/unfilled placeholders|missing substituted/);
    // No orphan session was created.
    expect(client.created).toEqual([]);
  });

  it('throws on unfilled placeholders BEFORE createSession', async () => {
    // Use an injectable client that records the call order. The renderer
    // runs first and throws, so createSession is never called.
    fs.writeFileSync(path.join(promptsDir(), 'worker.md'), 'Static text with no placeholders.\n');
    const order: string[] = [];
    const client: OpenCodeClientLike = {
      createSession: () => {
        order.push('createSession');
        return Promise.resolve('ses_should_not_be_created');
      },
      promptDetached: () => {
        order.push('promptDetached');
      },
      interrupt: () => Promise.resolve(),
      tryInterrupt: () => Promise.resolve({ kind: 'ok' }),
      listMessages: () => Promise.resolve([]),
      listPermissions: () => Promise.resolve([]),
      replyPermission: () => Promise.resolve(),
      switchModel: () => Promise.resolve(),
    };
    await expect(
      startWorkerSession({
        client,
        promptsDirPath: promptsDir(),
        task: 'T-0099',
        file: 'T-0099-demo.md',
        worktree: '/tmp/zilar-T-0099',
        branch: 'task/T-0099-demo',
        title: 'T-0099',
        model: { providerID: 'opencode-go', id: 'muse-spark-1.3-contributor' },
        rules: [],
        template: 'worker',
      }),
    ).rejects.toThrow(/unfilled placeholders|missing substituted/);
    expect(order).toEqual([]);
  });
});
