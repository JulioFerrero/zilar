import fs from 'node:fs';
import path from 'node:path';
import { type OpenCodeClient, type SessionModel } from './client.js';
import { isFreeListing, isFreePaused, paidStep } from './free-pause.js';
import { isGoPaused } from './go-pause.js';
import type { GitRunner } from './git.js';
import { loadPrompt, loadRulesFile, renderPrompt, unfilledPlaceholders } from './prompts.js';
import { freeSessionInUse, loadState, updateState } from './state.js';
import { resolveWorkerModel } from './model-schedule.js';
import { assertAllowedModel, parseTaskFrontMatter, pickEffort, splitModel } from './task-file.js';
import { newTaskRecord } from './types.js';

export interface LaunchDeps {
  repoRoot: string;
  client: OpenCodeClient;
  promptsDirPath: string;
  statePath: string;
  runner: GitRunner;
  now?: () => Date;
}

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
  // The OpenCode agent id; defaults to `build`.
  agent?: string;
}

interface StartSessionResult {
  sessionId: string;
  prompt: string;
}

// Builds the worker prompt and asserts every substituted value is present. Throwing
// before `createSession` means a broken template leaves no orphan session.
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
  // Catch two broken templates: a leftover `{{NAME}}`, or a substituted value missing.
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

// Starts a session in the worktree and sends the worker prompt; shared by launch and
// switch-model, and validated before `createSession`.
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

// Parses `lead launch <T-XXXX> [--extra-rules <file>] [--base <ref>]`.
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

// A worktree from an older commit, or one whose spec is not on main, lacks the task
// file; copy the spec in and commit it on the task branch so the worker has its brief.
function commitSpec(deps: LaunchDeps, worktree: string, file: string, message: string): void {
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
  const committed = deps.runner.run(worktree, ['commit', '-m', message]);
  if (!committed.ok) {
    throw new Error(`failed to commit ${relative} in ${worktree}`);
  }
}

// Removes the spec's uncommitted copy from main once it is committed on the task branch.
function removeUncommittedSpec(deps: LaunchDeps, relative: string): void {
  const staged = deps.runner.run(deps.repoRoot, ['ls-files', '--error-unmatch', '--', relative]);
  if (staged.ok) {
    const removed = deps.runner.run(deps.repoRoot, ['rm', '-f', '--', relative]);
    if (!removed.ok) {
      throw new Error(`failed to remove the staged spec ${relative} from main`);
    }
    return;
  }
  try {
    fs.rmSync(path.join(deps.repoRoot, relative));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to remove the uncommitted spec ${relative} from main: ${detail}`);
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
  const goPaused = isGoPaused(now);
  const freePaused = isFreePaused(now);
  const resolved = resolveWorkerModel(modelString, now, goPaused, freePaused);
  // One tracked session may run on a free listing: when free is paused or the slot is
  // taken, the pick moves to its paid step.
  let selected = resolved.model;
  if (isFreeListing(selected) && (freePaused || freeSessionInUse(loadState(deps.statePath)))) {
    selected = paidStep(selected, goPaused) ?? selected;
  }
  assertAllowedModel(selected);
  const model = { ...splitModel(selected), variant: resolved.effortOverride ?? effort };
  if (modelString === 'auto') {
    console.log(`${task} auto -> ${selected}`);
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
    commitSpec(deps, worktree, file, `${task}: eval spec`);
  } else {
    const relative = path.posix.join('work', file);
    const committed = deps.runner.run(deps.repoRoot, ['cat-file', '-e', `HEAD:${relative}`]);
    if (!committed.ok) {
      // An uncommitted spec (untracked or staged) is committed on the task
      // branch and then removed from main, so the task lands as one commit.
      commitSpec(deps, worktree, file, `${task}: spec`);
      removeUncommittedSpec(deps, relative);
    }
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
      model: selected,
      role: 'worker',
      startedAt: new Date().toISOString(),
    });
  });
  return { sessionId, worktree };
}
