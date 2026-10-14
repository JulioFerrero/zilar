import fs from 'node:fs';
import path from 'node:path';
import { type OpenCodeClient, type SessionModel } from './client.js';
import type { GitRunner } from './git.js';
import { loadPrompt, loadRulesFile, renderPrompt, unfilledPlaceholders } from './prompts.js';
import { updateState } from './state.js';
import { resolveWorkerModel } from './model-schedule.js';
import { assertAllowedModel, parseTaskFrontMatter, pickEffort, splitModel } from './task-file.js';
import { newTaskRecord } from './types.js';

export interface LaunchDeps {
  repoRoot: string;
  client: OpenCodeClient;
  promptsDirPath: string;
  statePath: string;
  runner: GitRunner;
  // Injectable clock for tests of `model: auto` peak-hour resolution.
  now?: () => Date;
}

// Finds work/T-XXXX-*.md inside a checkout. Exactly one must match.
export function findTaskFile(dir: string, task: string): string {
  const work = path.join(dir, 'work');
  let entries: string[];
  try {
    entries = fs.readdirSync(work);
  } catch {
    throw new Error(`no work/ directory in ${dir}`);
  }
  const matches = entries.filter((entry) => entry.startsWith(`${task}-`) && entry.endsWith('.md'));
  if (matches.length === 0) {
    throw new Error(`no task file for ${task} in ${work}`);
  }
  if (matches.length > 1) {
    throw new Error(`multiple task files for ${task}: ${matches.join(', ')}`);
  }
  return matches[0] as string;
}

export function worktreeFor(repoRoot: string, task: string): string {
  return path.join(path.dirname(path.resolve(repoRoot)), `zilar-${task}`);
}

// Loads the task's front matter from the repo root. Reused by launch and the
// state checks before switch-model touches anything.
export function readTaskFrontMatter(
  repoRoot: string,
  task: string,
): {
  file: string;
  model: string;
  branch: string;
  effort: string;
} {
  const file = findTaskFile(repoRoot, task);
  const text = fs.readFileSync(path.join(repoRoot, 'work', file), 'utf8');
  const frontMatter = parseTaskFrontMatter(text);
  return {
    file,
    model: frontMatter.model,
    branch: frontMatter.branch,
    effort: pickEffort(text, frontMatter.effort),
  };
}

interface StartSessionOptions {
  client: OpenCodeClient;
  promptsDirPath: string;
  task: string;
  file: string;
  worktree: string;
  branch: string;
  title: string;
  model: SessionModel;
  rules: ReturnType<typeof loadRulesFile>;
  template: 'worker' | 'switch';
  // The OpenCode agent id; defaults to `build` for the worker. Pulled out
  // only so future pre-review callers can swap it; switch-model keeps `build`.
  agent?: string;
}

interface StartSessionResult {
  sessionId: string;
  prompt: string;
}

// Builds the worker prompt for a task, with all placeholders filled in, and
// asserts the rendered output contains every substituted value. Shared
// between `startWorkerSession` and `switchModel` so the validation lives in
// exactly one place. Throwing here means the caller never reaches
// `createSession` — a broken template must not leave an orphan session
// behind.
export function renderWorkerPrompt(options: {
  promptsDirPath: string;
  task: string;
  file: string;
  worktree: string;
  branch: string;
  template: 'worker' | 'switch';
}): string {
  const templateFile = options.template === 'switch' ? 'switch' : 'worker';
  const substitutions = {
    TASK: options.task,
    TASK_FILE: options.file,
    WORKTREE: options.worktree,
    BRANCH: options.branch,
  };
  const prompt = renderPrompt(loadPrompt(options.promptsDirPath, templateFile), substitutions);
  // Catch two ways a template can be broken:
  //  1. it still contains `{{NAME}}` after rendering (placeholder not in template);
  //  2. it does not contain the substituted value (template dropped it).
  const unfilled = unfilledPlaceholders(prompt).filter((name) =>
    (Object.keys(substitutions) as (keyof typeof substitutions)[]).includes(name as never),
  );
  if (unfilled.length > 0) {
    throw new Error(`${templateFile} prompt has unfilled placeholders: ${unfilled.join(', ')}`);
  }
  const missingValues = (Object.entries(substitutions) as [string, string][])
    .filter(([, value]) => !prompt.includes(value))
    .map(([name]) => name);
  if (missingValues.length > 0) {
    throw new Error(
      `${templateFile} prompt is missing substituted values for: ${missingValues.join(', ')}`,
    );
  }
  return prompt;
}

