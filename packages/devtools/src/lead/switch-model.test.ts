import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeOpenCodeClient } from './client';
import { launchTask } from './launch';
import { promptsDir } from './prompts';
import { loadState, saveState, updateState } from './state';
import { switchModel } from './switch-model';
import { newTaskRecord } from './types';

const TASK_MD = (model: string): string =>
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

function setupRepo(model = 'opencode-go/muse-spark-1.3-contributor'): {
  repoRoot: string;
  worktree: string;
  statePath: string;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-switch-'));
  const repoRoot = path.join(dir, 'zilar');
  fs.mkdirSync(path.join(repoRoot, 'work'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'work', 'T-0099-demo.md'), TASK_MD(model));
  // The worktree path is declared up front but not created: `launchTask`
  // refuses when the directory exists, and switchModel only needs to verify
  // it exists. Tests that want it present must create it (or call launchTask
  // which leaves the directory behind through its stubbed worktree-add).
  const worktree = path.join(path.dirname(repoRoot), 'zilar-T-0099');
  return { repoRoot, worktree, statePath: path.join(dir, 'state.json') };
}

// A GitRunner stub that records calls and creates the worktree directory on
// `worktree add` so `launchTask` (used to prime the state) and `switchModel`
// (which only checks the directory exists) both succeed.
function stubRunner(calls: string[][] = []): {
  runner: { run: (cwd: string, args: string[]) => { ok: boolean; stdout: string } };
} {
  return {
    runner: {
      run: (cwd, args) => {
        calls.push([cwd, ...args]);
        if (args[0] === 'worktree' && args[1] === 'add') {
          const target = args[3];
          if (typeof target === 'string') {
            fs.mkdirSync(target, { recursive: true });
          }
        }
        return { ok: true, stdout: '' };
      },
    },
  };
}

