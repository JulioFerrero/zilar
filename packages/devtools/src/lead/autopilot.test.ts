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

const HEAD = 'a'.repeat(40);

const headGit: GitRunner = {
  run: (_cwd, args) =>
    args[0] === 'rev-parse' ? { ok: true, stdout: `${HEAD}\n` } : { ok: false, stdout: '' },
};

function setup(
  status = 'in-progress',
  runner: GitRunner = noGit,
): { deps: AutopilotDeps; client: FakeOpenCodeClient; worktree: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-tick-'));
  const worktree = path.join(dir, 'zilar-T-0099');
  fs.mkdirSync(path.join(worktree, 'work'), { recursive: true });
  fs.writeFileSync(
    path.join(worktree, 'work', 'T-0099-demo.md'),
    TASK_MD.replace('status: in-progress', `status: ${status}`),
  );
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
    deps: { client, runner, statePath, promptsDirPath: promptsDir() },
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

  it('answers the pre-review session’s permissions with the same policy', async () => {
    const { deps, client } = setup('review', headGit);
    const worker = client.sessions.get('ses_worker');
    if (worker === undefined) {
      throw new Error('missing fake session');
    }
    worker.messages = [{ id: 'm', type: 'idle', outcome: 'done', time: { created: 1 } }];
    client.addSession('ses_pre', {
      messages: [{ id: 'm', type: 'text', time: { created: 1 } }],
      permissions: [
        { id: 'per_pre_allow', action: 'shell', resources: 'rm -rf dist' },
        { id: 'per_pre_reject', action: 'shell', resources: 'git push' },
        { id: 'per_pre_ask', action: 'shell', resources: 'npx foo' },
      ],
    });
    const state = loadState(deps.statePath);
    const record = state.tasks['T-0099'];
    if (record === undefined) {
      throw new Error('missing record');
    }
    record.prereview = { sessionId: 'ses_pre', head: HEAD, startedAt: 'x' };
    saveState(deps.statePath, state);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const tick = await tickOnce(deps, { dryRun: false, now: 1000 });
    expect(client.replied).toContainEqual({
      sessionId: 'ses_pre',
      requestId: 'per_pre_allow',
      decision: 'once',
      message: undefined,
    });
    expect(client.replied).toContainEqual({
      sessionId: 'ses_pre',
      requestId: 'per_pre_reject',
      decision: 'reject',
      message: expect.any(String),
    });
    expect(tick.escalations).toHaveLength(1);
    expect(tick.escalations[0]).toMatch(/^LEAD: PERMISSION T-0099 pre-review per_pre_ask/);
    expect(log).toHaveBeenCalledWith(tick.escalations[0]);
  });

  it('escalates a pre-review that sits idle without PREREVIEW.md', async () => {
    const { deps, client } = setup('review', headGit);
    const worker = client.sessions.get('ses_worker');
    if (worker === undefined) {
      throw new Error('missing fake session');
    }
    worker.messages = [{ id: 'm', type: 'idle', outcome: 'done', time: { created: 1 } }];
    client.addSession('ses_pre', {
      messages: [{ id: 'm', type: 'idle', outcome: 'done', time: { created: 1 } }],
      permissions: [],
    });
    const state = loadState(deps.statePath);
    const record = state.tasks['T-0099'];
    if (record === undefined) {
      throw new Error('missing record');
    }
    record.prereview = { sessionId: 'ses_pre', head: HEAD, startedAt: 'x' };
    saveState(deps.statePath, state);

    const first = await tickOnce(deps, { dryRun: false, now: 1000 });
    expect(first.escalations).toHaveLength(1);
    expect(first.escalations[0]).toContain('PRE-REVIEW STALLED T-0099');
    const second = await tickOnce(deps, { dryRun: false, now: 2000 });
    expect(second.escalations).toEqual([]);
  });

  it('dry-run writes nothing, not even the log', async () => {
    // A record whose worktree is gone exercises the error path, which used
    // to create lead.log even in dry-run mode.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-tick-dry-'));
    const statePath = path.join(dir, 'state.json');
    const state = emptyState();
    state.tasks['T-0099'] = newTaskRecord({
      task: 'T-0099',
      sessionId: 'ses_worker',
      worktree: path.join(dir, 'no-such-worktree'),
      model: 'opencode-go/muse-spark-1.3-contributor',
      role: 'worker',
      startedAt: '2026-09-28T00:00:00.000Z',
    });
    saveState(statePath, state);
    const before = fs.readFileSync(statePath, 'utf8');
    const client = new FakeOpenCodeClient();
    client.addSession('ses_worker', { messages: [], permissions: [] });
    const deps: AutopilotDeps = { client, runner: noGit, statePath, promptsDirPath: promptsDir() };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await tickOnce(deps, { dryRun: true, now: 1000 });

    expect(err.mock.calls.some((call) => String(call[0]).includes('task file is gone'))).toBe(true);
    expect(log).not.toHaveBeenCalled();
    expect(fs.readdirSync(dir).sort()).toEqual(['state.json']);
    expect(fs.readFileSync(statePath, 'utf8')).toBe(before);
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
