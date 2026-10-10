import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BatchError,
  ownerOf,
  parseLintErrors,
  parsePrettierFiles,
  parseTypecheckErrors,
  parseVitestFailures,
  runBatchCheck,
  runBatchMerge,
  testArgsOf,
  type BatchDeps,
  type BatchMergeDeps,
  type BatchPackage,
  type CommandResult,
} from './batch';
import type { GitResult, GitRunner } from './git';
import type { MergeOptions } from './merge';

const ROOT = '/work/repo';
const WAVE = '/work/zilar-wave';
const WAVE_ROOT = '/home/lead/wave';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const WAVE_SHA = 'd'.repeat(40);

interface GitCall {
  cwd: string;
  args: string[];
}

class FakeGit implements GitRunner {
  calls: GitCall[] = [];
  constructor(private readonly respond: (call: GitCall) => GitResult | undefined) {}
  run(cwd: string, args: string[]): GitResult {
    const call = { cwd, args };
    this.calls.push(call);
    return this.respond(call) ?? { ok: true, stdout: '' };
  }
  count(...prefix: string[]): number {
    return this.calls.filter((call) => prefix.every((part, i) => call.args[i] === part)).length;
  }
}

function taskFile(id: string, branch: string, allowed: string[]): string {
  return [
    '---',
    `id: ${id}`,
    'status: review',
    `branch: ${branch}`,
    '---',
    '',
    `# ${id}`,
    '',
    '### Allowed files',
    allowed.map((file) => `\`${file}\``).join(', '),
    '',
    '### Checks',
    '',
  ].join('\n');
}

const PACKAGES: BatchPackage[] = [
  { name: '@zilar/web', dir: 'apps/web', testArgs: [] },
  { name: '@zilar/server', dir: 'apps/server', testArgs: ['--testTimeout=30000'] },
  { name: '@zilar/ui-kit', dir: 'packages/ui-kit', testArgs: undefined },
];

interface Task {
  id: string;
  branch: string;
  head: string;
  /** Files in `git diff --name-only main...<branch>`. */
  diff: string[];
  allowed: string[];
  conflict?: string[];
}

interface World {
  deps: BatchDeps;
  git: FakeGit;
  files: Map<string, string>;
  commands: { cwd: string; command: string; args: string[] }[];
  inFlight: { now: number; max: number };
}

interface Script {
  typecheck?: CommandResult;
  install?: CommandResult;
  lint?: CommandResult;
  format?: CommandResult;
  /** Vitest JSON report text (or undefined: no file) and exit status per package name. */
  tests?: Record<string, { status: number; json?: string }>;
}

