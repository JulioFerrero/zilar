import fs from 'node:fs';
import path from 'node:path';
import { type OpenCodeClient } from './client.js';
import { freshSessionRecord, startFreshWorkerSession } from './fresh-session.js';
import { findTaskFile } from './launch.js';
import { loadPrompt, renderPrompt } from './prompts.js';
import { loadState, updateState } from './state.js';
import { parseFrontMatter } from './task-file.js';

export interface ReplyDeps {
  client: OpenCodeClient;
  statePath: string;
  promptsDirPath: string;
  repoRoot: string;
}

// There is no API to answer a `question` call directly, so the mechanism is interrupt,
// then re-prompt with the lead's text. With `fresh`, that text opens a new session in
// the same worktree and the state points at it.
export async function replyToWorker(
  task: string,
  promptFile: string,
  deps: ReplyDeps,
  options?: { fresh?: boolean },
): Promise<void> {
  const state = loadState(deps.statePath);
  const record = state.tasks[task];
  if (record === undefined) {
    throw new Error(`unknown task ${task}: no session in the state file`);
  }
  let text: string;
  try {
    text = fs.readFileSync(promptFile, 'utf8');
  } catch {
    throw new Error(`cannot read prompt file ${promptFile}`);
  }
  if (text.trim().length === 0) {
    throw new Error(`prompt file ${promptFile} is empty`);
  }
  if (options?.fresh !== true) {
    await deps.client.interrupt(record.sessionId);
    deps.client.promptDetached(record.sessionId, text);
    return;
  }
  // Every local check runs before the interrupt, so a typo never stops the old worker
  // without a replacement.
  const file = findTaskFile(record.worktree, task);
  const fields = parseFrontMatter(
    fs.readFileSync(path.join(record.worktree, 'work', file), 'utf8'),
  );
  const head = renderPrompt(loadPrompt(deps.promptsDirPath, 'fresh'), {
    TASK: task,
    TASK_FILE: file,
    WORKTREE: record.worktree,
    BRANCH: fields['branch'] ?? '',
  });
  const outcome = await deps.client.tryInterrupt(record.sessionId);
  if (outcome.kind === 'error') {
    throw new Error(
      `refusing to reply fresh to ${task}: cannot interrupt the previous session (${record.sessionId}): ${outcome.message}`,
    );
  }
  const previousSessionId = record.sessionId;
  const { sessionId, model } = await startFreshWorkerSession(
    { client: deps.client, promptsDirPath: deps.promptsDirPath, repoRoot: deps.repoRoot },
    { task, record, title: `${task} reply`, prompt: `${head}\n\n${text}` },
  );
  updateState(deps.statePath, (fresh) => {
    const current = fresh.tasks[task];
    if (current !== undefined && current.sessionId === previousSessionId) {
      fresh.tasks[task] = freshSessionRecord(current, sessionId, model);
    }
  });
}
