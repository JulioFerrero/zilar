// Builds the data behind the Effect map: one entry per counted source file
// (its line count, its kind, the legacy libraries it still imports and the
// open tasks whose Allowed files cover it), plus per-package and total sums.
// Works in any checkout: the root comes from git, nothing lives in $HOME.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tokenMatcher } from '../gate/scope.js';

export type Kind = 'effect' | 'plain' | 'legacy';

export interface TaskRef {
  id: string;
  title: string;
  status: string;
}

export interface OpenTask extends TaskRef {
  matchers: RegExp[];
}

export interface SourceFile {
  path: string;
  lines: number;
  kind: Kind;
  legacy: string[];
  tasks: TaskRef[];
}

export interface Tally {
  files: number;
  lines: number;
}

export interface Summary {
  files: number;
  lines: number;
  kinds: Record<Kind, Tally>;
  effectFilesPct: number;
  effectLinesPct: number;
}

export interface PackageSummary extends Summary {
  name: string;
}

export interface TaskSummary extends TaskRef {
  files: number;
}

export interface EffectMap {
  generatedAt: string;
  commit: string;
  commitSubject: string;
  total: Summary;
  packages: PackageSummary[];
  tasks: TaskSummary[];
  files: SourceFile[];
}

const LEGACY_LIBS: ReadonlyArray<readonly [string, RegExp]> = [
  ['drizzle', /^drizzle-orm/],
  ['hono', /^(hono|@hono\/)/],
  ['zod', /^zod(\/|$)/],
  ['zustand', /^zustand/],
];
const IMPORT = /^\s*(import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/gm;
const EFFECT_MODULE = /^effect(\/|$)|^@effect\//;
const EXCLUDED = /\.test\.|\.spec\.|\/test\/|__tests__|\.d\.ts$|\.cosmos\.|fixtures|test-tables/;
const OPEN_STATUSES = ['todo', 'in-progress', 'review', 'blocked'];

export function isCountedSource(path: string): boolean {
  return (
    /\.(ts|tsx)$/.test(path) && !EXCLUDED.test(path) && /^(apps|packages|scripts)\//.test(path)
  );
}

// Legacy wins over Effect: a file that still imports one legacy library is
// not finished, even when it also imports Effect.
export function classifySource(source: string): { kind: Kind; legacy: string[] } {
  const legacy = new Set<string>();
  let effect = false;
  for (const match of source.matchAll(IMPORT)) {
    const isTypeOnly = Boolean(match[2]);
    const specifier = match[3] ?? '';
    if (EFFECT_MODULE.test(specifier)) effect = true;
    if (isTypeOnly) continue;
    for (const [name, pattern] of LEGACY_LIBS) {
      if (pattern.test(specifier)) legacy.add(name);
    }
  }
  const libs = [...legacy];
  if (libs.length > 0) return { kind: 'legacy', legacy: libs };
  return { kind: effect ? 'effect' : 'plain', legacy: [] };
}

// apps/server/src/x.ts -> apps/server; scripts/x.ts -> scripts.
export function packageOf(path: string): string {
  const parts = path.split('/');
  return parts[0] === 'scripts' ? 'scripts' : parts.slice(0, 2).join('/');
}

export interface BoardRow {
  id: string;
  file: string;
  title: string;
  status: string;
}

// A row of work/BOARD.md, e.g. `| [T-0752](T-0752-effect-map-pages.md) | title | in-progress | ... |`.
// Only the four open statuses count. Merged rows keep a date in that column,
// and the front matter of old task files is not trusted, so the board decides.
export function parseBoard(text: string): BoardRow[] {
  return text.split('\n').flatMap((line) => {
    const cells = line.split('|').map((cell) => cell.trim());
    const link = /^\[(T-\d{4})\]\((T-\d{4}-[\w.-]+\.md)\)$/.exec(cells[1] ?? '');
    const status = cells[3] ?? '';
    if (link === null || !OPEN_STATUSES.includes(status)) return [];
    return [{ id: link[1] ?? '', file: link[2] ?? '', title: cells[2] ?? '', status }];
  });
}

// The paths under "### Allowed files": backtick tokens with a slash or an
// extension, read up to the next heading, rule, or "**Not allowed" line.
export function allowedPaths(taskText: string): string[] {
  const lines = taskText.split('\n');
  const start = lines.findIndex((line) => /^### Allowed files\s*$/.test(line));
  if (start < 0) return [];
  const paths: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^(###|## |---)/.test(line) || line.startsWith('**Not allowed')) break;
    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      const token = (match[1] ?? '').trim();
      if (token.includes('/') || /\.[a-z]+$/i.test(token)) paths.push(token);
    }
  }
  return paths;
}

// An open task from its board row and its task file (empty text when the file is missing).
export function openTask(row: BoardRow, taskText: string): OpenTask {
  const full = /^title:\s*"?(.*?)"?\s*$/m.exec(taskText)?.[1] || row.title;
  const title = full.length > 120 ? `${full.slice(0, 119)}…` : full;
  return {
    id: row.id,
    title,
    status: row.status,
    matchers: allowedPaths(taskText).map(tokenMatcher),
  };
}

export function sourceFile(path: string, source: string, tasks: readonly OpenTask[]): SourceFile {
  const { kind, legacy } = classifySource(source);
  const covering = tasks
    .filter((task) => task.matchers.some((matcher) => matcher.test(path)))
    .map(({ id, title, status }) => ({ id, title, status }));
  return { path, lines: source.split('\n').length, kind, legacy, tasks: covering };
}

const share = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;

export function summarise(files: readonly SourceFile[]): Summary {
  const kinds: Record<Kind, Tally> = {
    effect: { files: 0, lines: 0 },
    plain: { files: 0, lines: 0 },
    legacy: { files: 0, lines: 0 },
  };
  let lines = 0;
  for (const file of files) {
    kinds[file.kind].files += 1;
    kinds[file.kind].lines += file.lines;
    lines += file.lines;
  }
  return {
    files: files.length,
    lines,
    kinds,
    effectFilesPct: share(kinds.effect.files, files.length),
    effectLinesPct: share(kinds.effect.lines, lines),
  };
}

export function packageSummaries(files: readonly SourceFile[]): PackageSummary[] {
  const byPackage = new Map<string, SourceFile[]>();
  for (const file of files) {
    const name = packageOf(file.path);
    byPackage.set(name, [...(byPackage.get(name) ?? []), file]);
  }
  return [...byPackage]
    .map(([name, list]) => ({ name, ...summarise(list) }))
    .sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));
}