function world(tasks: Task[], script: Script = {}): World {
  const files = new Map<string, string>();
  for (const task of tasks) {
    files.set(
      `/work/zilar-${task.id}/work/${task.id}-demo.md`,
      taskFile(task.id, task.branch, task.allowed),
    );
  }
  const byBranch = new Map(tasks.map((task) => [task.branch, task]));
  const git = new FakeGit(({ cwd, args }) => {
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
      return { ok: true, stdout: `${WAVE_SHA}\n` };
    }
    if (args[0] === 'rev-parse') {
      const task = byBranch.get(args[1] ?? '');
      return task === undefined
        ? { ok: false, stdout: '' }
        : { ok: true, stdout: `${task.head}\n` };
    }
    if (args[0] === 'merge' && args[1] === '--no-ff') {
      const task = byBranch.get(args[3] ?? '');
      return { ok: task?.conflict === undefined, stdout: 'CONFLICT (content)\n' };
    }
    if (args[0] === 'diff' && args[1] === '--name-only' && args[2] === '--diff-filter=U') {
      const merging = [...git.calls]
        .reverse()
        .find((call) => call.args[0] === 'merge' && call.args[1] === '--no-ff');
      const task = byBranch.get(merging?.args[3] ?? '');
      return { ok: true, stdout: (task?.conflict ?? []).join('\n') };
    }
    if (args[0] === 'diff' && args[1] === '--name-only') {
      const branch = (args[2] ?? '').replace('main...', '');
      return { ok: true, stdout: (byBranch.get(branch)?.diff ?? []).join('\n') };
    }
    void cwd;
    return undefined;
  });
  const commands: World['commands'] = [];
  const inFlight = { now: 0, max: 0 };
  const deps: BatchDeps = {
    root: ROOT,
    git,
    runCommand: async (cwd, command, args) => {
      commands.push({ cwd, command, args });
      const joined = args.join(' ');
      if (joined.startsWith('install')) {
        return script.install ?? { status: 0, output: '' };
      }
      if (joined.includes('turbo run typecheck')) {
        return script.typecheck ?? { status: 0, output: '' };
      }
      if (joined.includes('oxlint')) {
        return script.lint ?? { status: 0, output: '' };
      }
      if (joined.includes('prettier')) {
        return script.format ?? { status: 0, output: '' };
      }
      const pkg = args[1] ?? '';
      const test = script.tests?.[pkg];
      inFlight.now += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.now);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight.now -= 1;
      const outputFile = args.find((arg) => arg.startsWith('--outputFile='));
      if (test?.json !== undefined && outputFile !== undefined) {
        files.set(outputFile.slice('--outputFile='.length), test.json);
      }
      return { status: test?.status ?? 0, output: 'vitest output' };
    },
    readText: (file) => {
      const text = files.get(file);
      if (text === undefined) {
        throw new Error(`no such file ${file}`);
      }
      return text;
    },
    writeText: (file, text) => {
      files.set(file, text);
    },
    makeDir: () => undefined,
    exists: (file) => files.has(file),
    listDir: (dir) =>
      [...files.keys()]
        .filter((file) => path.dirname(file) === dir)
        .map((file) => path.basename(file)),
    listPackages: () => PACKAGES,
    treeKey: () => 'tree-key-1',
    now: () => new Date('2026-10-09T12:30:45.123Z'),
    waveRoot: WAVE_ROOT,
    print: () => undefined,
  };
  return { deps, git, files, commands, inFlight };
}

function vitestJson(entries: { file: string; failed: { name: string; message: string }[] }[]) {
  return JSON.stringify({
    testResults: entries.map((entry) => ({
      name: `${WAVE}/${entry.file}`,
      status: entry.failed.length > 0 ? 'failed' : 'passed',
      message: '',
      assertionResults: [
        { fullName: 'a passing test', status: 'passed', failureMessages: [] },
        ...entry.failed.map((failed) => ({
          fullName: failed.name,
          status: 'failed',
          failureMessages: [failed.message],
        })),
      ],
    })),
  });
}

const TASK_A: Task = {
  id: 'T-0001',
  branch: 'task/T-0001-a',
  head: SHA_A,
  diff: ['apps/web/src/chat.tsx', 'apps/web/src/chat.test.tsx'],
  allowed: ['apps/web/src/chat.tsx', 'apps/web/src/chat.test.tsx'],
};
const TASK_B: Task = {
  id: 'T-0002',
  branch: 'task/T-0002-b',
  head: SHA_B,
  diff: ['apps/server/src/rooms.ts'],
  allowed: ['apps/server/src/rooms.ts'],
};
const TASK_C: Task = {
  id: 'T-0003',
  branch: 'task/T-0003-c',
  head: SHA_C,
  diff: ['packages/protocol/src/ids.ts'],
  allowed: ['packages/protocol/src/ids.ts'],
};

