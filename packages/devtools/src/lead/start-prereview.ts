import fs from 'node:fs';
import path from 'node:path';
import { type OpenCodeClient } from './client.js';
import { findTaskFile } from './launch.js';
import { loadPrompt, loadRulesFile, renderPrompt } from './prompts.js';
import { loadState, stateFilePath } from './state.js';
import { parseTaskFrontMatter, reviewSessionModel } from './task-file.js';

// The pre-review is always Muse, the strongest reader (§5.1); the exported default
// keeps tests honest, the live call site uses reviewSessionModel().
export const PREREVIEW_MODEL = { providerID: 'opencode', id: 'muse-spark-1.3-contributor-free' };

export interface PrereviewDeps {
  client: OpenCodeClient;
  promptsDirPath: string;
  worktree: string;
  task: string;
}

export interface PrereviewSession {
  sessionId: string;
  model: string;
}

// Starts a Muse pre-review session in the task's worktree; it writes PREREVIEW.md.
export async function startPrereviewSession(
  deps: PrereviewDeps,
  head: string,
): Promise<PrereviewSession> {
  if (!fs.existsSync(deps.worktree)) {
    throw new Error(`worktree is gone: ${deps.worktree}`);
  }
  const file = findTaskFile(deps.worktree, deps.task);
  const frontMatter = parseTaskFrontMatter(
    fs.readFileSync(path.join(deps.worktree, 'work', file), 'utf8'),
  );
  const prompt = renderPrompt(loadPrompt(deps.promptsDirPath, 'prereview'), {
    TASK: deps.task,
    TASK_FILE: file,
    WORKTREE: deps.worktree,
    BRANCH: frontMatter.branch,
    HEAD: head,
    SHORT_HEAD: head.slice(0, 7),
    BASE: 'main',
  });
  // No record of its own yet, so it counts every tracked session including its own task's
  // worker: with a free worker running, the pair must not both start free.
  const model = reviewSessionModel(loadState(stateFilePath()));
  const sessionId = await deps.client.createSession({
    title: `${deps.task} pre-review ${head.slice(0, 7)}`,
    agent: 'build',
    model,
    directory: deps.worktree,
    permissions: loadRulesFile(path.join(deps.promptsDirPath, 'rules.json')),
  });
  deps.client.promptDetached(sessionId, prompt);
  return { sessionId, model: `${model.providerID}/${model.id}` };
}
