import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildView,
  collectFiles,
  formatContext,
  fullClearOnResize,
  liveStep,
  modelLabel,
  parseChangedFiles,
  parseWatchView,
  sessionSpeed,
  sparkline,
  type ChangedFile,
  type WatchEntry,
  type WatchView,
} from './watch';
import type { GitResult, GitRunner } from './git';
import type { OpenCodeClient } from './client';

function contentPart(type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type, ...extra };
}

function assistant(content: unknown[]): Record<string, unknown> {
  return { type: 'assistant', content };
}

describe('liveStep', () => {
  it('returns null for an empty message list', () => {
    expect(liveStep([])).toBeNull();
  });

  it('returns null for a junk entry', () => {
    expect(liveStep([null, 42, 'oops'])).toBeNull();
  });

  it('returns null when the newest message is idle', () => {
    expect(liveStep([{ type: 'idle' }])).toBeNull();
  });

  it('says "thinking" when the newest part is reasoning', () => {
    expect(liveStep([assistant([contentPart('reasoning', { text: 'hmm' })])])).toBe('thinking');
  });

  it('says "editing <basename>" for an edit tool call', () => {
    expect(
      liveStep([
        assistant([
          contentPart('tool', {
            name: 'edit',
            state: { input: { path: '/repo/apps/mobile/src/lib/foo.ts' } },
          }),
        ]),
      ]),
    ).toBe('editing foo.ts');
  });

  it('says "editing…" for an edit tool call without a path yet', () => {
    expect(
      liveStep([assistant([contentPart('tool', { name: 'edit', state: { input: {} } })])]),
    ).toBe('editing…');
    expect(liveStep([assistant([contentPart('tool', { name: 'edit' })])])).toBe('editing…');
  });

  it('says "reading…" for a read tool call without a path yet', () => {
    expect(
      liveStep([assistant([contentPart('tool', { name: 'read', state: { input: {} } })])]),
    ).toBe('reading…');
  });

  it('says "reading <basename>" for a read tool call', () => {
    expect(
      liveStep([
        assistant([
          contentPart('tool', {
            name: 'read',
            state: { input: { path: '/repo/work/T-0209.md' } },
          }),
        ]),
      ]),
    ).toBe('reading T-0209.md');
  });

  it('says "editing <basename>" for a write tool call', () => {
    expect(
      liveStep([
        assistant([
          contentPart('tool', {
            name: 'write',
            state: { input: { path: '/repo/a/b/c.txt' } },
          }),
        ]),
      ]),
    ).toBe('editing c.txt');
  });

  it('classifies pnpm gate, tests, and git commit in shell commands', () => {
    expect(
      liveStep([
        assistant([
          contentPart('tool', { name: 'shell', state: { input: { command: 'pnpm gate' } } }),
        ]),
      ]),
    ).toBe('running the gate');
    expect(
      liveStep([
        assistant([
          contentPart('tool', { name: 'shell', state: { input: { command: 'pnpm test' } } }),
        ]),
      ]),
    ).toBe('running tests');
    expect(
      liveStep([
        assistant([
          contentPart('tool', { name: 'shell', state: { input: { command: 'git commit -m ok' } } }),
        ]),
      ]),
    ).toBe('committing');
  });

  it('truncates other shell commands to the first 30 characters', () => {
    expect(
      liveStep([
        assistant([
          contentPart('tool', {
            name: 'shell',
            state: { input: { command: 'ls -la /tmp/very/long/path/that/exceeds/the/limit' } },
          }),
        ]),
      ]),
    ).toBe('running ls -la /tmp/very/long/path/tha');
  });

  it('falls back to "using <name>" for unknown tools', () => {
    expect(
      liveStep([assistant([contentPart('tool', { name: 'question', state: { input: {} } })])]),
    ).toBe('using question');
  });

  it('says "writing a reply" when the last part is text', () => {
    expect(liveStep([assistant([contentPart('text', { text: 'hi' })])])).toBe('writing a reply');
  });
});

