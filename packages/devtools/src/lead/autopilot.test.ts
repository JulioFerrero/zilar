import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractCounts, extractVerdict, tickOnce, type AutopilotDeps } from './autopilot';
import { FakeOpenCodeClient } from './client';
import type { GitRunner } from './git';
import { promptsDir } from './prompts';
import { loadState, saveState, updateState } from './state';
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
): { deps: AutopilotDeps; client: FakeOpenCodeClient; worktree: string; dir: string } {
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
    deps: { client, runner, statePath, promptsDirPath: promptsDir(), repoRoot: dir },
    client,
    worktree,
    dir,
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
    const deps: AutopilotDeps = {
      client,
      runner: noGit,
      statePath,
      promptsDirPath: promptsDir(),
      repoRoot: dir,
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await tickOnce(deps, { dryRun: true, now: 1000 });

    expect(err.mock.calls.some((call) => String(call[0]).includes('task file is gone'))).toBe(true);
    expect(log).not.toHaveBeenCalled();
    expect(fs.readdirSync(dir).sort()).toEqual(['state.json']);
    expect(fs.readFileSync(statePath, 'utf8')).toBe(before);
  });

  it('keeps a task written by another command during the tick', async () => {
    const { deps, client } = setup();
    // Another writer (e.g. lead launch) adds T-0100 while the tick is busy
    // on network calls for T-0099.
    const realListMessages = client.listMessages.bind(client);
    client.listMessages = async (sessionId: string, limit: number) => {
      const messages = await realListMessages(sessionId, limit);
      updateState(deps.statePath, (state) => {
        state.tasks['T-0100'] = newTaskRecord({
          task: 'T-0100',
          sessionId: 'ses_other',
          worktree: '/tmp/other',
          model: 'opencode-go/muse-spark-1.3-contributor',
          role: 'worker',
          startedAt: '2026-10-04T00:00:00.000Z',
        });
      });
      return messages;
    };

    await tickOnce(deps, { dryRun: false, now: 1000 });

    const after = loadState(deps.statePath);
    expect(after.tasks['T-0100']?.sessionId).toBe('ses_other');
    expect(after.tasks['T-0099']?.sessionId).toBe('ses_worker');
  });

  it('does not resurrect a task deleted during the tick', async () => {
    const { deps, client } = setup();
    const realListMessages = client.listMessages.bind(client);
    client.listMessages = async (sessionId: string, limit: number) => {
      const messages = await realListMessages(sessionId, limit);
      updateState(deps.statePath, (state) => {
        delete state.tasks['T-0099'];
      });
      return messages;
    };

    await tickOnce(deps, { dryRun: false, now: 1000 });

    expect(loadState(deps.statePath).tasks['T-0099']).toBeUndefined();
  });

  it('does not overwrite a task relaunched with a new session during the tick', async () => {
    const { deps, client } = setup();
    const realListMessages = client.listMessages.bind(client);
    client.listMessages = async (sessionId: string, limit: number) => {
      const messages = await realListMessages(sessionId, limit);
      updateState(deps.statePath, (state) => {
        const record = state.tasks['T-0099'];
        if (record !== undefined) {
          record.sessionId = 'ses_relaunched';
        }
      });
      return messages;
    };

    await tickOnce(deps, { dryRun: false, now: 1000 });

    expect(loadState(deps.statePath).tasks['T-0099']?.sessionId).toBe('ses_relaunched');
  });

  it('sends a nudge to the old session', async () => {
    const { deps, client } = setup();
    const session = client.sessions.get('ses_worker');
    if (session === undefined) {
      throw new Error('missing fake session');
    }
    session.messages = [{ id: 'm', type: 'idle', outcome: 'done', time: { created: 1 } }];

    await tickOnce(deps, { dryRun: false, now: 1000 });

    expect(client.created).toEqual([]);
    expect(client.prompted).toHaveLength(1);
    expect(client.prompted[0]?.sessionId).toBe('ses_worker');
    expect(loadState(deps.statePath).tasks['T-0099']?.sessionId).toBe('ses_worker');
    expect(loadState(deps.statePath).tasks['T-0099']?.nudgesSent).toBe(1);
  });

  it('runs an autofix round in a fresh session and keeps the round count', async () => {
    const { deps, client, worktree, dir } = setup('review', headGit);
    fs.mkdirSync(path.join(dir, 'work'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'work', 'T-0099-demo.md'),
      TASK_MD.replace('status: in-progress', 'status: review'),
    );
    fs.writeFileSync(
      path.join(worktree, 'PREREVIEW.md'),
      '# Pre-review\n\nVerdict: changes requested\n\nCounts: must-fix=1, should-fix=1, nit=0\n',
    );
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
    record.nudgesSent = 2;
    saveState(deps.statePath, state);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await tickOnce(deps, { dryRun: false, now: 1000 });

    expect(client.created).toHaveLength(1);
    expect(client.created[0]?.options.directory).toBe(worktree);
    expect(client.created[0]?.options.title).toBe('T-0099 autofix round 1');
    expect(client.created[0]?.options.model).toMatchObject({
      providerID: 'opencode-go',
      id: 'muse-spark-1.3-contributor',
    });
    const freshId = client.created[0]?.sessionId as string;
    expect(client.prompted.some((entry) => entry.sessionId === 'ses_worker')).toBe(false);
    const sent = client.prompted.find((entry) => entry.sessionId === freshId)?.text ?? '';
    expect(sent).toMatch(/fresh session/i);
    expect(sent).toContain('PREREVIEW.md');
    const after = loadState(deps.statePath).tasks['T-0099'];
    expect(after?.sessionId).toBe(freshId);
    expect(after?.autoFixRounds).toBe(1);
    expect(after?.nudgesSent).toBe(0);
    expect(log.mock.calls.some((call) => String(call[0]).startsWith('LEAD: AUTOFIX'))).toBe(true);
  });

  it('starts the doctor once on a new quiet head and records it', async () => {
    const { deps, client, dir } = setup();
    const session = client.sessions.get('ses_worker');
    if (session === undefined) {
      throw new Error('missing fake session');
    }
    session.messages = [{ id: 'm', type: 'text', time: { created: 1 } }];
    // A nested main checkout, so the doctor worktree (its sibling) is
    // isolated per test instead of shared in the tmp parent.
    const mainRoot = path.join(dir, 'zilar-main');
    fs.mkdirSync(mainRoot, { recursive: true });
    const doctorPath = path.join(dir, 'zilar-doctor');
    const head = 'f'.repeat(40);
    const since = 'e'.repeat(40);
    const createdWorktrees: string[] = [];
    const mainGit: GitRunner = {
      run: (cwd, args) => {
        if (cwd === mainRoot && args[0] === 'worktree' && args[1] === 'list') {
          return {
            ok: true,
            stdout: createdWorktrees.map((entry) => `worktree ${entry}\n`).join(''),
          };
        }
        if (cwd === mainRoot && args[0] === 'worktree' && args[1] === 'add') {
          const target = args[3];
          if (typeof target === 'string') {
            fs.mkdirSync(target, { recursive: true });
            createdWorktrees.push(target);
          }
          return { ok: true, stdout: '' };
        }
        if (cwd === doctorPath && args[0] === 'checkout') {
          return { ok: true, stdout: '' };
        }
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return { ok: true, stdout: `${head}\n` };
        }
        if (args[0] === 'show') {
          return { ok: true, stdout: '1000\n' };
        }
        if (args[0] === 'rev-parse' && args[1] === `${head}~30^`) {
          return { ok: true, stdout: `${since}\n` };
        }
        return { ok: false, stdout: '' };
      },
    };
    const doctorDeps: AutopilotDeps = { ...deps, runner: mainGit, repoRoot: mainRoot };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const first = await tickOnce(doctorDeps, { dryRun: false, now: 1_000_000_000 });
    expect(first.errors).toEqual([]);
    expect(client.created).toHaveLength(1);
    expect(client.created[0]?.options.directory).toBe(doctorPath);
    const recorded = loadState(doctorDeps.statePath).doctor;
    expect(recorded?.head).toBe(head);
    expect(recorded?.since).toBe(since);

    // The next tick sees the same head and does not start again.
    const second = await tickOnce(doctorDeps, { dryRun: false, now: 1_001_000_000 });
    expect(client.created).toHaveLength(1);
    expect(second.errors).toEqual([]);
    expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/^LEAD: DOCTOR/));
  });

  it('dry-run prints the doctor start and changes nothing', async () => {
    const { deps, client, dir } = setup();
    const session = client.sessions.get('ses_worker');
    if (session === undefined) {
      throw new Error('missing fake session');
    }
    session.messages = [{ id: 'm', type: 'text', time: { created: 1 } }];
    const mainRoot = path.join(dir, 'zilar-main');
    fs.mkdirSync(mainRoot, { recursive: true });
    const head = 'f'.repeat(40);
    const mainGit: GitRunner = {
      run: (cwd, args) => {
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return { ok: true, stdout: `${head}\n` };
        }
        if (args[0] === 'show') {
          return { ok: true, stdout: '1000\n' };
        }
        if (args[0] === 'rev-parse') {
          return { ok: true, stdout: `${'e'.repeat(40)}\n` };
        }
        void cwd;
        return { ok: false, stdout: '' };
      },
    };
    const doctorDeps: AutopilotDeps = { ...deps, runner: mainGit, repoRoot: mainRoot };
    const before = fs.readFileSync(doctorDeps.statePath, 'utf8');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await tickOnce(doctorDeps, { dryRun: true, now: 1_000_000_000 });

    expect(client.created).toEqual([]);
    expect(log.mock.calls.some((call) => String(call[0]) === 'DRY: would start the doctor')).toBe(
      true,
    );
    expect(fs.readFileSync(doctorDeps.statePath, 'utf8')).toBe(before);
    expect(dir).toBeDefined();
  });

  it('a doctor failure never breaks the task loop', async () => {
    const { deps, client, dir } = setup();
    const session = client.sessions.get('ses_worker');
    if (session === undefined) {
      throw new Error('missing fake session');
    }
    session.messages = [{ id: 'm', type: 'text', time: { created: 1 } }];
    session.permissions = [{ id: 'per_allow', action: 'shell', resources: 'rm -rf dist' }];
    const mainRoot = path.join(dir, 'zilar-main');
    fs.mkdirSync(mainRoot, { recursive: true });
    // Task git works, so the task loop answers the permission; the doctor
    // step sees a main HEAD but its session read throws, which must be
    // contained as an error while the task results stand.
    const head = 'f'.repeat(40);
    const failingDoctor: GitRunner = {
      run: (_cwd, args) => {
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return { ok: true, stdout: `${head}\n` };
        }
        if (args[0] === 'show') {
          return { ok: true, stdout: '1000\n' };
        }
        if (args[0] === 'rev-parse') {
          return { ok: true, stdout: `${'e'.repeat(40)}\n` };
        }
        return { ok: true, stdout: '' };
      },
    };
    const failingDeps: AutopilotDeps = { ...deps, runner: failingDoctor, repoRoot: mainRoot };
    const realListMessages = client.listMessages.bind(client);
    client.listMessages = async (sessionId: string, limit: number) => {
      if (sessionId !== 'ses_worker') {
        throw new Error('opencode is down');
      }
      return realListMessages(sessionId, limit);
    };
    updateState(deps.statePath, (state) => {
      state.doctor = {
        sessionId: 'ses_gone',
        head: 'd'.repeat(40),
        since: 'e'.repeat(40),
        startedAt: 'x',
        reportedForHead: undefined,
        stalledReportedForHead: undefined,
      };
    });

    const tick = await tickOnce(failingDeps, { dryRun: false, now: 1_000_000_000 });

    expect(tick.errors).toEqual([]);
    expect(client.replied).toContainEqual({
      sessionId: 'ses_worker',
      requestId: 'per_allow',
      decision: 'once',
      message: undefined,
    });
    expect(client.created).toHaveLength(1);
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

describe('extractCounts', () => {
  it('reads the Counts line in the requested form', () => {
    expect(extractCounts('Counts: must-fix=1, should-fix=2, nit=3, follow-up=4')).toEqual({
      mustFix: 1,
      shouldFix: 2,
      nit: 3,
      followUp: 4,
    });
  });

  it('treats the fourth number as 0 for older three-number reviews', () => {
    expect(extractCounts('Counts: must-fix=1, should-fix=2, nit=3')).toEqual({
      mustFix: 1,
      shouldFix: 2,
      nit: 3,
      followUp: 0,
    });
  });

  it('tolerates spacing and case', () => {
    expect(
      extractCounts('**counts:** must-fix = 0; should-fix = 0; nits = 4; follow-ups = 1'),
    ).toEqual({
      mustFix: 0,
      shouldFix: 0,
      nit: 4,
      followUp: 1,
    });
  });

  it('is undefined when the line is missing', () => {
    expect(extractCounts('# R\n\nVerdict: ok')).toBeUndefined();
  });
});
