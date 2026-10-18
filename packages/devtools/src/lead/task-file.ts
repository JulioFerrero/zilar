import fs from 'node:fs';
import path from 'node:path';
import { Result, Schema } from 'effect';
import { isFreeListing, isFreePaused, paidStep } from './free-pause.js';
import { isGoPaused, withoutPausedGoModel, type ModelRef } from './go-pause.js';
import { freeSessionInUse, loadState, type FreeSessionScope } from './state.js';
import type { StateFile } from './types.js';
import { schemaIssues, taskFrontMatterSchema, type TaskFrontMatter } from './types.js';
import { GO_MUSE } from './models.js';

// A running task's spec lives in its worktree; a queued one on main. Callers pass the
// result to `findTaskFile`.
export function taskFileDir(repoRoot: string, task: string, statePath: string): string {
  const record = loadState(statePath).tasks[task];
  if (record !== undefined && fs.existsSync(path.join(record.worktree, 'work'))) {
    return record.worktree;
  }
  return repoRoot;
}

// Front matter is flat `key: value`; there is no YAML dependency, so nested maps stay
// unread.
export function parseFrontMatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (match === null) {
    throw new Error('task file has no front matter block');
  }
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const field = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line.trim());
    if (field !== null) {
      fields[field[1] as string] = (field[2] as string).trim();
    }
  }
  return fields;
}

export function parseTaskFrontMatter(text: string): TaskFrontMatter {
  const parsed = Schema.decodeUnknownResult(taskFrontMatterSchema)(parseFrontMatter(text));
  if (Result.isFailure(parsed)) {
    const detail = schemaIssues(parsed.failure)
      .map((issue) => `${issue.path || 'front matter'}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid task front matter: ${detail}`);
  }
  return parsed.success;
}

export function splitModel(model: string): { providerID: string; id: string } {
  const slash = model.indexOf('/');
  if (slash <= 0 || slash === model.length - 1) {
    throw new Error(`model must look like providerID/modelID, got ${JSON.stringify(model)}`);
  }
  return { providerID: model.slice(0, slash), id: model.slice(slash + 1) };
}

// Julio's rule (2026-09-28): never use DeepSeek V4 Pro, in any form.
export function isV4Pro(model: string): boolean {
  return /v4.?pro/i.test(model);
}

export function assertNotV4Pro(model: string): void {
  if (isV4Pro(model)) {
    throw new Error(`refusing model ${JSON.stringify(model)}: DeepSeek V4 Pro is banned`);
  }
}

// Julio's rule (2026-09-29): on the Meta Model API only the `-contributor`
// tier of Muse Spark may be used; the standard tier costs about 12 to 20 times
// more per token.
export function isCostlyMetaModel(model: string): boolean {
  return /^meta\//i.test(model) && !/-contributor$/i.test(model);
}

export function assertAllowedModel(model: string): void {
  assertNotV4Pro(model);
  if (isCostlyMetaModel(model)) {
    throw new Error(
      `refusing model ${JSON.stringify(model)}: only meta/muse-spark-1.3-contributor is allowed on the Meta Model API (the standard tier costs far more)`,
    );
  }
}

// The pre-review and doctor use the free Muse by default; `ZILAR_REVIEW_MODEL` points
// them at the billed fallback, read at call time. While free listings are paused the
// default is the Go Muse, or the paid Muse while Go is paused too.
export function reviewModel(
  env: NodeJS.ProcessEnv = process.env,
  freePaused = false,
): {
  providerID: string;
  id: string;
} {
  const override = env.ZILAR_REVIEW_MODEL;
  if (override !== undefined && override !== '') {
    assertAllowedModel(override);
    return splitModel(override);
  }
  return splitModel(freePaused ? GO_MUSE : 'opencode/muse-spark-1.3-contributor-free');
}

// The model a pre-review or doctor starts on: free Muse while it is open and no other
// tracked session holds it, else the paid step of its chain.
export function reviewSessionModel(state: StateFile, scope: FreeSessionScope = {}): ModelRef {
  const goPaused = isGoPaused();
  const freePaused = isFreePaused();
  let model = withoutPausedGoModel(reviewModel(process.env, freePaused), goPaused);
  const id = `${model.providerID}/${model.id}`;
  if (isFreeListing(id) && freeSessionInUse(state, scope)) {
    const paid = paidStep(id, goPaused);
    if (paid !== undefined) {
      model = splitModel(paid);
    }
  }
  return model;
}

export function extractBlockedText(text: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^#+\s*blocked\s*\/\s*needs a decision/i.test(line));
  if (start === -1) {
    return '';
  }
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#+\s/.test(line)) {
      break;
    }
    collected.push(line);
  }
  return collected.join('\n').trim();
}

// Paths where a subtle mistake costs more than the extra thinking time:
// schema and migrations, auth, crypto, the XMPP server config.
const RISKY_PATHS = /schema\.ts|drizzle|\/auth\/|crypto|ejabberd|authz/i;

// `effort:` wins; otherwise `high` when the Allowed files touch risky paths or the
// estimate is 3 days or more, `low` for a clear, contained job.
export function pickEffort(taskText: string, explicit: string | undefined): string {
  if (explicit !== undefined) {
    return explicit;
  }
  const allowed = /###\s*Allowed files\s*\n([\s\S]*?)(?=\n#{2,3}\s|$)/i.exec(taskText)?.[1] ?? '';
  if (RISKY_PATHS.test(allowed)) {
    return 'high';
  }
  const days = /^estimate:\s*([\d.]+)\s*day/im.exec(taskText)?.[1];
  return days !== undefined && Number(days) >= 3 ? 'high' : 'low';
}