describe('runBatchCheck', () => {
  it('passes a clean wave and records it in last.json', async () => {
    const w = world([TASK_A, TASK_B]);
    const result = await runBatchCheck(w.deps, ['T-0001', 'T-0002']);
    expect(result.ok).toBe(true);
    expect(result.lines).toContain('T-0001 ok');
    expect(result.lines).toContain('T-0002 ok');
    const last = JSON.parse(w.files.get(`${WAVE_ROOT}/last.json`) ?? '{}');
    expect(last).toMatchObject({
      tasks: ['T-0001', 'T-0002'],
      wave: WAVE_SHA,
      treeKey: 'tree-key-1',
      ok: true,
      heads: {
        'T-0001': { branch: 'task/T-0001-a', head: SHA_A },
        'T-0002': { branch: 'task/T-0002-b', head: SHA_B },
      },
    });
    expect(result.waveDir).toBe(`${WAVE_ROOT}/20261009T123045Z`);
    expect(result.reportPath).toBe(`${WAVE_ROOT}/20261009T123045Z/report.md`);
    expect([...w.files.keys()].some((file) => file.endsWith('.fix.md'))).toBe(false);
  });

  it('recreates the wave worktree from main and combines the branches in order', async () => {
    const w = world([TASK_A, TASK_B]);
    await runBatchCheck(w.deps, ['T-0001', 'T-0002']);
    const calls = w.git.calls.map((call) => `${call.cwd} ${call.args.join(' ')}`);
    const remove = calls.indexOf(`${ROOT} worktree remove --force ${WAVE}`);
    const drop = calls.indexOf(`${ROOT} branch -D wave`);
    const add = calls.indexOf(`${ROOT} worktree add -b wave ${WAVE} main`);
    expect(remove).toBeGreaterThanOrEqual(0);
    expect(drop).toBeGreaterThan(remove);
    expect(add).toBeGreaterThan(drop);
    const merges = calls.filter((call) => call.includes('merge --no-ff --no-edit'));
    expect(merges).toEqual([
      `${WAVE} merge --no-ff --no-edit task/T-0001-a`,
      `${WAVE} merge --no-ff --no-edit task/T-0002-b`,
    ]);
  });

  it('runs install, typecheck and every package with tests, two at a time at most', async () => {
    const w = world([TASK_A]);
    await runBatchCheck(w.deps, ['T-0001']);
    const lines = w.commands.map((cmd) => `${cmd.cwd} ${cmd.command} ${cmd.args.join(' ')}`);
    expect(lines[0]).toBe(`${WAVE} pnpm install --frozen-lockfile`);
    expect(lines[1]).toContain('exec turbo run typecheck --continue');
    const tests = w.commands.filter((cmd) => cmd.args.includes('vitest'));
    expect(tests).toHaveLength(2);
    const server = tests.find((cmd) => cmd.args.includes('@zilar/server'));
    expect(server?.args).toContain('--testTimeout=30000');
    expect(server?.args).toContain('--reporter=json');
    expect(
      server?.args.some(
        (arg) => arg === `--outputFile=${WAVE_ROOT}/20261009T123045Z/_zilar_server.json`,
      ),
    ).toBe(true);
    expect(w.inFlight.max).toBeLessThanOrEqual(2);
  });

  it('gives a failing test to the task that owns its file and nothing to the other', async () => {
    const w = world([TASK_A, TASK_B], {
      tests: {
        '@zilar/web': {
          status: 1,
          json: vitestJson([
            {
              file: 'apps/web/src/chat.test.tsx',
              failed: [{ name: 'Chat > shows the title', message: 'expected 1 to be 2\nat x' }],
            },
          ]),
        },
      },
    });
    const result = await runBatchCheck(w.deps, ['T-0001', 'T-0002']);
    expect(result.ok).toBe(false);
    const fix = w.files.get(`${result.waveDir}/T-0001.fix.md`) ?? '';
    expect(fix).toContain('1. Failing test in apps/web/src/chat.test.tsx: Chat > shows the title');
    expect(fix).toContain('expected 1 to be 2');
    expect(w.files.has(`${result.waveDir}/T-0002.fix.md`)).toBe(false);
    expect(result.lines).toContain('T-0001 FAIL typecheck 0, tests 1, out of scope 0');
    expect(result.lines).toContain('T-0002 ok');
    const report = w.files.get(result.reportPath) ?? '';
    expect(report).toContain('| T-0001 | merged | - | 0 | 1 |');
    expect(report).toContain('| T-0002 | merged | - | 0 | 0 |');
  });

  it('reports a conflict, aborts that merge and still combines the next task', async () => {
    const w = world([TASK_A, { ...TASK_B, conflict: ['apps/web/src/chat.tsx'] }, TASK_C]);
    const result = await runBatchCheck(w.deps, ['T-0001', 'T-0002', 'T-0003']);
    expect(result.ok).toBe(false);
    expect(result.lines).toContain('T-0002 CONFLICT apps/web/src/chat.tsx');
    expect(w.git.count('merge', '--abort')).toBe(1);
    const merges = w.git.calls.filter(
      (call) => call.args[0] === 'merge' && call.args[1] === '--no-ff',
    );
    expect(merges.map((call) => call.args[3])).toEqual([
      'task/T-0001-a',
      'task/T-0002-b',
      'task/T-0003-c',
    ]);
    expect(result.lines).toContain('T-0003 ok');
    const fix = w.files.get(`${result.waveDir}/T-0002.fix.md`) ?? '';
    expect(fix).toContain('Merge conflict');
    expect(fix).toContain('apps/web/src/chat.tsx');
  });

  it('gives a typecheck error to the task that owns the file', async () => {
    const w = world([TASK_A, TASK_B], {
      typecheck: {
        status: 2,
        output: [
          '@zilar/server:typecheck: src/rooms.ts(12,7): error TS2322: Type string is not assignable to type number.',
          '@zilar/server:typecheck:   The expected type comes from property id.',
          '@zilar/web:typecheck: ok',
        ].join('\n'),
      },
    });
    const result = await runBatchCheck(w.deps, ['T-0001', 'T-0002']);
    const fix = w.files.get(`${result.waveDir}/T-0002.fix.md`) ?? '';
    expect(fix).toContain('1. Typecheck error TS2322 at apps/server/src/rooms.ts:12:7');
    expect(fix).toContain('The expected type comes from property id.');
    expect(w.files.has(`${result.waveDir}/T-0001.fix.md`)).toBe(false);
    expect(result.lines).toContain('T-0002 FAIL typecheck 1, tests 0, out of scope 0');
  });

  it('gives a lint error to the task that owns the file and fails that task', async () => {
    const w = world([TASK_A, TASK_B], {
      lint: {
        status: 1,
        output: [
          `${WAVE}/apps/web/src/chat.tsx:4:9: Variable 'x' is declared but never used. [Error/eslint(no-unused-vars)]`,
          '',
          'Found 1 problem',
        ].join('\n'),
      },
    });
    const result = await runBatchCheck(w.deps, ['T-0001', 'T-0002']);
    expect(result.ok).toBe(false);
    const fix = w.files.get(`${result.waveDir}/T-0001.fix.md`) ?? '';
    expect(fix).toContain('1. Lint error eslint(no-unused-vars) in apps/web/src/chat.tsx');
    expect(fix).toContain("4:9 Variable 'x' is declared but never used.");
    expect(w.files.has(`${result.waveDir}/T-0002.fix.md`)).toBe(false);
    expect(result.lines).toContain('T-0001 FAIL typecheck 0, tests 0, lint 1, out of scope 0');
    expect(result.lines).toContain('T-0002 ok');
    const report = w.files.get(result.reportPath) ?? '';
    expect(report).toContain('| T-0001 | merged | - | 0 | 0 | 1 |');
    expect(report).toContain('| T-0002 | merged | - | 0 | 0 | 0 |');
  });

  it('gives an unformatted file to the task whose diff holds it and fails that task', async () => {
    const w = world([TASK_A, TASK_B], {
      format: {
        status: 1,
        output: [
          'Checking formatting...',
          '[warn] apps/web/src/chat.tsx',
          '[warn] Code style issues found in the above file. Run Prettier with --write to fix.',
        ].join('\n'),
      },
    });
    const result = await runBatchCheck(w.deps, ['T-0001', 'T-0002']);
    expect(result.ok).toBe(false);
    const fix = w.files.get(`${result.waveDir}/T-0001.fix.md`) ?? '';
    expect(fix).toContain('1. Prettier: apps/web/src/chat.tsx is not formatted');
    expect(fix).toContain('pnpm exec prettier --write apps/web/src/chat.tsx');
    expect(w.files.has(`${result.waveDir}/T-0002.fix.md`)).toBe(false);
    expect(result.lines).toContain('T-0001 FAIL typecheck 0, tests 0, format 1, out of scope 0');
    expect(result.lines).toContain('T-0002 ok');
  });

  it('lists an unformatted file no task owns in the unowned section and fails the wave', async () => {
    const w = world([TASK_A, TASK_B], {
      format: {
        status: 1,
        output:
          '[warn] packages/devtools/src/gate/gate.test.ts\n[warn] Code style issues found in the above file.',
      },
    });
    const result = await runBatchCheck(w.deps, ['T-0001', 'T-0002']);
    expect(result.ok).toBe(false);
    expect(result.lines).toContain('unowned: 1 failure(s), see the report');
    const report = w.files.get(result.reportPath) ?? '';
    const unowned = report.slice(report.indexOf('## unowned'));
    expect(unowned).toContain('Prettier: packages/devtools/src/gate/gate.test.ts is not formatted');
    expect([...w.files.keys()].some((file) => file.endsWith('.fix.md'))).toBe(false);
  });

  it('reports a failing prettier run with no readable file as an unowned check failure', async () => {
    const w = world([TASK_A], { format: { status: 2, output: '[error] SyntaxError' } });
    const result = await runBatchCheck(w.deps, ['T-0001']);
    expect(result.ok).toBe(false);
    const report = w.files.get(result.reportPath) ?? '';
    expect(report).toContain('Check failed: format (no file could be read)');
    expect(report).toContain('[error] SyntaxError');
  });

  it('reports a failing lint run with no readable error as an unowned check failure', async () => {
    const w = world([TASK_A], { lint: { status: 2, output: 'oxlint: failed to read config' } });
    const result = await runBatchCheck(w.deps, ['T-0001']);
    expect(result.ok).toBe(false);
    expect(result.lines).toContain('unowned: 1 failure(s), see the report');
    const report = w.files.get(result.reportPath) ?? '';
    expect(report).toContain('Check failed: lint (no error could be read)');
    expect(report).toContain('oxlint: failed to read config');
  });

  it('lists a failure no task owns in the unowned section and fails the wave', async () => {
    const w = world([TASK_A, TASK_B], {
      tests: {
        '@zilar/server': {
          status: 1,
          json: vitestJson([
            {
              file: 'apps/server/src/other.test.ts',
              failed: [{ name: 'other > breaks', message: 'boom' }],
            },
          ]),
        },
      },
    });
    const result = await runBatchCheck(w.deps, ['T-0001', 'T-0002']);
    expect(result.ok).toBe(false);
    const report = w.files.get(result.reportPath) ?? '';
    const unowned = report.slice(report.indexOf('## unowned'));
    expect(unowned).toContain('apps/server/src/other.test.ts: other > breaks');
    expect([...w.files.keys()].some((file) => file.endsWith('.fix.md'))).toBe(false);
    const last = JSON.parse(w.files.get(`${WAVE_ROOT}/last.json`) ?? '{}');
    expect(last.ok).toBe(false);
  });

  it('records files outside the Allowed list and fails the wave', async () => {
    const w = world([{ ...TASK_B, diff: ['apps/server/src/rooms.ts', 'apps/web/src/sneaky.ts'] }]);
    const result = await runBatchCheck(w.deps, ['T-0002']);
    expect(result.ok).toBe(false);
    const report = w.files.get(result.reportPath) ?? '';
    expect(report).toContain('| T-0002 | merged | apps/web/src/sneaky.ts | 0 | 0 |');
    const fix = w.files.get(`${result.waveDir}/T-0002.fix.md`) ?? '';
    expect(fix).toContain('Out of scope: `apps/web/src/sneaky.ts`');
  });

  it('keeps going after a failed install and reports it as unowned', async () => {
    const w = world([TASK_A], { install: { status: 1, output: 'ERR_PNPM_OUTDATED_LOCKFILE' } });
    const result = await runBatchCheck(w.deps, ['T-0001']);
    expect(result.ok).toBe(false);
    expect(w.commands.length).toBeGreaterThan(2);
    const report = w.files.get(result.reportPath) ?? '';
    expect(report).toContain('pnpm install --frozen-lockfile');
    expect(report).toContain('ERR_PNPM_OUTDATED_LOCKFILE');
  });

  it('refuses a task without a worktree before touching git', async () => {
    const w = world([TASK_A]);
    await expect(runBatchCheck(w.deps, ['T-0001', 'T-0009'])).rejects.toThrow(/T-0009/);
    expect(w.git.calls).toHaveLength(0);
  });
});

