import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeOpenCodeClient } from './client';
import { freshSessionRecord, startFreshWorkerSession } from './fresh-session';
import { promptsDir } from './prompts';
import { emptyState, saveState } from './state';
import { newTaskRecord } from './types';

const taskMd = (model: string): string =>
  [
    '---',
    'id: T-0099',
    'title: Demo',
    'status: in-progress',
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

function setup(model = 'opencode-go/muse-spark-1.3-contributor'): {
  client: FakeOpenCodeClient;
  worktree: string;
  dir: string;
  record: ReturnType<typeof newTaskRecord>;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-fresh-'));
  const worktree = path.join(dir, 'zilar-T-0099');
  fs.mkdirSync(path.join(worktree, 'work'), { recursive: true });
  fs.writeFileSync(path.join(worktree, 'work', 'T-0099-demo.md'), taskMd(model));
  fs.mkdirSync(path.join(dir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'work', 'T-0099-demo.md'), taskMd(model));
  const record = newTaskRecord({
    task: 'T-0099',
    sessionId: 'ses_old',
    worktree,
    model,
    role: 'worker',
    startedAt: '2026-09-28T00:00:00.000Z',
  });
  record.nudgesSent = 2;
  record.stalledEscalated = true;
  record.escalatedPermissionIds = ['per_old'];
  record.escalatedQuestionIds = ['q_old'];
  record.lastQuotaRetryAt = 111;
  record.lastQuotaEscalatedAt = 222;
  record.autoFixRounds = 1;
  record.packetReadyForHead = 'h'.repeat(40);
  record.prereview = { sessionId: 'ses_pre', head: 'h'.repeat(40), startedAt: 'x' };
  return { client: new FakeOpenCodeClient(), worktree, dir, record };
}

describe('freshSessionRecord', () => {
  it('swaps the session id and resets per-session bookkeeping', () => {
    const { record } = setup();
    const fresh = freshSessionRecord(record, 'ses_new');
    expect(fresh.sessionId).toBe('ses_new');
    expect(fresh.nudgesSent).toBe(0);
    expect(fresh.lastQuotaRetryAt).toBeUndefined();
    expect(fresh.lastQuotaEscalatedAt).toBeUndefined();
    expect(fresh.stalledEscalated).toBe(false);
    expect(fresh.escalatedPermissionIds).toEqual([]);
    expect(fresh.escalatedQuestionIds).toEqual([]);
  });

  it('keeps the round count, pre-review and task identity', () => {
    const { record, worktree } = setup();
    const fresh = freshSessionRecord(record, 'ses_new');
    expect(fresh.autoFixRounds).toBe(1);
    expect(fresh.packetReadyForHead).toBe('h'.repeat(40));
    expect(fresh.prereview?.sessionId).toBe('ses_pre');
    expect(fresh.model).toBe('opencode-go/muse-spark-1.3-contributor');
    expect(fresh.worktree).toBe(worktree);
    expect(fresh.startedAt).toBe('2026-09-28T00:00:00.000Z');
  });
});

describe('startFreshWorkerSession', () => {
  it('creates a build session in the worktree with the task model and sends the prompt', async () => {
    const { client, dir, worktree, record } = setup();
    const statePath = path.join(dir, 'state.json');
    const state = emptyState();
    state.tasks['T-0099'] = record;
    saveState(statePath, state);

    const { sessionId } = await startFreshWorkerSession(
      { client, promptsDirPath: promptsDir(), repoRoot: dir },
      { task: 'T-0099', record, title: 'T-0099 autofix round 2', prompt: 'fix it' },
    );

    expect(sessionId).toMatch(/^ses_fake/);
    expect(client.created).toHaveLength(1);
    expect(client.created[0]?.options.directory).toBe(worktree);
    expect(client.created[0]?.options.agent).toBe('build');
    expect(client.created[0]?.options.title).toBe('T-0099 autofix round 2');
    expect(client.created[0]?.options.model).toMatchObject({
      providerID: 'opencode-go',
      id: 'muse-spark-1.3-contributor',
      variant: 'low',
    });
    expect(client.prompted).toContainEqual({ sessionId, text: 'fix it' });
  });

  it('re-resolves `auto` to the free Muse in peak hours even after a DeepSeek pass', async () => {
    const { client, dir, record } = setup('auto');
    record.model = 'deepseek/deepseek-flash';

    const { model } = await startFreshWorkerSession(
      {
        client,
        promptsDirPath: promptsDir(),
        repoRoot: dir,
        now: () => new Date('2026-10-05T09:59:00.000Z'),
      },
      { task: 'T-0099', record, title: 'T-0099 autofix round 2', prompt: 'fix it' },
    );

    expect(model).toBe('opencode/muse-spark-1.3-contributor-free');
    expect(client.created[0]?.options.model).toEqual({
      providerID: 'opencode',
      id: 'muse-spark-1.3-contributor-free',
      variant: 'low',
    });
  });

  it('re-resolves `auto` to DeepSeek with default effort off-peak', async () => {
    const { client, dir, record } = setup('auto');
    record.model = 'opencode/muse-spark-1.3-contributor-free';

    const { model } = await startFreshWorkerSession(
      {
        client,
        promptsDirPath: promptsDir(),
        repoRoot: dir,
        now: () => new Date('2026-10-05T00:59:00.000Z'),
      },
      { task: 'T-0099', record, title: 'T-0099 autofix round 2', prompt: 'fix it' },
    );

    expect(model).toBe('deepseek/deepseek-flash');
    expect(client.created[0]?.options.model).toEqual({
      providerID: 'deepseek',
      id: 'deepseek-flash',
      variant: 'default',
    });
  });
});