export function taskSummaries(
  tasks: readonly OpenTask[],
  files: readonly SourceFile[],
): TaskSummary[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    for (const task of file.tasks) counts.set(task.id, (counts.get(task.id) ?? 0) + 1);
  }
  return tasks
    .map(({ id, title, status }) => ({ id, title, status, files: counts.get(id) ?? 0 }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function buildEffectMap(input: {
  files: readonly SourceFile[];
  tasks: readonly OpenTask[];
  generatedAt: string;
  commit: string;
  commitSubject: string;
}): EffectMap {
  return {
    generatedAt: input.generatedAt,
    commit: input.commit,
    commitSubject: input.commitSubject,
    total: summarise(input.files),
    packages: packageSummaries(input.files),
    tasks: taskSummaries(input.tasks, input.files),
    files: [...input.files],
  };
}

export function repoRoot(cwd: string = process.cwd()): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
}

function readOpenTasks(root: string): OpenTask[] {
  const dir = join(root, 'work');
  return parseBoard(readFileSync(join(dir, 'BOARD.md'), 'utf8')).map((row) => {
    const path = join(dir, row.file);
    return openTask(row, existsSync(path) ? readFileSync(path, 'utf8') : '');
  });
}

function listCountedSources(root: string): string[] {
  return execFileSync('git', ['ls-files'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(isCountedSource);
}

export function generateEffectMap(root: string = repoRoot()): EffectMap {
  const tasks = readOpenTasks(root);
  const files = listCountedSources(root).map((path) =>
    sourceFile(path, readFileSync(join(root, path), 'utf8'), tasks),
  );
  const head = execFileSync('git', ['log', '-1', '--format=%h%x09%s'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const [commit = '', commitSubject = ''] = head.split('\t');
  return buildEffectMap({
    files,
    tasks,
    generatedAt: new Date().toISOString(),
    commit,
    commitSubject,
  });
}
