// `lead batch check` combines the branches of a wave of tasks on one worktree,
// runs install, typecheck and every package's tests without stopping at the
// first failure, and writes one fix file per task that owns a failure.
// `lead batch merge` then merges a checked wave task by task without a gate.
// Every side effect (git, commands, files, clock) goes through `BatchDeps`, so
// the tests run on fakes.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STEP_TIMEOUT_MS, TESTS_TIMEOUT_MS, turboCacheDir } from '../gate/plan.js';
import { treeKey } from '../gate/pass-record.js';
import { scopeReport } from '../gate/scope.js';
import { RealGitRunner, type GitRunner } from './git.js';
import { mergeTask, type MergeOptions } from './merge.js';
import { stateFilePath, updateState } from './state.js';
import { parseFrontMatter } from './task-file.js';

export class BatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchError';
  }
}

export interface CommandResult {
  status: number;
  /** stdout and stderr together. */
  output: string;
}

export interface BatchPackage {
  name: string;
  /** Repo-relative folder, such as `apps/web`. */
  dir: string;
  /** Arguments after `vitest run` in the package's test script; undefined when it has no tests. */
  testArgs: string[] | undefined;
}

export interface BatchDeps {
  /** The main checkout. */
  root: string;
  git: GitRunner;
  runCommand: (
    cwd: string,
    command: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<CommandResult>;
  readText: (file: string) => string;
  writeText: (file: string, text: string) => void;
  makeDir: (dir: string) => void;
  exists: (file: string) => boolean;
  listDir: (dir: string) => string[];
  listPackages: (worktree: string) => BatchPackage[];
  treeKey: (worktree: string) => string | undefined;
  now: () => Date;
  /** Where waves are written: `~/.zilar-lead/wave`. */
  waveRoot: string;
  print: (line: string) => void;
}

export interface Failure {
  kind: 'typecheck' | 'test' | 'tool';
  /** Repo-relative file, when the failure names one. */
  file?: string;
  /** The test's full name, the TS error code or the failing step. */
  name: string;
  message: string;
}

export interface TaskOutcome {
  task: string;
  branch: string;
  head: string;
  merged: boolean;
  conflictFiles: string[];
  conflictNote: string;
  files: string[];
  outside: string[];
  failures: Failure[];
}

export interface CheckResult {
  ok: boolean;
  waveDir: string;
  reportPath: string;
  lines: string[];
}

interface LastWave {
  createdAt: string;
  dir: string;
  tasks: string[];
  heads: Record<string, { branch: string; head: string }>;
  wave: string;
  treeKey: string | null;
  ok: boolean;
}

const WAVE_BRANCH = 'wave';
const MESSAGE_LINES = 30;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

function firstLines(text: string, count: number): string {
  return stripAnsi(text).split('\n').slice(0, count).join('\n').trimEnd();
}

function lastLines(text: string, count: number): string {
  return stripAnsi(text).trimEnd().split('\n').slice(-count).join('\n');
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function waveWorktree(root: string): string {
  return path.join(path.dirname(path.resolve(root)), 'zilar-wave');
}

function taskWorktree(root: string, task: string): string {
  return path.join(path.dirname(path.resolve(root)), `zilar-${task}`);
}

function findTaskFileIn(
  listDir: (dir: string) => string[],
  checkout: string,
  task: string,
): string {
  const work = path.join(checkout, 'work');
  const matches = listDir(work).filter(
    (entry) => entry.startsWith(`${task}-`) && entry.endsWith('.md'),
  );
  if (matches.length !== 1) {
    throw new BatchError(`expected one task file for ${task} in ${work}, found ${matches.length}`);
  }
  return matches[0] as string;
}

function validateTasks(tasks: string[]): void {
  if (tasks.length === 0) {
    throw new BatchError('give at least one task: lead batch <check|merge> <T-XXXX> ...');
  }
  for (const task of tasks) {
    if (!/^T-\d+$/.test(task)) {
      throw new BatchError(`not a task id: ${JSON.stringify(task)}`);
    }
  }
  if (new Set(tasks).size !== tasks.length) {
    throw new BatchError('a task is listed twice');
  }
}

function stamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

function fileStem(file: string): string {
  const name = file.slice(file.lastIndexOf('/') + 1);
  const dot = name.indexOf('.');
  return dot < 0 ? name : name.slice(0, dot);
}

function dirOf(file: string): string {
  const slash = file.lastIndexOf('/');
  return slash < 0 ? '' : file.slice(0, slash);
}

/**
 * The task that owns a failing file: the first task whose diff holds it. A test
 * file also belongs to the task whose diff holds a file with the same base name
 * in the same folder (`foo.test.tsx` and `foo.tsx`).
 */
export function ownerOf(
  file: string,
  owned: { task: string; files: string[] }[],
): string | undefined {
  const direct = owned.find((entry) => entry.files.includes(file));
  if (direct !== undefined) {
    return direct.task;
  }
  if (!/\.test\.tsx?$/.test(file)) {
    return undefined;
  }
  const stem = fileStem(file);
  const dir = dirOf(file);
  return owned.find((entry) =>
    entry.files.some((other) => dirOf(other) === dir && fileStem(other) === stem),
  )?.task;
}

const TS_PAREN = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const TS_COLON = /^(.+?):(\d+):(\d+) - error (TS\d+): (.*)$/;
const TURBO_PREFIX = /^(\S+?):typecheck: ?(.*)$/;

/** Typecheck errors from turbo (or plain tsc) output; paths become repo-relative. */
export function parseTypecheckErrors(output: string, packages: BatchPackage[]): Failure[] {
  const dirByName = new Map(packages.map((pkg) => [pkg.name, pkg.dir]));
  const found = new Map<string, Failure>();
  let current: Failure | undefined;
  let extra = 0;
  for (const raw of stripAnsi(output).split('\n')) {
    const prefixed = TURBO_PREFIX.exec(raw);
    const packageDir = prefixed === null ? undefined : dirByName.get(prefixed[1] as string);
    const text = prefixed === null ? raw : (prefixed[2] as string);
    const match = TS_PAREN.exec(text) ?? TS_COLON.exec(text);
    if (match !== null) {
      const relative = (match[1] as string).trim();
      const file = path.posix.normalize(
        packageDir === undefined ? relative : path.posix.join(packageDir, relative),
      );
      const failure: Failure = {
        kind: 'typecheck',
        file,
        name: `${match[4] as string} at ${file}:${match[2] as string}:${match[3] as string}`,
        message: match[5] as string,
      };
      const key = `${failure.name}|${failure.message}`;
      current = found.get(key) ?? failure;
      found.set(key, current);
      extra = 0;
    } else if (current !== undefined && /^\s+\S/.test(text) && extra < MESSAGE_LINES) {
      current.message += `\n${text.trimEnd()}`;
      extra += 1;
    } else {
      current = undefined;
    }
  }
  return [...found.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function relativeTo(worktree: string, file: string): string {
  const relative = path.isAbsolute(file) ? path.relative(worktree, file) : file;
  return relative.split(path.sep).join('/');
}

/** Failed tests from a Vitest JSON report. Returns undefined when the text is not one. */
export function parseVitestFailures(text: string, worktree: string): Failure[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['testResults'])) {
    return undefined;
  }
  const failures: Failure[] = [];
  for (const entry of parsed['testResults'] as unknown[]) {
    if (!isRecord(entry) || typeof entry['name'] !== 'string') {
      continue;
    }
    const file = relativeTo(worktree, entry['name']);
    const assertions = Array.isArray(entry['assertionResults']) ? entry['assertionResults'] : [];
    let reported = false;
    for (const assertion of assertions as unknown[]) {
      if (!isRecord(assertion) || assertion['status'] !== 'failed') {
        continue;
      }
      reported = true;
      const messages = Array.isArray(assertion['failureMessages'])
        ? (assertion['failureMessages'] as unknown[]).filter(
            (message): message is string => typeof message === 'string',
          )
        : [];
      const title = assertion['fullName'] ?? assertion['title'];
      failures.push({
        kind: 'test',
        file,
        name: typeof title === 'string' ? title : '(unnamed test)',
        message: firstLines(messages.join('\n'), MESSAGE_LINES),
      });
    }
    if (!reported && entry['status'] === 'failed') {
      const message = typeof entry['message'] === 'string' ? entry['message'] : '';
      failures.push({
        kind: 'test',
        file,
        name: '(the file failed to run)',
        message: firstLines(message, MESSAGE_LINES),
      });
    }
  }
  return failures;
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function runPool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await work(item);
    }
  });
  await Promise.all(workers);
}