describe('switchModel', () => {
  it('interrupts the old session, opens a new one with the new model, and updates state', async () => {
    const { repoRoot, worktree, statePath } = setupRepo();
    const client = new FakeOpenCodeClient();
    const { runner } = stubRunner();
    // Prime the state with a worker record the way `lead launch` leaves it.
    const launched = await launchTask('T-0099', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
      runner,
    });
    const oldSessionId = launched.sessionId;

    const result = await switchModel('T-0099', 'minimax-coding-plan/MiniMax-M3', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
    });

    // The previous session was interrupted; the new one has the new model.
    expect(client.interrupted).toContain(oldSessionId);
    expect(client.created).toHaveLength(2);
    const newSession = client.created[1];
    expect(newSession?.options.model).toEqual({
      providerID: 'minimax-coding-plan',
      id: 'MiniMax-M3',
    });
    expect(newSession?.options.directory).toBe(worktree);
    expect(newSession?.options.title).toBe(
      'T-0099 (T-0099-demo.md) [minimax-coding-plan/MiniMax-M3]',
    );
    expect(result.sessionId).toBe(newSession?.sessionId);
    expect(result.model).toBe('minimax-coding-plan/MiniMax-M3');

    // The worker prompt was sent through the switch template with placeholders filled.
    const prompt =
      client.prompted.find((entry) => entry.sessionId === result.sessionId)?.text ?? '';
    expect(prompt).toContain('T-0099');
    expect(prompt).toContain('work/T-0099-demo.md');
    expect(prompt).toContain(worktree);
    expect(prompt).toContain('task/T-0099-demo');
    expect(prompt).toMatch(/switched this task from another model/i);
    // No `{{TASK}}` or friends slipped through; the shared helper enforces
    // this and switch-model reuses it.
    expect(prompt).not.toMatch(/\{\{TASK\}\}/);
    expect(prompt).not.toMatch(/\{\{TASK_FILE\}\}/);
    expect(prompt).not.toMatch(/\{\{WORKTREE\}\}/);
    expect(prompt).not.toMatch(/\{\{BRANCH\}\}/);

    // State now points at the new session and the new model, with a switchedAt stamp.
    const record = loadState(statePath).tasks['T-0099'];
    expect(record?.sessionId).toBe(result.sessionId);
    expect(record?.model).toBe('minimax-coding-plan/MiniMax-M3');
    expect(record?.worktree).toBe(worktree);
    expect(record?.switchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // startedAt survives the switch.
    expect(record?.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('resets per-session counters so the autopilot treats the new model as fresh', async () => {
    const { repoRoot, worktree, statePath } = setupRepo();
    const client = new FakeOpenCodeClient();
    fs.mkdirSync(worktree, { recursive: true });
    const state = loadState(statePath);
    state.tasks['T-0099'] = newTaskRecord({
      task: 'T-0099',
      sessionId: 'ses_old',
      worktree,
      model: 'opencode-go/muse-spark-1.3-contributor',
      role: 'worker',
      startedAt: '2026-09-28T00:00:00.000Z',
    });
    state.tasks['T-0099'] = {
      ...state.tasks['T-0099']!,
      nudgesSent: 2,
      lastQuotaRetryAt: 1700000000000,
      lastQuotaEscalatedAt: 1700000000000,
      stalledEscalated: true,
      blockedEscalatedText: 'needs decision',
      lastEscalation: 'LEAD: STALLED T-0099',
      escalatedPermissionIds: ['per_1'],
      escalatedQuestionIds: ['q_1'],
      prereviewStalledEscalated: true,
      packetReadyForHead: 'abc',
    };
    saveState(statePath, state);

    await switchModel('T-0099', 'minimax-coding-plan/MiniMax-M3', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
    });

    const record = loadState(statePath).tasks['T-0099'];
    expect(record?.nudgesSent).toBe(0);
    expect(record?.lastQuotaRetryAt).toBeUndefined();
    expect(record?.lastQuotaEscalatedAt).toBeUndefined();
    expect(record?.stalledEscalated).toBe(false);
    expect(record?.blockedEscalatedText).toBeUndefined();
    expect(record?.lastEscalation).toBeUndefined();
    expect(record?.escalatedPermissionIds).toEqual([]);
    expect(record?.escalatedQuestionIds).toEqual([]);
    expect(record?.prereviewStalledEscalated).toBe(false);
    expect(record?.packetReadyForHead).toBeUndefined();
    // startedAt is preserved across the switch.
    expect(record?.startedAt).toBe('2026-09-28T00:00:00.000Z');
  });

  it('refuses an unknown task', async () => {
    const { repoRoot, statePath } = setupRepo();
    await expect(
      switchModel('T-0099', 'minimax-coding-plan/MiniMax-M3', undefined, {
        repoRoot,
        client: new FakeOpenCodeClient(),
        promptsDirPath: promptsDir(),
        statePath,
      }),
    ).rejects.toThrow(/unknown task T-0099/);
  });

  it('refuses when the worktree is missing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-switch-'));
    const repoRoot = path.join(dir, 'zilar');
    fs.mkdirSync(path.join(repoRoot, 'work'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'work', 'T-0099-demo.md'), TASK_MD('opencode-go/x'));
    const statePath = path.join(dir, 'state.json');
    const state = loadState(statePath);
    state.tasks['T-0099'] = newTaskRecord({
      task: 'T-0099',
      sessionId: 'ses_old',
      worktree: path.join(path.dirname(repoRoot), 'zilar-T-0099'),
      model: 'opencode-go/muse-spark-1.3-contributor',
      role: 'worker',
      startedAt: '2026-09-28T00:00:00.000Z',
    });
    saveState(statePath, state);

    await expect(
      switchModel('T-0099', 'minimax-coding-plan/MiniMax-M3', undefined, {
        repoRoot,
        client: new FakeOpenCodeClient(),
        promptsDirPath: promptsDir(),
        statePath,
      }),
    ).rejects.toThrow(/worktree is missing/);
  });

  it('refuses a malformed model string', async () => {
    const { repoRoot, statePath } = setupRepo();
    const client = new FakeOpenCodeClient();
    const { runner } = stubRunner();
    await launchTask('T-0099', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
      runner,
    });
    await expect(
      switchModel('T-0099', 'no-slash', undefined, {
        repoRoot,
        client,
        promptsDirPath: promptsDir(),
        statePath,
      }),
    ).rejects.toThrow(/providerID\/modelID/);
  });

  it('refuses V4 Pro', async () => {
    const { repoRoot, statePath } = setupRepo();
    const client = new FakeOpenCodeClient();
    const { runner } = stubRunner();
    await launchTask('T-0099', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
      runner,
    });
    await expect(
      switchModel('T-0099', 'opencode-go/deepseek-v4-pro', undefined, {
        repoRoot,
        client,
        promptsDirPath: promptsDir(),
        statePath,
      }),
    ).rejects.toThrow(/V4 Pro/);
  });

  it('proceeds when the previous session is already idle and records the interrupt attempt', async () => {
    const { repoRoot, worktree, statePath } = setupRepo();
    const client = new FakeOpenCodeClient();
    const { runner } = stubRunner();
    const launched = await launchTask('T-0099', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
      runner,
    });
    const oldSessionId = launched.sessionId;
    client.scriptInterrupt(oldSessionId, { kind: 'already_idle' });

    const result = await switchModel('T-0099', 'minimax-coding-plan/MiniMax-M3', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
    });
    expect(result.sessionId).toBeTruthy();
    // The interrupt was attempted and the outcome was recorded as already_idle.
    expect(client.interruptOutcomes).toContainEqual({
      sessionId: oldSessionId,
      outcome: { kind: 'already_idle' },
    });
    // The new session was created despite the idle interrupt.
    expect(client.created).toHaveLength(2);
    expect(client.created[1]?.options.directory).toBe(worktree);
    // The lead.log mentions the idle session.
    const log = fs.readFileSync(path.join(path.dirname(statePath), 'lead.log'), 'utf8');
    expect(log).toMatch(/was already idle/);
  });

  it('proceeds when the previous session is not found and logs it', async () => {
    const { repoRoot, worktree, statePath } = setupRepo();
    const client = new FakeOpenCodeClient();
    const { runner } = stubRunner();
    const launched = await launchTask('T-0099', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
      runner,
    });
    // Force the fake to report not_found on the previous session.
    client.scriptInterrupt(launched.sessionId, { kind: 'not_found' });

    const result = await switchModel('T-0099', 'minimax-coding-plan/MiniMax-M3', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
    });
    expect(result.sessionId).toBeTruthy();
    expect(client.created).toHaveLength(2);
    expect(client.created[1]?.options.directory).toBe(worktree);
    const log = fs.readFileSync(path.join(path.dirname(statePath), 'lead.log'), 'utf8');
    expect(log).toMatch(/is gone/);
  });

  it('aborts the switch and leaves no new session when the interrupt errors', async () => {
    const { repoRoot, statePath } = setupRepo();
    const client = new FakeOpenCodeClient();
    const { runner } = stubRunner();
    const launched = await launchTask('T-0099', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
      runner,
    });
    client.scriptInterrupt(launched.sessionId, {
      kind: 'error',
      message: 'upstream timeout',
    });
    const stateBefore = loadState(statePath);

    await expect(
      switchModel('T-0099', 'minimax-coding-plan/MiniMax-M3', undefined, {
        repoRoot,
        client,
        promptsDirPath: promptsDir(),
        statePath,
      }),
    ).rejects.toThrow(/refusing to switch T-0099:.*upstream timeout/);

    // No new session was created.
    expect(client.created).toHaveLength(1);
    // State was not touched by the failed switch.
    const stateAfter = loadState(statePath);
    expect(stateAfter.tasks['T-0099']).toEqual(stateBefore.tasks['T-0099']);
    // The previous session is still on the record (no switchedAt stamp).
    expect(stateAfter.tasks['T-0099']?.switchedAt).toBeUndefined();
  });

  it('keeps a task written by another command while the switch runs', async () => {
    const { repoRoot, statePath } = setupRepo();
    const client = new FakeOpenCodeClient();
    const { runner } = stubRunner();
    await launchTask('T-0099', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
      runner,
    });
    // Another writer (e.g. lead launch) adds T-0100 while the switch is busy
    // on the interrupt / new session.
    const realTryInterrupt = client.tryInterrupt.bind(client);
    client.tryInterrupt = async (sessionId: string) => {
      const outcome = await realTryInterrupt(sessionId);
      updateState(statePath, (state) => {
        state.tasks['T-0100'] = newTaskRecord({
          task: 'T-0100',
          sessionId: 'ses_other',
          worktree: '/tmp/other',
          model: 'opencode-go/muse-spark-1.3-contributor',
          role: 'worker',
          startedAt: '2026-10-04T00:00:00.000Z',
        });
      });
      return outcome;
    };

    const result = await switchModel('T-0099', 'minimax-coding-plan/MiniMax-M3', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
    });

    const after = loadState(statePath);
    expect(after.tasks['T-0100']?.sessionId).toBe('ses_other');
    expect(after.tasks['T-0099']?.sessionId).toBe(result.sessionId);
    expect(after.tasks['T-0099']?.model).toBe('minimax-coding-plan/MiniMax-M3');
  });

  it('validates the rules and the prompt before touching the old session', async () => {
    const { repoRoot, statePath } = setupRepo();
    const client = new FakeOpenCodeClient();
    const { runner } = stubRunner();
    await launchTask('T-0099', undefined, {
      repoRoot,
      client,
      promptsDirPath: promptsDir(),
      statePath,
      runner,
    });
    const stateBefore = loadState(statePath);

    await expect(
      switchModel('T-0099', 'minimax-coding-plan/MiniMax-M3', '/nonexistent/extra-rules.json', {
        repoRoot,
        client,
        promptsDirPath: promptsDir(),
        statePath,
      }),
    ).rejects.toThrow();

    // The typo failed before any interrupt: the old worker keeps running.
    expect(client.interruptOutcomes).toHaveLength(0);
    expect(client.created).toHaveLength(1);
    expect(loadState(statePath).tasks['T-0099']).toEqual(stateBefore.tasks['T-0099']);
  });
});
