import fs from 'node:fs';
import path from 'node:path';
import { type OpenCodeClient } from './client.js';
import type { GitRunner } from './git.js';
import { loadPrompt, loadRulesFile, renderPrompt, unfilledPlaceholders } from './prompts.js';
import { loadState, saveState } from './state.js';
import { assertNotV4Pro, parseTaskFrontMatter, splitModel } from './task-file.js';
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

export async function launchTask(
  task: string,
  extraRulesFile: string | undefined,
  deps: LaunchDeps,
): Promise<{ sessionId: string; worktree: string }> {
  if (!/^T-\d+$/.test(task)) {
    throw new Error(`task must look like T-0038, got ${JSON.stringify(task)}`);
  }
  const file = findTaskFile(deps.repoRoot, task);
  const frontMatter = parseTaskFrontMatter(
    fs.readFileSync(path.join(deps.repoRoot, 'work', file), 'utf8'),
  );
  assertNotV4Pro(frontMatter.model);
  const model = splitModel(frontMatter.model);
  const worktree = path.join(path.dirname(path.resolve(deps.repoRoot)), `galena-${task}`);
  if (fs.existsSync(worktree)) {
    throw new Error(`worktree already exists: ${worktree}`);
  }
  const added = deps.runner.run(deps.repoRoot, [
    'worktree',
    'add',
    '-q',
    worktree,
    '-b',
    frontMatter.branch,
    'main',
  ]);
  if (!added.ok) {
    throw new Error(`git worktree add failed for ${worktree} (is ${frontMatter.branch} taken?)`);
  }
  const rules = loadRulesFile(path.join(deps.promptsDirPath, 'rules.json'));
  if (extraRulesFile !== undefined) {
    rules.push(...loadRulesFile(extraRulesFile));
  }
  const sessionId = await deps.client.createSession({
    title: `${task} (${file})`,
    agent: 'build',
    model,
    directory: worktree,
    permissions: rules,
  });
  const prompt = renderPrompt(loadPrompt(deps.promptsDirPath, 'worker'), {
    TASK: task,
    TASK_FILE: file,
    WORKTREE: worktree,
    BRANCH: frontMatter.branch,
  });
  const missing = unfilledPlaceholders(prompt).filter((name) =>
    ['TASK', 'TASK_FILE', 'WORKTREE', 'BRANCH'].includes(name),
  );
  if (missing.length > 0) {
    throw new Error(`worker prompt has unfilled placeholders: ${missing.join(', ')}`);
  }
  deps.client.promptDetached(sessionId, prompt);
  const state = loadState(deps.statePath);
  state.tasks[task] = newTaskRecord({
    task,
    sessionId,
    worktree,
    model: frontMatter.model,
    role: 'worker',
    startedAt: new Date().toISOString(),
  });
  saveState(deps.statePath, state);
  return { sessionId, worktree };
}
