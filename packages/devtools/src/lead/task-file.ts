import { taskFrontMatterSchema, type TaskFrontMatter } from './types.js';

// The task files are markdown with a small YAML front matter block. There is
// no YAML dependency allowed, so this parses only the flat `key: value` lines
// the lead tools need. Anything fancier (nested maps) is left unread.
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
  const parsed = taskFrontMatterSchema.safeParse(parseFrontMatter(text));
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'front matter'}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid task front matter: ${detail}`);
  }
  return parsed.data;
}

// Splits "providerID/modelID" from the task's `model:` field.
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

// The one gate every launch path goes through: banned or costly models never
// reach a worker session.
export function assertAllowedModel(model: string): void {
  assertNotV4Pro(model);
  if (isCostlyMetaModel(model)) {
    throw new Error(
      `refusing model ${JSON.stringify(model)}: only meta/muse-spark-1.3-contributor is allowed on the Meta Model API (the standard tier costs far more)`,
    );
  }
}

// Returns the text under the "Blocked / needs a decision" subsection of the
// Report, or an empty string when there is none.
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
