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

// Answers a waiting worker: interrupts its session, then re-prompts with the
// lead's text. There is no API to answer a `question` tool call directly, so
// interrupt-plus-prompt is the whole mechanism. With `fresh`, the lead's text
// goes to a new session instead: the old one is interrupted, a fresh session
// is opened in the same worktree with the `fresh` template plus the lead's
// text, and the state points at the new session.
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
  // Every local check runs before the interrupt, so a typo or a missing
  // file never stops the old worker without a replacement (switch-model.ts
  // does the same). The prompt bytes are identical either way.
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