interface PreparedTask {
  task: string;
  branch: string;
  taskText: string;
}

function prepareTask(deps: BatchDeps, task: string): PreparedTask {
  const worktree = taskWorktree(deps.root, task);
  const file = findTaskFileIn(deps.listDir, worktree, task);
  const taskText = deps.readText(path.join(worktree, 'work', file));
  const branch = parseFrontMatter(taskText)['branch'];
  if (branch === undefined || branch.length === 0) {
    throw new BatchError(`${task} has no branch in its front matter`);
  }
  return { task, branch, taskText };
}

function recreateWaveWorktree(deps: BatchDeps, wave: string): void {
  deps.git.run(deps.root, ['worktree', 'remove', '--force', wave]);
  deps.git.run(deps.root, ['worktree', 'prune']);
  deps.git.run(deps.root, ['branch', '-D', WAVE_BRANCH]);
  const added = deps.git.run(deps.root, ['worktree', 'add', '-b', WAVE_BRANCH, wave, 'main']);
  if (!added.ok) {
    throw new BatchError(`could not create the wave worktree ${wave}`);
  }
}

function combine(deps: BatchDeps, wave: string, prepared: PreparedTask[]): TaskOutcome[] {
  const outcomes: TaskOutcome[] = [];
  for (const entry of prepared) {
    const head = deps.git.run(wave, ['rev-parse', entry.branch]).stdout.trim();
    const outcome: TaskOutcome = {
      task: entry.task,
      branch: entry.branch,
      head,
      merged: false,
      conflictFiles: [],
      conflictNote: '',
      files: [],
      outside: [],
      failures: [],
    };
    outcomes.push(outcome);
    const merge = deps.git.run(wave, ['merge', '--no-ff', '--no-edit', entry.branch]);
    if (!merge.ok) {
      outcome.conflictFiles = lines(
        deps.git.run(wave, ['diff', '--name-only', '--diff-filter=U']).stdout,
      );
      outcome.conflictNote = firstLines(merge.stdout, 5);
      deps.git.run(wave, ['merge', '--abort']);
      continue;
    }
    outcome.merged = true;
    outcome.files = lines(
      deps.git.run(wave, ['diff', '--name-only', `main...${entry.branch}`]).stdout,
    );
    const scope = scopeReport(entry.taskText, outcome.files);
    outcome.outside = scope.outside;
  }
  return outcomes;
}

