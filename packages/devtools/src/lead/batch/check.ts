import path from 'node:path';

import { STEP_TIMEOUT_MS, TESTS_TIMEOUT_MS, turboCacheDir } from '../../gate/plan.js';
import { scopeReport } from '../../gate/scope.js';
import { parseFrontMatter } from '../task-file.js';
import {
  parseLintErrors,
  parsePrettierFiles,
  parseTypecheckErrors,
  parseVitestFailures,
} from './parsers.js';
import { fixFile, reportText, summaryLine, taskIssues } from './report.js';
import { firstLines, lastLines, lines, MESSAGE_LINES, safeName, WAVE_BRANCH } from './text.js';
import {
  BatchError,
  type BatchDeps,
  type CheckResult,
  type CommandResult,
  type Failure,
  type LastWave,
  type TaskOutcome,
} from './types.js';
import {
  findTaskFileIn,
  ownerOf,
  stamp,
  taskWorktree,
  validateTasks,
  waveWorktree,
} from './wave.js';

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

  const lint = await deps.runCommand(
    wave,
    'pnpm',
    ['exec', 'oxlint', '--format=unix', '.'],
    STEP_TIMEOUT_MS,
  );
  const lintErrors = parseLintErrors(lint.output, wave);
  failures.push(...lintErrors);
  if (lint.status !== 0 && lintErrors.length === 0) {
    tool('lint (no error could be read)', lint);
  }

  const format = await deps.runCommand(
    wave,
    'pnpm',
    ['exec', 'prettier', '--check', '.'],
    STEP_TIMEOUT_MS,
  );
  const formatErrors = parsePrettierFiles(format.output, wave);
  failures.push(...formatErrors);
  if (format.status !== 0 && formatErrors.length === 0) {
    tool('format (no file could be read)', format);
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
          // Cap every package's worker count so the two packages running at
          // once (runPool below) stay under ~8 GB together (T-0930).
          '--maxWorkers=2',
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