describe('ownership and parsing', () => {
  const owned = [
    { task: 'T-1', files: ['apps/web/src/chat.tsx'] },
    { task: 'T-2', files: ['apps/web/src/list.ts', 'apps/web/src/shared.ts'] },
  ];

  it('owns a file in a task diff and a test next to a changed source of the same name', () => {
    expect(ownerOf('apps/web/src/list.ts', owned)).toBe('T-2');
    expect(ownerOf('apps/web/src/chat.test.tsx', owned)).toBe('T-1');
    expect(ownerOf('apps/web/src/chat.effect.test.tsx', owned)).toBe('T-1');
  });

  it('leaves other files, other folders and non-test siblings unowned', () => {
    expect(ownerOf('apps/web/src/other.test.tsx', owned)).toBeUndefined();
    expect(ownerOf('apps/mobile/src/chat.test.tsx', owned)).toBeUndefined();
    expect(ownerOf('apps/web/src/chat.ts', owned)).toBeUndefined();
  });

  it('reads both TS error forms and makes the path repo-relative', () => {
    const errors = parseTypecheckErrors(
      [
        '@zilar/web:typecheck: src/a.ts(1,2): error TS1111: first',
        '@zilar/web:typecheck: ../../packages/x/src/b.ts:3:4 - error TS2222: second',
        'packages/y/c.ts(5,6): error TS3333: plain',
      ].join('\n'),
      PACKAGES,
    );
    expect(errors.map((error) => error.file)).toEqual([
      'apps/web/src/a.ts',
      'packages/x/src/b.ts',
      'packages/y/c.ts',
    ]);
    expect(errors[1]?.name).toBe('TS2222 at packages/x/src/b.ts:3:4');
  });

  it('reads failed tests, keeps 30 message lines and flags a file that failed to run', () => {
    const long = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    const failures = parseVitestFailures(
      JSON.stringify({
        testResults: [
          {
            name: `${WAVE}/apps/web/src/a.test.ts`,
            status: 'failed',
            assertionResults: [{ fullName: 'a > b', status: 'failed', failureMessages: [long] }],
          },
          { name: `${WAVE}/apps/web/src/c.test.ts`, status: 'failed', message: 'import failed' },
        ],
      }),
      WAVE,
    );
    expect(failures).toHaveLength(2);
    expect(failures?.[0]?.message.split('\n')).toHaveLength(30);
    expect(failures?.[1]).toMatchObject({
      file: 'apps/web/src/c.test.ts',
      name: '(the file failed to run)',
      message: 'import failed',
    });
    expect(parseVitestFailures('not json', WAVE)).toBeUndefined();
  });

  it('reads unix lint errors, skips warnings and keeps paths repo-relative', () => {
    const errors = parseLintErrors(
      [
        `${WAVE}/apps/mobile/src/auth/AuthFlow.tsx:60:47: Parameter '_' is declared but never used. [Error/eslint(no-unused-vars)]`,
        'apps/web/src/chat.tsx:3:1: Prefer a different form. [Warning/eslint(prefer-thing)]',
        './packages/x/src/y.ts:8:2: Do not use `new Array(x)`. [Error/unicorn(no-new-array)]',
        '',
        'Found 3 problems',
      ].join('\n'),
      WAVE,
    );
    expect(errors).toEqual([
      {
        kind: 'lint',
        file: 'apps/mobile/src/auth/AuthFlow.tsx',
        name: 'eslint(no-unused-vars)',
        message: "60:47 Parameter '_' is declared but never used.",
      },
      {
        kind: 'lint',
        file: 'packages/x/src/y.ts',
        name: 'unicorn(no-new-array)',
        message: '8:2 Do not use `new Array(x)`.',
      },
    ]);
  });

  it('reads unformatted files from prettier --check, skipping its summary and the header', () => {
    const failures = parsePrettierFiles(
      [
        'Checking formatting...',
        `[warn] ${WAVE}/packages/devtools/src/gate/gate.test.ts`,
        '[warn] apps/web/src/chat.tsx',
        '[warn] Code style issues found in 2 files. Run Prettier with --write to fix.',
        '',
      ].join('\n'),
      WAVE,
    );
    expect(failures).toEqual([
      {
        kind: 'format',
        file: 'packages/devtools/src/gate/gate.test.ts',
        name: 'prettier',
        message:
          'Run `pnpm exec prettier --write packages/devtools/src/gate/gate.test.ts`, then commit the result.',
      },
      {
        kind: 'format',
        file: 'apps/web/src/chat.tsx',
        name: 'prettier',
        message: 'Run `pnpm exec prettier --write apps/web/src/chat.tsx`, then commit the result.',
      },
    ]);
    expect(parsePrettierFiles('All matched files use Prettier code style!', WAVE)).toEqual([]);
  });

  it('keeps the package own flags from its test script', () => {
    expect(testArgsOf('vitest run --testTimeout=30000 --hookTimeout=30000')).toEqual([
      '--testTimeout=30000',
      '--hookTimeout=30000',
    ]);
    expect(testArgsOf('vitest run')).toEqual([]);
  });
});