async function runChecks(deps: BatchDeps, wave: string, waveDir: string): Promise<Failure[]> {
  const failures: Failure[] = [];
  const packages = deps.listPackages(wave);
  const tool = (name: string, result: CommandResult): void => {
    failures.push({ kind: 'tool', name, message: lastLines(result.output, MESSAGE_LINES) });
  };

  const install = await deps.runCommand(
    wave,
    'pnpm',
    ['install', '--frozen-lockfile'],
    STEP_TIMEOUT_MS,
  );
  if (install.status !== 0) {
    tool('pnpm install --frozen-lockfile', install);
  }

  const typecheck = await deps.runCommand(
    wave,
    'pnpm',
    [
      'exec',
      'turbo',
      'run',
      'typecheck',
      '--continue',
      '--concurrency=2',
      `--cache-dir=${turboCacheDir}`,
    ],
    STEP_TIMEOUT_MS,
  );
  const typeErrors = parseTypecheckErrors(typecheck.output, packages);
  failures.push(...typeErrors);
  if (typecheck.status !== 0 && typeErrors.length === 0) {
    tool('typecheck (no TS error could be read)', typecheck);
  }

  await runPool(
    packages.filter((pkg) => pkg.testArgs !== undefined),
    2,
    async (pkg) => {
      const jsonPath = path.join(waveDir, `${safeName(pkg.name)}.json`);
      const result = await deps.runCommand(
        wave,
        'pnpm',
        [
          '--filter',
          pkg.name,
          'exec',
          'vitest',
          'run',
          '--reporter=json',
          `--outputFile=${jsonPath}`,
          ...(pkg.testArgs ?? []),
        ],
        TESTS_TIMEOUT_MS,
      );
      const parsed = deps.exists(jsonPath)
        ? parseVitestFailures(deps.readText(jsonPath), wave)
        : undefined;
      if (parsed === undefined) {
        if (result.status !== 0) {
          tool(`tests ${pkg.name} (no report written)`, result);
        }
        return;
      }
      failures.push(...parsed);
      if (result.status !== 0 && parsed.length === 0) {
        tool(`tests ${pkg.name} (failed without a failing test)`, result);
      }
    },
  );
  return failures;
}

