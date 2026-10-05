import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildView,
  collectFiles,
  disableRawMode,
  formatContext,
  frameText,
  liveStep,
  modelLabel,
  parseChangedFiles,
  parseWatchView,
  renderWatch,
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
    totalAge: '42 min',
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

function view(entries: WatchEntry[]): WatchView {
  return { clock: '10:42:07', refreshFailed: false, entries };
}

describe('renderWatch', () => {
  it('shows "No tasks in flight." when there are no entries', () => {
    const lines = renderWatch(view([]), 60, 0, false);
    expect(lines.some((line) => line.includes('No tasks in flight.'))).toBe(true);
  });

  it('limits the file list to 6 and adds "+N more"', () => {
    const files = Array.from({ length: 8 }, (_, i) => ({
      path: `packages/devtools/src/lead/file-${i}.ts`,
      kind: 'modified' as const,
    }));
    const lines = renderWatch(
      view([entry({ running: true, step: 'editing file-0.ts', files })]),
      60,
      0,
      false,
    );
    expect(lines.some((line) => line.includes('+2 more'))).toBe(true);
    expect(lines.some((line) => line.includes('file-5.ts'))).toBe(true);
    expect(lines.every((line) => !line.includes('file-6.ts'))).toBe(true);
  });

  it('shows the steady dot for tasks that are not running', () => {
    const lines = renderWatch(
      view([
        entry({
          id: 'T-0202',
          running: false,
          phaseId: 'waiting-lead',
          phaseLabel: 'Packet ready, waiting for the lead',
          step: null,
        }),
      ]),
      60,
      0,
      false,
    );
    expect(lines.some((line) => line.includes('●'))).toBe(true);
    expect(lines.some((line) => line.includes('Packet ready'))).toBe(true);
  });

  it('changes the spinner character with the frame number', () => {
    const filesAt0 = renderWatch(view([entry({})]), 60, 0, false).join('\n');
    const filesAt2 = renderWatch(view([entry({})]), 60, 2, false).join('\n');
    expect(filesAt0).not.toBe(filesAt2);
  });

  it('never lets a line exceed the width (60 columns)', () => {
    const files = Array.from({ length: 8 }, (_, i) => ({
      path: `apps/mobile/src/components/long-basename-${i}.tsx`,
      kind: 'modified' as const,
    }));
    const lines = renderWatch(
      view([
        entry({
          id: 'T-1234',
          title: 'A title that should not break the line budget at all',
          files,
        }),
      ]),
      60,
      0,
      false,
    );
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });

  it('never lets a line exceed the width (100 columns)', () => {
    const files = Array.from({ length: 8 }, (_, i) => ({
      path: `apps/mobile/src/components/long-basename-${i}.tsx`,
      kind: 'modified' as const,
    }));
    const lines = renderWatch(
      view([
        entry({
          id: 'T-1234',
          title: 'A title that should not break the line budget at all',
          files,
        }),
      ]),
      100,
      0,
      false,
    );
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(100);
    }
  });

  it('puts the clock on the right and the title on the left of the header', () => {
    const lines = renderWatch(view([]), 60, 0, false);
    const header = lines[0] ?? '';
    expect(header.startsWith('zilar lead watch')).toBe(true);
    expect(header.trimEnd().endsWith('10:42:07')).toBe(true);
  });

  it('counts blocked and idle tasks in "waiting for you" (not only waiting-lead)', () => {
    const lines = renderWatch(
      view([
        entry({
          id: 'T-A',
          running: false,
          phaseId: 'blocked',
          phaseLabel: 'Blocked, needs a decision',
          needsLead: true,
          step: null,
        }),
        entry({
          id: 'T-B',
          running: false,
          phaseId: 'idle',
          phaseLabel: 'Idle, not in review (stalled?)',
          needsLead: true,
          step: null,
        }),
        entry({
          id: 'T-C',
          running: true,
          phaseId: 'coding',
          phaseLabel: 'Coding',
          needsLead: false,
        }),
      ]),
      60,
      0,
      false,
    );
    const counts = lines.find((line) => line.includes('running')) ?? '';
    expect(counts.trimEnd()).toBe('1 running · 2 waiting for you');
  });

  it('clips the meta line and file rows when basenames are longer than the width', () => {
    const lines = renderWatch(
      view([
        entry({
          id: 'T-1234',
          modelLabel: 'a-very-long-model-label-that-easily-exceeds-any-small-terminal',
          totalAge: '99 min',
          files: [
            {
              path: 'apps/mobile/src/components/an-unreasonably-long-basename.tsx',
              kind: 'modified',
            },
          ],
        }),
      ]),
      60,
      0,
      false,
    );
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });

  it('shows the speed line at width 80', () => {
    const lines = renderWatch(
      view([
        entry({
          speed: {
            tokPerSec: 18.234,
            secPerStep: 9.612,
            context: 158_705,
            spark: [1, 2, 3, 4, 5, 4, 3, 2, 1],
          },
        }),
      ]),
      80,
      0,
      false,
    );
    const joined = lines.join('\n');
    expect(joined).toContain('18.2 tok/s');
    expect(joined).toContain('9.6 s/step');
    expect(joined).toContain('ctx 158k');
    expect(joined).toContain('▁▃▅▆█▆▅▃▁');
  });

  it('drops the sparkline at width 50', () => {
    const lines = renderWatch(
      view([
        entry({
          speed: {
            tokPerSec: 18.234,
            secPerStep: 9.612,
            context: 158_705,
            spark: [1, 2, 3, 4, 5, 4, 3, 2, 1],
          },
        }),
      ]),
      50,
      0,
      false,
    );
    const speedLine = lines.find((line) => line.includes('tok/s')) ?? '';
    expect(speedLine).not.toContain('▁');
    expect(speedLine).not.toContain('█');
    expect(speedLine.length).toBeLessThanOrEqual(50);
  });

  it('shows "measuring…" when speed is null', () => {
    const lines = renderWatch(view([entry({ speed: null })]), 80, 0, false);
    const measuring = lines.find((line) => line.includes('measuring')) ?? '';
    expect(measuring).toContain('measuring…');
  });
});

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

  it('computes averages over four completed assistant steps', () => {
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
});