describe('runBatchMerge', () => {
  const BOARD = [
    '# Board',
    '',
    '## Active',
    '',
    '| ID | Title | Status |',
    '|---|---|---|',
    '| [T-0001](T-0001-demo.md) | Chat title on web | review |',
    '| [T-0002](T-0002-demo.md) | Rooms ids | review |',
    '',
    '## Done',
    '',
  ].join('\n');

  const LAST = {
    createdAt: '2026-10-09T12:30:45.123Z',
    dir: `${WAVE_ROOT}/20261009T123045Z`,
    tasks: ['T-0001', 'T-0002'],
    heads: {
      'T-0001': { branch: 'task/T-0001-a', head: SHA_A },
      'T-0002': { branch: 'task/T-0002-b', head: SHA_B },
    },
    wave: WAVE_SHA,
    treeKey: 'tree-key-1',
    ok: true,
  };

  function mergeWorld(
    last: unknown | undefined,
    options: { heads?: Record<string, string>; same?: boolean; board?: string } = {},
  ) {
    const files = new Map<string, string>();
    if (last !== undefined) {
      files.set(`${WAVE_ROOT}/last.json`, JSON.stringify(last));
    }
    files.set(`${ROOT}/work/BOARD.md`, options.board ?? BOARD);
    files.set(`${ROOT}/work/T-0001-demo.md`, taskFile('T-0001', 'task/T-0001-a', []));
    files.set(`${ROOT}/work/T-0002-demo.md`, taskFile('T-0002', 'task/T-0002-b', []));
    const heads = options.heads ?? { 'task/T-0001-a': SHA_A, 'task/T-0002-b': SHA_B };
    const git = new FakeGit(({ args }) => {
      if (args[0] === 'rev-parse') {
        const head = heads[args[1] ?? ''];
        return head === undefined ? { ok: false, stdout: '' } : { ok: true, stdout: `${head}\n` };
      }
      if (args[0] === 'diff' && args[1] === '--quiet') {
        return { ok: options.same ?? true, stdout: '' };
      }
      if (args[0] === 'diff' && args[1] === '--name-only') {
        return { ok: true, stdout: 'apps/web/src/drift.ts\n' };
      }
      return undefined;
    });
    const merged: MergeOptions[] = [];
    const printed: string[] = [];
    const deps: BatchMergeDeps = {
      root: ROOT,
      git,
      readText: (file) => files.get(file) ?? '',
      exists: (file) => files.has(file),
      listDir: (dir) =>
        [...files.keys()].filter((f) => path.dirname(f) === dir).map((f) => path.basename(f)),
      waveRoot: WAVE_ROOT,
      print: (line) => printed.push(line),
      mergeBase: {
        root: ROOT,
        today: '2026-10-09',
        runner: git,
        readText: () => '',
        writeText: () => undefined,
        dropFromState: () => undefined,
      },
      merge: async (mergeOptions) => {
        merged.push(mergeOptions);
      },
    };
    return { deps, git, merged, printed };
  }

  it('refuses with no last.json', async () => {
    const w = mergeWorld(undefined);
    await expect(runBatchMerge(w.deps, ['T-0001', 'T-0002'])).rejects.toThrow(/no checked wave/);
    expect(w.merged).toHaveLength(0);
  });

  it('refuses a wave that was not ok', async () => {
    const w = mergeWorld({ ...LAST, ok: false });
    await expect(runBatchMerge(w.deps, ['T-0001', 'T-0002'])).rejects.toThrow(/not OK/);
    expect(w.merged).toHaveLength(0);
  });

  it('refuses a different task set', async () => {
    const w = mergeWorld(LAST);
    await expect(runBatchMerge(w.deps, ['T-0001'])).rejects.toThrow(BatchError);
    await expect(runBatchMerge(w.deps, ['T-0001', 'T-0003'])).rejects.toThrow(/differs/);
    expect(w.merged).toHaveLength(0);
  });

  it('refuses when a branch head moved since the check', async () => {
    const w = mergeWorld(LAST, { heads: { 'task/T-0001-a': SHA_A, 'task/T-0002-b': SHA_C } });
    await expect(runBatchMerge(w.deps, ['T-0001', 'T-0002'])).rejects.toThrow(/T-0002.*moved/);
    expect(w.merged).toHaveLength(0);
  });

  it('accepts the same set in another order, merges in the given order with no gate and board titles', async () => {
    const w = mergeWorld(LAST);
    const result = await runBatchMerge(w.deps, ['T-0002', 'T-0001']);
    expect(w.merged.map((options) => options.task)).toEqual(['T-0002', 'T-0001']);
    expect(w.merged.map((options) => options.summary)).toEqual(['Rooms ids', 'Chat title on web']);
    expect(w.merged.every((options) => options.gate === undefined)).toBe(true);
    expect(w.merged[0]).toMatchObject({
      root: ROOT,
      file: 'T-0002-demo.md',
      worktree: '/work/zilar-T-0002',
      branch: 'task/T-0002-b',
    });
    expect(result).toEqual({ merged: ['T-0002', 'T-0001'], matches: true, differing: [] });
    expect(w.printed).toContain('wave merged: main matches the checked tree');
    expect(w.git.calls.at(-1)?.args).toEqual([
      'diff',
      '--quiet',
      WAVE_SHA,
      'HEAD',
      '--',
      '.',
      ':(exclude)work',
    ]);
  });

  it('stops before merging anything when a board row is missing', async () => {
    const board = BOARD.replace('| [T-0002](T-0002-demo.md) | Rooms ids | review |\n', '');
    const w = mergeWorld(LAST, { board });
    await expect(runBatchMerge(w.deps, ['T-0001', 'T-0002'])).rejects.toThrow(/no row.*T-0002/);
    expect(w.merged).toHaveLength(0);
  });

  it('warns about differing paths and never reverts', async () => {
    const w = mergeWorld(LAST, { same: false });
    const result = await runBatchMerge(w.deps, ['T-0001', 'T-0002']);
    expect(result.matches).toBe(false);
    expect(result.differing).toEqual(['apps/web/src/drift.ts']);
    expect(w.printed.some((line) => line.startsWith('WARNING'))).toBe(true);
    expect(w.printed).toContain('  apps/web/src/drift.ts');
    expect(w.git.calls.some((call) => call.args[0] === 'reset' || call.args[0] === 'revert')).toBe(
      false,
    );
  });
});