function taskIssues(outcome: TaskOutcome): number {
  return outcome.failures.length + outcome.outside.length + (outcome.merged ? 0 : 1);
}

function summaryLine(outcome: TaskOutcome): string {
  if (!outcome.merged) {
    return `${outcome.task} CONFLICT ${outcome.conflictFiles.join(', ') || '(merge failed)'}`;
  }
  const typecheck = outcome.failures.filter((failure) => failure.kind === 'typecheck').length;
  const tests = outcome.failures.filter((failure) => failure.kind === 'test').length;
  if (typecheck + tests + outcome.outside.length === 0) {
    return `${outcome.task} ok`;
  }
  return `${outcome.task} FAIL typecheck ${typecheck}, tests ${tests}, out of scope ${outcome.outside.length}`;
}

function failureItem(failure: Failure): string {
  const head =
    failure.kind === 'typecheck'
      ? `Typecheck error ${failure.name}`
      : failure.kind === 'test'
        ? `Failing test in ${failure.file ?? '(unknown file)'}: ${failure.name}`
        : `Check failed: ${failure.name}${failure.file === undefined ? '' : ` (${failure.file})`}`;
  return `${head}\n\n\`\`\`\n${failure.message}\n\`\`\``;
}

function fixFile(outcome: TaskOutcome, stampText: string): string {
  const items: string[] = [];
  if (!outcome.merged) {
    items.push(
      `Merge conflict: your branch ${outcome.branch} does not merge with the wave on ${outcome.conflictFiles.join(', ') || '(unknown files)'}. Rebase on main (and on the other tasks of the wave if told), keep both sides, \`git add\` each file, continue the rebase.`,
    );
  }
  for (const file of outcome.outside) {
    items.push(
      `Out of scope: \`${file}\` is outside this task's Allowed files. Revert it, or explain in the Report why it is needed.`,
    );
  }
  for (const failure of outcome.failures) {
    items.push(failureItem(failure));
  }
  return [
    `# ${outcome.task}: fixes from the combined check of wave ${stampText}`,
    '',
    'The branches of the wave were combined and checked together. Fix each item below, one commit per item, run `pnpm gate`, keep `status: review`.',
    '',
    ...items.map((item, index) => `${index + 1}. ${item}`),
    '',
  ].join('\n');
}

function reportText(
  outcomes: TaskOutcome[],
  unowned: Failure[],
  stampText: string,
  ok: boolean,
): string {
  const rows = outcomes.map((outcome) => {
    const merge = outcome.merged
      ? 'merged'
      : `conflict: ${outcome.conflictFiles.join(', ') || 'merge failed'}`;
    const outside = outcome.outside.length === 0 ? '-' : outcome.outside.join(', ');
    const typecheck = outcome.failures.filter((failure) => failure.kind === 'typecheck').length;
    const tests = outcome.failures.filter((failure) => failure.kind === 'test').length;
    return `| ${outcome.task} | ${merge} | ${outside} | ${typecheck} | ${tests} |`;
  });
  const unownedItems =
    unowned.length === 0
      ? ['None.']
      : unowned.map((failure, index) => `${index + 1}. ${failureItem(failure)}`);
  return [
    `# Wave ${stampText}: ${ok ? 'OK' : 'NOT OK'}`,
    '',
    '| Task | Merge | Out of scope | Typecheck errors | Failed tests |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    '## unowned',
    '',
    ...unownedItems,
    '',
  ].join('\n');
}

