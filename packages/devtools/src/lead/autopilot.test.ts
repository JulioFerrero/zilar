import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractVerdict, tickOnce, type AutopilotDeps } from './autopilot';
import { FakeOpenCodeClient } from './client';
import type { GitRunner } from './git';
import { promptsDir } from './prompts';
import { loadState, saveState } from './state';
import { emptyState } from './state';
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

const noGit: GitRunner = {
  run: () => ({ ok: false, stdout: '' }),
};

function setup(): { deps: AutopilotDeps; client: FakeOpenCodeClient; worktree: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-tick-'));
  const worktree = path.join(dir, 'galena-T-0099');
  fs.mkdirSync(path.join(worktree, 'work'), { recursive: true });
  fs.writeFileSync(path.join(worktree, 'work', 'T-0099-demo.md'), TASK_MD);
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
  return {
    deps: { client, runner: noGit, statePath, promptsDirPath: promptsDir() },
    client,
    worktree,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tickOnce', () => {
  it('answers allow/reject itself and escalates the rest once', async () => {
    const { deps, client } = setup();
    const session = client.sessions.get('ses_worker');
    if (session === undefined) {
      throw new Error('missing fake session');
    }
    session.messages = [{ id: 'm', type: 'text', time: { created: 1 } }];
    session.permissions = [
      { id: 'per_allow', action: 'shell', resources: 'rm -rf dist' },
      { id: 'per_escalate', action: 'shell', resources: 'npx expo install x' },
    ];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const first = await tickOnce(deps, { dryRun: false, now: 1000 });
    expect(client.replied).toContainEqual({
      sessionId: 'ses_worker',
      requestId: 'per_allow',
      decision: 'once',
      message: undefined,
    });
    expect(client.replied.some((entry) => entry.requestId === 'per_escalate')).toBe(false);
    expect(first.escalations).toHaveLength(1);
    expect(first.escalations[0]).toMatch(/^LEAD: PERMISSION T-0099 per_escalate/);
    expect(log).toHaveBeenCalledWith(first.escalations[0]);

    // The escalation is recorded, so the next tick stays quiet.
    session.permissions = [
      { id: 'per_escalate', action: 'shell', resources: 'npx expo install x' },
    ];
    const second = await tickOnce(deps, { dryRun: false, now: 2000 });
    expect(second.escalations).toEqual([]);
    const leadLines = log.mock.calls.filter((call) =>
      String(call[0]).startsWith('LEAD: PERMISSION'),
    );
    expect(leadLines).toHaveLength(1);

    // The state file kept the bookkeeping.
    expect(loadState(deps.statePath).tasks['T-0099']?.escalatedPermissionIds).toContain(
      'per_escalate',
    );
  });

  it('dry-run classifies and prints, but acts on nothing', async () => {
    const { deps, client } = setup();
    const session = client.sessions.get('ses_worker');
    if (session === undefined) {
      throw new Error('missing fake session');
    }
    session.messages = [{ id: 'm', type: 'text', time: { created: 1 } }];
    session.permissions = [
      { id: 'per_allow', action: 'shell', resources: 'rm -rf dist' },
      { id: 'per_escalate', action: 'shell', resources: 'npx expo install x' },
    ];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await tickOnce(deps, { dryRun: true, now: 1000 });
    expect(client.replied).toEqual([]);
    expect(client.prompted).toEqual([]);
    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.startsWith('DRY: would reply once to per_allow'))).toBe(true);
    expect(lines.some((line) => line.startsWith('DRY: would escalate: LEAD:'))).toBe(true);
    expect(lines.some((line) => line.startsWith('LEAD:'))).toBe(false);
    // Nothing was recorded.
    expect(loadState(deps.statePath).tasks['T-0099']?.escalatedPermissionIds).toEqual([]);
  });

  it('never merges, pushes, or edits task files or the board', async () => {
    const { deps, client, worktree } = setup();
    const before = fs.readFileSync(path.join(worktree, 'work', 'T-0099-demo.md'), 'utf8');
    const session = client.sessions.get('ses_worker');
    if (session === undefined) {
      throw new Error('missing fake session');
    }
    session.messages = [{ id: 'm', type: 'idle', outcome: 'done', time: { created: 1 } }];
    session.permissions = [{ id: 'per_x', action: 'shell', resources: 'git push' }];
    await tickOnce(deps, { dryRun: false, now: 1000 });
    // The push was rejected, not run; the task file is byte-identical.
    expect(fs.readFileSync(path.join(worktree, 'work', 'T-0099-demo.md'), 'utf8')).toBe(before);
    // No git runner that could merge was even given a mutating command, and
    // the client interface has no merge/push operation at all.
    expect(client.created).toEqual([]);
  });
});

describe('extractVerdict', () => {
  it('finds the verdict line', () => {
    expect(extractVerdict('# R\n\nVerdict: approved\n')).toBe('Verdict: approved');
  });

  it('falls back when there is none', () => {
    expect(extractVerdict('# R\n\nnothing\n')).toBe('(no verdict line)');
  });
});