// Starts a session in the given worktree and sends the worker prompt with the
// task placeholders filled in. Shared between launch (fresh worktree) and
// switch-model (existing worktree, different model). Validates the prompt
// BEFORE createSession so a broken template never leaves an orphan session.
export async function startWorkerSession(
  options: StartSessionOptions,
): Promise<StartSessionResult> {
  const prompt = renderWorkerPrompt(options);
  const sessionId = await options.client.createSession({
    title: options.title,
    agent: options.agent ?? 'build',
    model: options.model,
    directory: options.worktree,
    permissions: options.rules,
  });
  options.client.promptDetached(sessionId, prompt);
  return { sessionId, prompt };
}

export interface LaunchOptions {
  task: string;
  extraRulesFile: string | undefined;
  base: string | undefined;
}

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

// Parses `lead launch <T-XXXX> [--extra-rules <file>] [--base <ref>]`. It lives
// here rather than in cli.ts so that command file stays within its line budget.
export function parseLaunchArgs(args: string[]): LaunchOptions {
  const task = args.find((arg) => !arg.startsWith('--'));
  if (task === undefined) {
    throw new Error('usage: lead launch <T-XXXX> [--extra-rules <file>] [--base <ref>]');
  }
  return {
    task,
    extraRulesFile: argValue(args, '--extra-rules'),
    base: argValue(args, '--base'),
  };
}

// A worktree built from an older commit (a model eval replay) does not contain
// the task file, which lives on `main`. Copy the spec in and commit it so the
// worker finds its brief. Both failures are hard: a worker without its spec
// misses the whole task.
function commitEvalSpec(deps: LaunchDeps, worktree: string, file: string, task: string): void {
  const relative = path.posix.join('work', file);
  const destination = path.join(worktree, relative);
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(deps.repoRoot, 'work', file), destination);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to copy ${relative} into ${worktree}: ${detail}`);
  }
  const added = deps.runner.run(worktree, ['add', relative]);
  if (!added.ok) {
    throw new Error(`failed to stage ${relative} in ${worktree}`);
  }
  const committed = deps.runner.run(worktree, ['commit', '-m', `${task}: eval spec`]);
  if (!committed.ok) {
    throw new Error(`failed to commit the eval spec ${relative} in ${worktree}`);
  }
}

export async function launchTask(
  options: LaunchOptions,
  deps: LaunchDeps,
): Promise<{ sessionId: string; worktree: string }> {
  const { task, extraRulesFile, base } = options;
  if (!/^T-\d+$/.test(task)) {
    throw new Error(`task must look like T-0038, got ${JSON.stringify(task)}`);
  }
  const { file, model: modelString, branch, effort } = readTaskFrontMatter(deps.repoRoot, task);
  const now = deps.now?.() ?? new Date();
  const resolved = resolveWorkerModel(modelString, now);
  assertAllowedModel(resolved.model);
  const model = { ...splitModel(resolved.model), variant: resolved.effortOverride ?? effort };
  if (modelString === 'auto') {
    console.log(`${task} auto -> ${resolved.model}`);
  }
  const worktree = worktreeFor(deps.repoRoot, task);
  if (fs.existsSync(worktree)) {
    throw new Error(`worktree already exists: ${worktree}`);
  }
  if (base !== undefined) {
    const verified = deps.runner.run(deps.repoRoot, ['rev-parse', '--verify', `${base}^{commit}`]);
    if (!verified.ok) {
      throw new Error(`--base ${base} does not resolve to a commit`);
    }
  }
  const ref = base ?? 'main';
  const added = deps.runner.run(deps.repoRoot, [
    'worktree',
    'add',
    '-q',
    worktree,
    '-b',
    branch,
    ref,
  ]);
  if (!added.ok) {
    throw new Error(`git worktree add failed for ${worktree} (is ${branch} taken?)`);
  }
  if (ref !== 'main') {
    commitEvalSpec(deps, worktree, file, task);
  }
  const rules = loadRulesFile(path.join(deps.promptsDirPath, 'rules.json'));
  if (extraRulesFile !== undefined) {
    rules.push(...loadRulesFile(extraRulesFile));
  }
  const { sessionId } = await startWorkerSession({
    client: deps.client,
    promptsDirPath: deps.promptsDirPath,
    task,
    file,
    worktree,
    branch,
    title: `${task} (${file})`,
    model,
    rules,
    template: 'worker',
  });
  updateState(deps.statePath, (state) => {
    state.tasks[task] = newTaskRecord({
      task,
      sessionId,
      worktree,
      model: resolved.model,
      role: 'worker',
      startedAt: new Date().toISOString(),
    });
  });
  return { sessionId, worktree };
}
