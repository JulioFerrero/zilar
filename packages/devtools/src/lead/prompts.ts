import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Result, Schema } from 'effect';
import { permissionRulesSchema, schemaIssues, type PermissionRule } from './types.js';

export type PromptName =
  | 'worker'
  | 'switch'
  | 'resume'
  | 'nudge'
  | 'prereview'
  | 'prereview-resume'
  | 'scout'
  | 'qa'
  | 'autofix'
  | 'doctor'
  | 'doctor-resume'
  | 'fresh';

export function promptsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', '..', 'prompts');
}

export function loadPrompt(dir: string, name: PromptName): string {
  return fs.readFileSync(path.join(dir, `${name}.md`), 'utf8');
}

export function loadRulesFile(file: string): PermissionRule[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  const validated = Schema.decodeUnknownResult(permissionRulesSchema)(parsed);
  if (Result.isFailure(validated)) {
    const [first] = schemaIssues(validated.failure);
    throw new Error(`invalid rules file at ${file}: ${first?.message ?? 'unknown'}`);
  }
  return validated.success;
}

// Fills {{PLACEHOLDERS}} in a prompt template. Unknown placeholders are left
// alone; missing required ones are a caller bug, caught by tests.
export function renderPrompt(template: string, vars: Record<string, string>): string {
  let rendered = template;
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.split(`{{${key}}}`).join(value);
  }
  return rendered;
}

export function unfilledPlaceholders(rendered: string): string[] {
  const found = new Set<string>();
  for (const match of rendered.matchAll(/\{\{([A-Z_]+)\}\}/g)) {
    found.add(match[1] as string);
  }
  return [...found];
}