describe('parseChangedFiles', () => {
  it('handles A, M, D, R, and ?? in one input', () => {
    const nameStatus = [
      'A\tpackages/devtools/src/lead/watch.ts',
      'M\tpackages/devtools/src/lead/cli.ts',
      'D\tpackages/devtools/src/lead/old.ts',
      'R100\tpackages/devtools/src/lead/old-name.ts\tpackages/devtools/src/lead/new-name.ts',
    ].join('\n');
    const porcelain = '?? packages/devtools/src/lead/fresh.ts\n';
    const files = parseChangedFiles(nameStatus, porcelain);
    expect(files).toEqual([
      { path: 'packages/devtools/src/lead/fresh.ts', kind: 'created' },
      { path: 'packages/devtools/src/lead/new-name.ts', kind: 'created' },
      { path: 'packages/devtools/src/lead/watch.ts', kind: 'created' },
      { path: 'packages/devtools/src/lead/cli.ts', kind: 'modified' },
      { path: 'packages/devtools/src/lead/old-name.ts', kind: 'deleted' },
      { path: 'packages/devtools/src/lead/old.ts', kind: 'deleted' },
    ]);
  });

  it('drops paths under work/', () => {
    const porcelain = '?? work/T-9999-foo.md\n';
    expect(parseChangedFiles('', porcelain)).toEqual([]);
  });
});

describe('modelLabel', () => {
  it('strips the provider prefix and appends the variant', () => {
    expect(modelLabel('meta/muse-spark-1.3-contributor', 'low')).toBe(
      'muse-spark-1.3-contributor (low)',
    );
  });

  it('omits the variant when none is given', () => {
    expect(modelLabel('meta/foo', undefined)).toBe('foo');
  });

  it('accepts a bare model id without a provider prefix', () => {
    expect(modelLabel('bar', 'medium')).toBe('bar (medium)');
  });
});

function entry(overrides: Partial<WatchEntry>): WatchEntry {
  return {
    id: 'T-9999',
    title: 'A long title about the work',
    modelLabel: 'muse-spark-1.3-contributor (low)',
    model: 'meta/muse-spark-1.3-contributor',
    effort: 'low',
    totalAge: '42 min',
    autoFixRounds: 0,
    phaseId: 'coding',
    phaseLabel: 'Coding',
    needsLead: false,
    running: true,
    step: 'editing foo.ts',
    files: [],
    speed: null,
    ...overrides,
  };
}

describe('formatContext', () => {
  it('formats thousands as "k"', () => {
    expect(formatContext(158_705)).toBe('158k');
  });
  it('formats millions with one decimal', () => {
    expect(formatContext(1_234_000)).toBe('1.2M');
  });
  it('keeps small integers as integers', () => {
    expect(formatContext(123)).toBe('123');
    expect(formatContext(0)).toBe('0');
  });
});

describe('sparkline', () => {
  it('returns all "▄" when every value is equal', () => {
    expect(sparkline([3, 3, 3, 3])).toBe('▄▄▄▄');
  });
  it('maps the min to ▁ and the max to █', () => {
    expect(sparkline([0, 10])).toBe('▁█');
  });
  it('scales monotonically with five values', () => {
    expect(sparkline([1, 2, 3, 4, 5])).toBe('▁▃▅▆█');
  });
  it('returns an empty string for an empty list', () => {
    expect(sparkline([])).toBe('');
  });
});