export async function runBatchCheck(deps: BatchDeps, tasks: string[]): Promise<CheckResult> {
  validateTasks(tasks);
  const prepared = tasks.map((task) => prepareTask(deps, task));
  const wave = waveWorktree(deps.root);
  recreateWaveWorktree(deps, wave);
  const outcomes = combine(deps, wave, prepared);
  const mergedAny = outcomes.some((outcome) => outcome.merged);

  const stampText = stamp(deps.now());
  const waveDir = path.join(deps.waveRoot, stampText);
  deps.makeDir(waveDir);

  const unowned: Failure[] = [];
  if (mergedAny) {
    const owned = outcomes.filter((outcome) => outcome.merged);
    for (const failure of await runChecks(deps, wave, waveDir)) {
      const task = failure.file === undefined ? undefined : ownerOf(failure.file, owned);
      const owner = outcomes.find((outcome) => outcome.task === task);
      if (owner === undefined) {
        unowned.push(failure);
      } else {
        owner.failures.push(failure);
      }
    }
  }

  const ok =
    mergedAny &&
    unowned.length === 0 &&
    outcomes.every((outcome) => outcome.merged && taskIssues(outcome) === 0);
  const waveHead = deps.git.run(wave, ['rev-parse', 'HEAD']).stdout.trim();

  const reportPath = path.join(waveDir, 'report.md');
  deps.writeText(reportPath, reportText(outcomes, unowned, stampText, ok));
  for (const outcome of outcomes) {
    if (taskIssues(outcome) > 0) {
      deps.writeText(path.join(waveDir, `${outcome.task}.fix.md`), fixFile(outcome, stampText));
    }
  }
  const last: LastWave = {
    createdAt: deps.now().toISOString(),
    dir: waveDir,
    tasks,
    heads: Object.fromEntries(
      outcomes.map((outcome) => [outcome.task, { branch: outcome.branch, head: outcome.head }]),
    ),
    wave: waveHead,
    treeKey: deps.treeKey(wave) ?? null,
    ok,
  };
  deps.writeText(path.join(deps.waveRoot, 'last.json'), `${JSON.stringify(last, null, 2)}\n`);

  const output = [
    `report: ${reportPath}`,
    ...outcomes.map(summaryLine),
    ...(unowned.length > 0 ? [`unowned: ${unowned.length} failure(s), see the report`] : []),
    ok ? 'wave OK' : 'wave NOT OK',
  ];
  for (const line of output) {
    deps.print(line);
  }
  return { ok, waveDir, reportPath, lines: output };
}

export interface BatchMergeDeps {
  root: string;
  git: GitRunner;
  readText: (file: string) => string;
  exists: (file: string) => boolean;
  waveRoot: string;
  print: (line: string) => void;
  listDir: (dir: string) => string[];
  /** Everything `mergeTask` needs except the per-task fields and the gate. */
  mergeBase: Omit<MergeOptions, 'task' | 'file' | 'worktree' | 'branch' | 'summary' | 'gate'>;
  merge: (options: MergeOptions) => Promise<void>;
}

export interface BatchMergeResult {
  merged: string[];
  matches: boolean;
  differing: string[];
}

function readLastWave(deps: BatchMergeDeps): LastWave {
  const file = path.join(deps.waveRoot, 'last.json');
  if (!deps.exists(file)) {
    throw new BatchError('no checked wave: run `lead batch check` first');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(deps.readText(file));
  } catch {
    throw new BatchError(`${file} is not valid JSON; run \`lead batch check\` again`);
  }
  if (
    !isRecord(parsed) ||
    typeof parsed['ok'] !== 'boolean' ||
    typeof parsed['wave'] !== 'string' ||
    !Array.isArray(parsed['tasks']) ||
    !isRecord(parsed['heads'])
  ) {
    throw new BatchError(`${file} has an unexpected shape; run \`lead batch check\` again`);
  }
  return parsed as unknown as LastWave;
}

function boardTitle(boardText: string, task: string): string {
  for (const line of boardText.split('\n')) {
    const match = /^\|\s*\[([A-Z]+-\d+)\]\([^)]+\)\s*\|\s*([^|]*?)\s*\|/.exec(line);
    if (match !== null && match[1] === task && (match[2] as string).length > 0) {
      return match[2] as string;
    }
  }
  throw new BatchError(`work/BOARD.md has no row with a title for ${task}`);
}

