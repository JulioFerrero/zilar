import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeOpenCodeClient } from './client';
import { promptsDir } from './prompts';
import { replyToWorker, type ReplyDeps } from './reply';
import { emptyState, loadState, saveState } from './state';
import { newTaskRecord } from './types';

const TASK_MD = [
  '---',
  'id: T-0099',
  'title: Demo',
  'status: in-progress',
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

function setup(): { deps: ReplyDeps; client: FakeOpenCodeClient; promptFile: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-reply-'));
  const worktree = path.join(dir, 'zilar-T-0099');
  fs.mkdirSync(path.join(worktree, 'work'), { recursive: true });
  fs.writeFileSync(path.join(worktree, 'work', 'T-0099-demo.md'), TASK_MD);
  fs.mkdirSync(path.join(dir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'work', 'T-0099-demo.md'), TASK_MD);
  const statePath = path.join(dir, 'state.json');
  const state = emptyState();
  state.tasks['T-0099'] = newTaskRecord({
    task: 'T-0099',
    sessionId: 'ses_worker',
    worktree,
    model: 'opencode-go/muse-spark-1.3-contributor',
    role: 'worker',
    startedAt: '2026-09-28T00:00:00.000Z',
  });
  saveState(statePath, state);
  const client = new FakeOpenCodeClient();
  client.addSession('ses_worker', { messages: [], permissions: [] });
  const promptFile = path.join(dir, 'lead-note.md');
  fs.writeFileSync(promptFile, 'Answer the question with yes.\n');
  const deps: ReplyDeps = { client, statePath, promptsDirPath: promptsDir(), repoRoot: dir };
  return { deps, client, promptFile, dir };
}

describe('replyToWorker', () => {
  it('without --fresh interrupts and re-prompts the same session', async () => {
    const { deps, client, promptFile } = setup();

    await replyToWorker('T-0099', promptFile, deps);

    expect(client.interrupted).toEqual(['ses_worker']);
    expect(client.created).toEqual([]);
    expect(client.prompted).toContainEqual({
      sessionId: 'ses_worker',
      text: 'Answer the question with yes.\n',
    });
    expect(loadState(deps.statePath).tasks['T-0099']?.sessionId).toBe('ses_worker');
  });

  it('--fresh interrupts the old session and prompts a new one with the template plus the lead text', async () => {
    const { deps, client, promptFile } = setup();

    await replyToWorker('T-0099', promptFile, deps, { fresh: true });

    expect(client.interruptOutcomes).toContainEqual({
      sessionId: 'ses_worker',
      outcome: { kind: 'ok' },
    });
    expect(client.created).toHaveLength(1);
    const freshId = client.created[0]?.sessionId as string;
    expect(client.created[0]?.options.directory).toContain('zilar-T-0099');
    const sent = client.prompted.find((entry) => entry.sessionId === freshId)?.text ?? '';
    expect(sent).toContain('T-0099');
    expect(sent).toContain('AGENTS.md');
    expect(sent).toContain('work/T-0099-demo.md');
    expect(sent).toContain('Answer the question with yes.');
    expect(client.prompted.some((entry) => entry.sessionId === 'ses_worker')).toBe(false);
    expect(loadState(deps.statePath).tasks['T-0099']?.sessionId).toBe(freshId);
  });

  it('--fresh fails before interrupting when the worktree is gone', async () => {
    const { deps, client, promptFile } = setup();
    fs.rmSync(path.join(deps.statePath, '..', 'zilar-T-0099', 'work'), {
      recursive: true,
      force: true,
    });

    await expect(replyToWorker('T-0099', promptFile, deps, { fresh: true })).rejects.toThrow();
    expect(client.interruptOutcomes).toEqual([]);
    expect(client.created).toEqual([]);
    expect(loadState(deps.statePath).tasks['T-0099']?.sessionId).toBe('ses_worker');
  });

  it('--fresh aborts when the old session cannot be interrupted', async () => {
    const { deps, client, promptFile } = setup();
    client.scriptInterrupt('ses_worker', { kind: 'error', message: 'boom' });

    await expect(replyToWorker('T-0099', promptFile, deps, { fresh: true })).rejects.toThrow(
      /cannot interrupt/,
    );
    expect(client.created).toEqual([]);
    expect(loadState(deps.statePath).tasks['T-0099']?.sessionId).toBe('ses_worker');
  });
});
