import fs from 'node:fs';
import path from 'node:path';
import { type OpenCodeClient } from './client.js';
import { findTaskFile } from './launch.js';
import { loadPrompt, loadRulesFile, renderPrompt } from './prompts.js';
import { parseTaskFrontMatter } from './task-file.js';

// The pre-review is always Muse: the strongest reader, per §5.1.
export const PREREVIEW_MODEL = { providerID: 'meta', id: 'muse-spark-1.3-contributor' };

export interface PrereviewDeps {
  client: OpenCodeClient;
  promptsDirPath: string;
  worktree: string;
  task: string;
}

// Starts a Muse pre-review session in the task's worktree. It writes
// PREREVIEW.md and changes nothing else; the autopilot records the session
// id against the worker's HEAD commit.
export async function startPrereviewSession(deps: PrereviewDeps, head: string): Promise<string> {
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
  const sessionId = await deps.client.createSession({
    title: `${deps.task} pre-review ${head.slice(0, 7)}`,
    agent: 'build',
    model: PREREVIEW_MODEL,
    directory: deps.worktree,
    permissions: loadRulesFile(path.join(deps.promptsDirPath, 'rules.json')),
  });
  deps.client.promptDetached(sessionId, prompt);
  return sessionId;
}