describe('disableRawMode', () => {
  function fakeStdin() {
    const calls: number[] = [];
    return {
      isTTY: true,
      setRawMode(value: boolean) {
        calls.push(value ? 1 : -1);
        return this;
      },
      calls,
    };
  }

  it('clears raw mode when the ref says it is on', () => {
    const stdin = fakeStdin();
    const ref = { raw: true };
    disableRawMode(stdin as unknown as NodeJS.ReadStream, ref);
    expect(ref.raw).toBe(false);
  });

  it('is a no-op when raw mode was never enabled', () => {
    const stdin = fakeStdin();
    const ref = { raw: false };
    disableRawMode(stdin as unknown as NodeJS.ReadStream, ref);
    expect(ref.raw).toBe(false);
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

describe('frameText', () => {
  const HOME = '\u001b[H';
  const CLEAR_LINE = '\u001b[K';
  const CLEAR_BELOW = '\u001b[J';
  const CLEAR_SCREEN = '\u001b[2J';

  it('contains no whole-screen clear, ends with clear-to-end-of-screen', () => {
    const out = frameText(['one', 'two', 'three']);
    expect(out.includes(CLEAR_SCREEN)).toBe(false);
    expect(out.endsWith(CLEAR_BELOW)).toBe(true);
  });

  it('starts with cursor home, puts clear-to-end-of-line after every line', () => {
    const out = frameText(['one', 'two']);
    expect(out.startsWith(HOME)).toBe(true);
    expect(out).toBe(`${HOME}one${CLEAR_LINE}\ntwo${CLEAR_LINE}\n${CLEAR_BELOW}`);
  });

  it('handles an empty line list without crashing', () => {
    const out = frameText([]);
    expect(out).toBe(`${HOME}${CLEAR_BELOW}`);
    expect(out.includes(CLEAR_SCREEN)).toBe(false);
  });
});

describe('parseWatchView', () => {
  function view(entries: WatchEntry[]): WatchView {
    return { clock: '10:42:07', refreshFailed: false, entries };
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
      entries: [
        {
          id: 'T-1',
          title: 't',
          modelLabel: 'm',
          totalAge: '1m',
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
      entries: [
        {
          id: 'T-1',
          title: 't',
          modelLabel: 'm',
          totalAge: '1m',
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