describe('sessionSpeed', () => {
  function step(
    created: number,
    completed: number,
    output: number,
    reasoning: number,
    input: number,
    cacheRead: number,
  ): Record<string, unknown> {
    return {
      type: 'assistant',
      time: { created, streamed: completed, completed },
      tokens: {
        input,
        output,
        reasoning,
        cache: { read: cacheRead, write: 0 },
      },
    };
  }

  it('computes the median step speed over four completed assistant steps', () => {
    const messages = [
      step(4_000, 10_000, 100, 0, 158_705, 0), // newest
      step(3_000, 9_000, 100, 0, 120_000, 0),
      step(2_000, 8_000, 100, 0, 100_000, 0),
      step(1_000, 7_000, 100, 0, 80_000, 0), // oldest
    ];
    const speed = sessionSpeed(messages);
    expect(speed).not.toBeNull();
    expect(speed!.tokPerSec).toBeCloseTo(400 / 24, 4);
    expect(speed!.secPerStep).toBeCloseTo(1.0, 4);
    expect(speed!.context).toBe(158_705);
    expect(speed!.spark).toEqual([100 / 6, 100 / 6, 100 / 6, 100 / 6]);
  });

  it('returns null when there are fewer than 2 completed steps', () => {
    expect(sessionSpeed([])).toBeNull();
    expect(
      sessionSpeed([{ type: 'assistant', time: { created: 1, completed: 2 }, tokens: {} }]),
    ).toBeNull();
  });

  it('skips idle messages and steps without completed', () => {
    const messages = [
      { type: 'idle' },
      step(2_000, 3_000, 50, 0, 10, 0),
      step(1_000, 2_000, 50, 0, 10, 0),
      { type: 'assistant', time: { created: 500 }, tokens: {} },
    ];
    const speed = sessionSpeed(messages);
    expect(speed).not.toBeNull();
    expect(speed!.tokPerSec).toBeCloseTo(100 / 2, 4);
    expect(speed!.secPerStep).toBeCloseTo(1.0, 4);
    expect(speed!.context).toBe(10);
  });

  it('skips junk entries without throwing', () => {
    const messages = [
      null,
      42,
      'oops',
      step(2_000, 3_000, 50, 0, 10, 0),
      step(1_000, 2_000, 50, 0, 10, 0),
    ];
    expect(() => sessionSpeed(messages)).not.toThrow();
    const speed = sessionSpeed(messages);
    expect(speed).not.toBeNull();
    expect(speed!.tokPerSec).toBeCloseTo(100 / 2, 4);
  });

  it('shows the median step speed, so one very long step does not drag it down', () => {
    const messages = [
      step(5_000, 6_000, 5, 0, 10, 0), // newest: 1 s of wait for 5 tokens → 5 tok/s
      step(4_000, 4_500, 100, 0, 10, 0), // 200 tok/s
      step(3_000, 3_500, 100, 0, 10, 0),
      step(2_000, 2_500, 100, 0, 10, 0),
      step(1_000, 1_500, 100, 0, 10, 0), // oldest
    ];
    const speed = sessionSpeed(messages);
    expect(speed).not.toBeNull();
    // The old average would be 805 / 5 = 161 tok/s; the median stays at 200.
    expect(speed!.tokPerSec).toBeCloseTo(200, 4);
    expect(speed!.spark).toEqual([200, 200, 200, 200, 5]);
  });
});

function fakeClient(): OpenCodeClient {
  return {
    async createSession() {
      return '';
    },
    promptDetached() {},
    async interrupt() {},
    async tryInterrupt() {
      return { kind: 'ok' };
    },
    async listMessages() {
      return [];
    },
    async listPermissions() {
      return [];
    },
    async replyPermission() {},
    async switchModel() {},
  };
}

function fakeRunner(): GitRunner {
  return {
    run(_cwd: string, _args: string[]): GitResult {
      return { ok: false, stdout: '' };
    },
  };
}

function findRepoRoot(): string {
  let dir = path.resolve(process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, 'work', 'BOARD.md'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('no work/BOARD.md above the cwd');
    }
    dir = parent;
  }
}