export async function runBatchMerge(
  deps: BatchMergeDeps,
  tasks: string[],
): Promise<BatchMergeResult> {
  validateTasks(tasks);
  const last = readLastWave(deps);
  if (!last.ok) {
    throw new BatchError('the last checked wave was not OK; fix it and run `lead batch check`');
  }
  const checked = new Set(last.tasks);
  if (checked.size !== tasks.length || tasks.some((task) => !checked.has(task))) {
    throw new BatchError(
      `the checked wave was ${last.tasks.join(' ')}; this list differs. Run \`lead batch check\` for it`,
    );
  }
  for (const task of tasks) {
    const entry = last.heads[task];
    if (entry === undefined) {
      throw new BatchError(`${task} has no recorded head in the checked wave`);
    }
    const head = deps.git.run(deps.root, ['rev-parse', entry.branch]).stdout.trim();
    if (head !== entry.head) {
      throw new BatchError(
        `${task}: branch ${entry.branch} moved since the check (${entry.head.slice(0, 8)} to ${head.slice(0, 8) || 'missing'}). Run \`lead batch check\` again`,
      );
    }
  }
  const boardText = deps.readText(path.join(deps.root, 'work', 'BOARD.md'));
  const titles = new Map(tasks.map((task) => [task, boardTitle(boardText, task)]));

  const merged: string[] = [];
  for (const task of tasks) {
    const file = findTaskFileIn(deps.listDir, deps.root, task);
    const frontMatter = parseFrontMatter(deps.readText(path.join(deps.root, 'work', file)));
    const entry = last.heads[task] as { branch: string; head: string };
    await deps.merge({
      ...deps.mergeBase,
      task,
      file,
      worktree: taskWorktree(deps.root, task),
      branch: frontMatter['branch'] ?? entry.branch,
      summary: titles.get(task) as string,
    });
    merged.push(task);
    deps.print(`${task} merged`);
  }

  const same = deps.git.run(deps.root, [
    'diff',
    '--quiet',
    last.wave,
    'HEAD',
    '--',
    '.',
    ':(exclude)work',
  ]);
  if (same.ok) {
    deps.print('wave merged: main matches the checked tree');
    return { merged, matches: true, differing: [] };
  }
  const differing = lines(
    deps.git.run(deps.root, ['diff', '--name-only', last.wave, 'HEAD', '--', '.', ':(exclude)work'])
      .stdout,
  );
  deps.print(`WARNING: main differs from the checked tree in ${differing.length} path(s):`);
  for (const file of differing) {
    deps.print(`  ${file}`);
  }
  return { merged, matches: false, differing };
}

function runShell(
  cwd: string,
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ status: 1, output: `${Buffer.concat(chunks).toString('utf8')}\n${String(error)}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: code ?? 1, output: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

// The flags after `vitest run` in a package's test script (its own timeouts).
export function testArgsOf(script: string): string[] {
  const match = /^\s*vitest run\s*(.*)$/.exec(script);
  return match === null ? [] : (match[1] as string).split(/\s+/).filter((arg) => arg.length > 0);
}

function readPackages(worktree: string): BatchPackage[] {
  const found: BatchPackage[] = [];
  for (const group of ['apps', 'packages']) {
    const groupDir = path.join(worktree, group);
    if (!fs.existsSync(groupDir)) {
      continue;
    }
    for (const name of fs.readdirSync(groupDir)) {
      const manifest = path.join(groupDir, name, 'package.json');
      if (!fs.existsSync(manifest)) {
        continue;
      }
      const parsed: unknown = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (!isRecord(parsed) || typeof parsed['name'] !== 'string') {
        continue;
      }
      const scripts = isRecord(parsed['scripts']) ? parsed['scripts'] : {};
      const script = typeof scripts['test'] === 'string' ? scripts['test'] : undefined;
      found.push({
        name: parsed['name'],
        dir: `${group}/${name}`,
        testArgs: script === undefined ? undefined : testArgsOf(script),
      });
    }
  }
  return found;
}

export function realBatchDeps(root: string): BatchDeps {
  return {
    root,
    git: new RealGitRunner(),
    runCommand: runShell,
    readText: (file) => fs.readFileSync(file, 'utf8'),
    writeText: (file, text) => fs.writeFileSync(file, text),
    makeDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    exists: (file) => fs.existsSync(file),
    listDir: (dir) => {
      try {
        return fs.readdirSync(dir);
      } catch {
        return [];
      }
    },
    listPackages: readPackages,
    treeKey,
    now: () => new Date(),
    waveRoot: path.join(os.homedir(), '.zilar-lead', 'wave'),
    print: (line) => console.log(line),
  };
}

export function realBatchMergeDeps(root: string): BatchMergeDeps {
  const base = realBatchDeps(root);
  const statePath = stateFilePath();
  return {
    root,
    git: base.git,
    readText: base.readText,
    exists: base.exists,
    listDir: base.listDir,
    waveRoot: base.waveRoot,
    print: base.print,
    mergeBase: {
      root,
      today: new Date().toISOString().slice(0, 10),
      runner: base.git,
      readText: base.readText,
      writeText: base.writeText,
      dropFromState: (entry) => {
        updateState(statePath, (state) => {
          delete state.tasks[entry];
        });
      },
    },
    merge: mergeTask,
  };
}
