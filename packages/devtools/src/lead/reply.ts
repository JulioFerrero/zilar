import fs from 'node:fs';
import { type OpenCodeClient } from './client.js';
import { loadState } from './state.js';

export interface ReplyDeps {
  client: OpenCodeClient;
  statePath: string;
}

// Answers a waiting worker: interrupts its session, then re-prompts with the
// lead's text. There is no API to answer a `question` tool call directly, so
// interrupt-plus-prompt is the whole mechanism.
export async function replyToWorker(
  task: string,
  promptFile: string,
  deps: ReplyDeps,
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
  await deps.client.interrupt(record.sessionId);
  deps.client.promptDetached(record.sessionId, text);
}