describe('buildView', () => {
  it('keeps previous entries and sets refreshFailed when the state JSON is invalid', async () => {
    const root = findRepoRoot();
    const statePath = path.join(os.tmpdir(), `watch-test-state-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(statePath, '{not valid json');
    try {
      const previous: WatchView = {
        clock: '10:00:00',
        refreshFailed: false,
        mergedToday: 2,
        entries: [
          entry({
            id: 'T-KEEP',
            running: false,
            phaseId: 'waiting-lead',
            needsLead: true,
            step: null,
          }),
        ],
      };
      const view = await buildView(
        previous,
        root,
        statePath,
        fakeClient(),
        fakeRunner(),
        new Map(),
        Date.now(),
      );
      expect(view.refreshFailed).toBe(true);
      expect(view.entries.map((e) => e.id)).toEqual(['T-KEEP']);
    } finally {
      fs.rmSync(statePath, { force: true });
    }
  });

  it('fetches a session once per refresh and reuses it for the live step', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-root-'));
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-wt-'));
    const statePath = path.join(root, 'state.json');
    const listed: { sessionId: string; limit: number }[] = [];
    const messages = [
      {
        type: 'assistant',
        time: { created: 1, completed: 2 },
        tokens: { input: 10, output: 10, reasoning: 0, cache: { read: 0 } },
        content: [{ type: 'text', text: 'hi' }],
      },
    ];
    const client: OpenCodeClient = {
      ...fakeClient(),
      async listMessages(sessionId: string, limit: number): Promise<unknown[]> {
        listed.push({ sessionId, limit });
        return messages;
      },
    };
    const gitStdout = (args: string[]): string => {
      if (args[0] === 'rev-parse') {
        return `${'a'.repeat(40)}\n`;
      }
      if (args[0] === 'merge-base') {
        return 'abc123\n';
      }
      if (args[0] === 'log') {
        return '1700000000\n';
      }
      if (args[0] === 'rev-list') {
        return '1\n';
      }
      return '';
    };
    const runner: GitRunner = {
      run(cwd: string, args: string[]): GitResult {
        return cwd === worktree ? { ok: true, stdout: gitStdout(args) } : { ok: false, stdout: '' };
      },
    };
    fs.mkdirSync(path.join(root, 'work'), { recursive: true });
    fs.mkdirSync(path.join(worktree, 'work'), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, 'work', 'T-0001-foo.md'),
      '---\nid: T-0001\ntitle: Test task\nstatus: todo\nbranch: task/T-0001\nmodel: meta/muse-spark-1.3-contributor\n---\n',
    );
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        tasks: {
          'T-0001': {
            task: 'T-0001',
            sessionId: 'ses_worker',
            worktree,
            model: 'meta/muse-spark-1.3-contributor',
            role: 'worker',
            startedAt: new Date(0).toISOString(),
          },
        },
      }),
    );
    try {
      const view = await buildView(
        { clock: '00:00:00', refreshFailed: false, mergedToday: 0, entries: [] },
        root,
        statePath,
        client,
        runner,
        new Map(),
        Date.now(),
      );
      expect(listed).toEqual([{ sessionId: 'ses_worker', limit: 30 }]);
      expect(view.entries.map((e) => e.id)).toEqual(['T-0001']);
      expect(view.entries[0]!.step).toBe('writing a reply');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  });
});

describe('fullClearOnResize', () => {
  it('writes the full-clear sequence then calls clear once', () => {
    const written: string[] = [];
    let clears = 0;
    fullClearOnResize({ write: (s: string) => written.push(s) }, () => {
      clears += 1;
    });
    const esc = String.fromCharCode(27);
    expect(written).toEqual([`${esc}[2J${esc}[H`]);
    expect(clears).toBe(1);
  });
});

describe('collectFiles', () => {
  it('returns the fallback when the merge-base fails', async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-cf-'));
    const fallback: ChangedFile[] = [
      { path: 'packages/devtools/src/lead/watch.ts', kind: 'created' },
    ];
    const runner: GitRunner = {
      run(_cwd, _args): GitResult {
        return { ok: false, stdout: '' };
      },
    };
    try {
      const files = await collectFiles(runner, worktree, fallback);
      expect(files).toBe(fallback);
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  });

  it('returns the fallback when diff --name-status fails', async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-cf-'));
    const fallback: ChangedFile[] = [
      { path: 'packages/devtools/src/lead/watch.ts', kind: 'modified' },
    ];
    const runner: GitRunner = {
      run(_cwd, args: string[]): GitResult {
        if (args[0] === 'merge-base') {
          return { ok: true, stdout: 'abc123\n' };
        }
        return { ok: false, stdout: '' };
      },
    };
    try {
      const files = await collectFiles(runner, worktree, fallback);
      expect(files).toBe(fallback);
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  });

  it('keeps untracked files when merge-base and diff succeed', async () => {
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-cf-'));
    const fallback: ChangedFile[] = [];
    const runner: GitRunner = {
      run(_cwd, args: string[]): GitResult {
        if (args[0] === 'merge-base') {
          return { ok: true, stdout: 'abc123\n' };
        }
        if (args[0] === 'diff') {
          return { ok: true, stdout: 'M\tpackages/devtools/src/lead/cli.ts\n' };
        }
        if (args[0] === 'status') {
          return { ok: true, stdout: '?? packages/devtools/src/lead/fresh.ts\n' };
        }
        return { ok: false, stdout: '' };
      },
    };
    try {
      const files = await collectFiles(runner, worktree, fallback);
      expect(files).toEqual([
        { path: 'packages/devtools/src/lead/fresh.ts', kind: 'created' },
        { path: 'packages/devtools/src/lead/cli.ts', kind: 'modified' },
      ]);
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  });
});

describe('parseWatchView', () => {
  function view(entries: WatchEntry[]): WatchView {
    return { clock: '10:42:07', refreshFailed: false, mergedToday: 1, entries };
  }

  it('round-trips a valid view', () => {
    const original = view([
      entry({
        files: [
          { path: 'packages/devtools/src/lead/watch.ts', kind: 'created' },
          { path: 'packages/devtools/src/lead/cli.ts', kind: 'modified' },
        ],
        step: 'editing watch.ts',
      }),
    ]);
    const line = JSON.stringify(original);
    const parsed = parseWatchView(line);
    expect(parsed).toEqual(original);
  });

  it('returns null when the line is not JSON', () => {
    expect(parseWatchView('not json at all')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseWatchView('')).toBeNull();
  });

  it('returns null when a field has the wrong type', () => {
    const bad = JSON.stringify({ clock: 42, refreshFailed: false, entries: [] });
    expect(parseWatchView(bad)).toBeNull();
  });

  it('returns null when an entry is missing fields', () => {
    const bad = JSON.stringify({
      clock: '10:00:00',
      refreshFailed: false,
      entries: [{ id: 'T-1' }],
    });
    expect(parseWatchView(bad)).toBeNull();
  });

  it('returns null when the file kind is not in the enum', () => {
    const bad = JSON.stringify({
      clock: '10:00:00',
      refreshFailed: false,
      mergedToday: 0,
      entries: [
        {
          id: 'T-1',
          title: 't',
          modelLabel: 'm',
          model: 'meta/m',
          totalAge: '1m',
          autoFixRounds: 0,
          phaseId: 'coding',
          phaseLabel: 'Coding',
          needsLead: false,
          running: true,
          step: null,
          files: [{ path: 'a.ts', kind: 'renamed' }],
        },
      ],
    });
    expect(parseWatchView(bad)).toBeNull();
  });

  it('parses speed back with the same numbers', () => {
    const original = view([
      entry({
        speed: {
          tokPerSec: 18.2,
          secPerStep: 9.6,
          context: 158_705,
          spark: [1, 2, 3, 4, 5, 4, 3, 2, 1],
        },
      }),
    ]);
    const line = JSON.stringify(original);
    const parsed = parseWatchView(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.entries[0]!.speed).toEqual(original.entries[0]!.speed);
  });

  it('parses speed as null when the speed field is missing', () => {
    const bad = JSON.stringify({
      clock: '10:00:00',
      refreshFailed: false,
      mergedToday: 0,
      entries: [
        {
          id: 'T-1',
          title: 't',
          modelLabel: 'm',
          model: 'meta/m',
          totalAge: '1m',
          autoFixRounds: 0,
          phaseId: 'coding',
          phaseLabel: 'Coding',
          needsLead: false,
          running: true,
          step: null,
          files: [],
        },
      ],
    });
    const parsed = parseWatchView(bad);
    expect(parsed).not.toBeNull();
    expect(parsed!.entries[0]!.speed).toBeNull();
  });
});
