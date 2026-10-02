import fs from 'node:fs';
import path from 'node:path';
import { type OpenCodeClient, type SessionModel } from './client.js';
import type { GitRunner } from './git.js';
import { loadPrompt, loadRulesFile, renderPrompt, unfilledPlaceholders } from './prompts.js';
import { loadState, saveState } from './state.js';
import { assertAllowedModel, parseTaskFrontMatter, pickEffort, splitModel } from './task-file.js';
import { newTaskRecord } from './types.js';

export interface LaunchDeps {
  repoRoot: string;
  client: OpenCodeClient;
  promptsDirPath: string;
  statePath: string;
  runner: GitRunner;
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

export async function launchTask(
  task: string,
  extraRulesFile: string | undefined,
  deps: LaunchDeps,
): Promise<{ sessionId: string; worktree: string }> {
  if (!/^T-\d+$/.test(task)) {
    throw new Error(`task must look like T-0038, got ${JSON.stringify(task)}`);
  }
  const { file, model: modelString, branch, effort } = readTaskFrontMatter(deps.repoRoot, task);
  assertAllowedModel(modelString);
  const model = { ...splitModel(modelString), variant: effort };
  const worktree = worktreeFor(deps.repoRoot, task);
  if (fs.existsSync(worktree)) {
    throw new Error(`worktree already exists: ${worktree}`);
  }
  const added = deps.runner.run(deps.repoRoot, [
    'worktree',
    'add',
    '-q',
    worktree,
    '-b',
    branch,
    'main',
  ]);
  if (!added.ok) {
    throw new Error(`git worktree add failed for ${worktree} (is ${branch} taken?)`);
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
  const state = loadState(deps.statePath);
  state.tasks[task] = newTaskRecord({
    task,
    sessionId,
    worktree,
    model: modelString,
    role: 'worker',
    startedAt: new Date().toISOString(),
  });
  saveState(deps.statePath, state);
  return { sessionId, worktree };
}
