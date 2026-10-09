// Builds the data behind the Effect map: one entry per counted source file
// (its line count, its kind, the signals that make it need Effect, the legacy
// libraries it still imports and the open tasks whose Allowed files cover it),
// plus per-package and total sums. The rule is docs/audit/effect-100-plan.md §1.4.
// Works in any checkout: the root comes from git, nothing lives in $HOME.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Result, Schema } from 'effect';
import { tokenMatcher } from '../gate/scope.js';

export type Kind = 'effect' | 'needs-effect' | 'plain' | 'exempt' | 'legacy';

export interface TaskRef {
  id: string;
  title: string;
  status: string;
}

export interface OpenTask extends TaskRef {
  matchers: RegExp[];
}

export interface SignalHit {
  id: string;
  line: number;
  text: string;
}

export interface SourceFile {
  path: string;
  lines: number;
  kind: Kind;
  legacy: string[];
  /** Ids of the signals hit anywhere in the file (H = hard, W = weak), in SIGNAL_IDS order. */
  signals: string[];
  /** The first line that hits a signal, its text trimmed to 120 characters. */
  firstHit: { line: number; text: string } | null;
  /** An Effect file that still contains a hard signal: a Promise edge, tracked not failed. */
  tierB: boolean;
  /** The reason of the `// effect-plain:` marker in the first 15 lines, or null. */
  marker: string | null;
  tasks: TaskRef[];
}

export interface Tally {
  files: number;
  lines: number;
}

export interface Marker {
  path: string;
  reason: string;
}

export interface Summary {
  files: number;
  lines: number;
  kinds: Record<Kind, Tally>;
  effectFilesPct: number;
  /** Share of all counted lines that are Effect lines (the secondary figure). */
  effectLinesPct: number;
  /** Effect lines / (Effect lines + needs-effect lines), in percent; 100 when both are 0. */
  coveragePct: number;
  tierB: Tally;
  /** needs-effect files whose only hits are weak signals. */
  needsWeak: Tally;
  markers: Marker[];
  markersOverBudget: boolean;
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
  markerBudget: number;
  total: Summary;
  packages: PackageSummary[];
  tasks: TaskSummary[];
  files: SourceFile[];
}

export const MARKER_BUDGET = 25;

const LEGACY_LIBS: ReadonlyArray<readonly [string, RegExp]> = [
  ['drizzle', /^drizzle-orm/],
  ['hono', /^(hono|@hono\/)/],
  ['zod', /^zod(\/|$)/],
  ['zustand', /^zustand/],
];
const IMPORT = /^\s*(import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/gm;
const EFFECT_MODULE = /^effect(\/|$)|^@effect\//;
const EXCLUDED =
  /\.test\.|\.spec\.|\/test\/|__tests__|\.d\.ts$|\.cosmos\.|\.fixture\.|fixtures|test-tables|(^|\/)(test-harness|test-support)\.ts$|(^|\/)fake-[^/]*\.ts$/;
const EXEMPT_PATHS: readonly RegExp[] = [
  /(^|\/)mock\//,
  /-mock\.ts$/,
  /\.config\.ts$/,
  /^apps\/mobile\/(ios|android|scripts)\//,
  /^apps\/site\//,
  /^packages\/devtools\//,
];
const MARKER = /^\s*\/\/\s*effect-plain:\s*(\S.*?)\s*$/;
const MARKER_LINES = 15;
const OPEN_STATUSES = ['todo', 'in-progress', 'review', 'blocked'];
const SIGNAL_IDS = ['H1', 'H2', 'H3', 'H5', 'H8', 'H9', 'W4', 'W6', 'W7'];

interface Signal {
  id: string;
  pattern: RegExp;
}

// Run on the code with strings and comments blanked, one line at a time.
const LINE_SIGNALS: readonly Signal[] = [
  {
    id: 'H1',
    pattern:
      /\basync\b|\bawait\b|\bnew Promise\b|\.then\(|\bPromise\.(?:all|allSettled|race|any|resolve|reject)\b/,
  },
  {
    id: 'H2',
    pattern:
      /(?<![\w.$])fetch\(|\bXMLHttpRequest\b|\bnew (?:WebSocket|EventSource)\b|\bsendBeacon\(/,
  },
  { id: 'H3', pattern: /\b(?:setTimeout|setInterval|setImmediate|requestIdleCallback)\(/ },
  { id: 'H5', pattern: /\b(?:localStorage|sessionStorage|AsyncStorage|indexedDB)\b/ },
  { id: 'W4', pattern: /\btry\s*\{|\.catch\(|\bcatch\s*(?:\(|\{)/ },
  { id: 'W6', pattern: /\bJSON\.parse\(/ },
  { id: 'W7', pattern: /\bprocess\.env\b|\bimport\.meta\.env\b|\bEXPO_PUBLIC_\w+/ },
];

// Run on the module specifier of each value import (type-only imports are erased).
const IMPORT_SIGNALS: readonly Signal[] = [
  {
    id: 'H8',
    pattern:
      /^(?:node:)?(?:fs|fs\/promises|child_process|net|http|https|http2|os|worker_threads|dgram|dns|tls|readline|stream|zlib)$/,
  },
  {
    id: 'H9',
    pattern:
      /^(?:expo-(?:file-system|secure-store|notifications|av|audio|image-picker|document-picker|media-library|camera|contacts|clipboard|sharing|location|haptics|crypto)|@react-native-async-storage\/async-storage|react-native-mmkv)(?:\/|$)/,
  },
];

// Strings (kept as empty quotes), line comments and block comments (kept as
// blank lines) are blanked in one left-to-right pass, so `'http://x'` is a string
// and not a comment. Template literals are kept as they are, as §1.4 says.
const NON_CODE =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

export function blankNonCode(source: string): string {
  return source.replace(NON_CODE, (token) => {
    if (token.startsWith('/*')) return token.replace(/[^\n]/g, ' ');
    if (token.startsWith('//')) return '';
    if (token.startsWith('`')) return token;
    return `${token[0]}${token[0]}`;
  });
}

const isHard = (id: string): boolean => id.startsWith('H');

export function isCountedSource(path: string): boolean {
  return (
    /\.(ts|tsx)$/.test(path) && !EXCLUDED.test(path) && /^(apps|packages|scripts)\//.test(path)
  );
}

export function isExemptPath(path: string): boolean {
  return EXEMPT_PATHS.some((pattern) => pattern.test(path));
}

// The reason of a `// effect-plain: <reason>` marker in the first 15 lines, or null.
export function markerReason(source: string): string | null {
  for (const line of source.split('\n', MARKER_LINES)) {
    const reason = MARKER.exec(line)?.[1];
    if (reason !== undefined) return reason;
  }
  return null;
}

interface ImportRef {
  specifier: string;
  typeOnly: boolean;
  line: number;
}

function importRefs(source: string): ImportRef[] {
  return [...source.matchAll(IMPORT)].map((match) => {
    const start = (match.index ?? 0) + (match[0].length - match[0].trimStart().length);
    return {
      specifier: match[3] ?? '',
      typeOnly: Boolean(match[2]),
      line: source.slice(0, start).split('\n').length,
    };
  });
}

// Legacy wins over Effect: a file that still imports one legacy library is
// not finished, even when it also imports Effect. Only value imports count,
// so `import type { Effect }` is not Effect.
export function classifySource(source: string): {
  kind: 'effect' | 'plain' | 'legacy';
  legacy: string[];
} {
  const legacy = new Set<string>();
  let effect = false;
  for (const ref of importRefs(source)) {
    if (ref.typeOnly) continue;
    if (EFFECT_MODULE.test(ref.specifier)) effect = true;
    for (const [name, pattern] of LEGACY_LIBS) {
      if (pattern.test(ref.specifier)) legacy.add(name);
    }
  }
  const libs = [...legacy];
  if (libs.length > 0) return { kind: 'legacy', legacy: libs };
  return { kind: effect ? 'effect' : 'plain', legacy: [] };
}

// Every signal hit with its line. Hits in comments and strings are blanked first.
export function signalHits(source: string): SignalHit[] {
  const lines = source.split('\n');
  const code = blankNonCode(source).split('\n');
  const hits: SignalHit[] = [];
  code.forEach((codeLine, index) => {
    for (const signal of LINE_SIGNALS) {
      if (signal.pattern.test(codeLine)) {
        hits.push({ id: signal.id, line: index + 1, text: lines[index] ?? '' });
      }
    }
  });
  for (const ref of importRefs(source)) {
    if (ref.typeOnly) continue;
    for (const signal of IMPORT_SIGNALS) {
      if (signal.pattern.test(ref.specifier)) {
        hits.push({ id: signal.id, line: ref.line, text: lines[ref.line - 1] ?? '' });
      }
    }
  }
  return hits;
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

function kindOf(
  path: string,
  importKind: 'effect' | 'plain' | 'legacy',
  marker: string | null,
  signals: readonly string[],
): Kind {
  if (importKind === 'legacy') return 'legacy';
  if (isExemptPath(path) || marker !== null) return 'exempt';
  if (importKind === 'effect') return 'effect';
  return signals.length > 0 ? 'needs-effect' : 'plain';
}

export function sourceFile(path: string, source: string, tasks: readonly OpenTask[]): SourceFile {
  const hits = signalHits(source);
  const signals = SIGNAL_IDS.filter((id) => hits.some((hit) => hit.id === id));
  const first = hits.reduce<SignalHit | null>(
    (best, hit) => (best === null || hit.line < best.line ? hit : best),
    null,
  );
  const { kind: importKind, legacy } = classifySource(source);
  const marker = markerReason(source);
  const kind = kindOf(path, importKind, marker, signals);
  const covering = tasks
    .filter((task) => task.matchers.some((matcher) => matcher.test(path)))
    .map(({ id, title, status }) => ({ id, title, status }));
  return {
    path,
    lines: source.split('\n').length,
    kind,
    legacy,
    signals,
    firstHit: first === null ? null : { line: first.line, text: first.text.trim().slice(0, 120) },
    tierB: kind === 'effect' && signals.some(isHard),
    marker,
    tasks: covering,
  };
}

const share = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;

const coverage = (effectLines: number, needsEffectLines: number): number => {
  const whole = effectLines + needsEffectLines;
  return whole === 0 ? 100 : share(effectLines, whole);
};

const emptyTally = (): Tally => ({ files: 0, lines: 0 });

function bump(tally: Tally, lines: number): void {
  tally.files += 1;
  tally.lines += lines;
}

export function summarise(files: readonly SourceFile[]): Summary {
  const kinds: Record<Kind, Tally> = {
    effect: emptyTally(),
    'needs-effect': emptyTally(),
    plain: emptyTally(),
    exempt: emptyTally(),
    legacy: emptyTally(),
  };
  const tierB = emptyTally();
  const needsWeak = emptyTally();
  let lines = 0;
  for (const file of files) {
    bump(kinds[file.kind], file.lines);
    lines += file.lines;
    if (file.tierB) bump(tierB, file.lines);
    if (file.kind === 'needs-effect' && !file.signals.some(isHard)) bump(needsWeak, file.lines);
  }
  const markers = files.flatMap((file) =>
    file.marker === null ? [] : [{ path: file.path, reason: file.marker }],
  );
  return {
    files: files.length,
    lines,
    kinds,
    effectFilesPct: share(kinds.effect.files, files.length),
    effectLinesPct: share(kinds.effect.lines, lines),
    coveragePct: coverage(kinds.effect.lines, kinds['needs-effect'].lines),
    tierB,
    needsWeak,
    markers,
    markersOverBudget: markers.length > MARKER_BUDGET,
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
    markerBudget: MARKER_BUDGET,
    total: summarise(input.files),
    packages: packageSummaries(input.files),
    tasks: taskSummaries(input.tasks, input.files),
    files: [...input.files],
  };
}

const NeedsEffectBaseline = Schema.Struct({ needsEffectFiles: Schema.Number });

// The ratchet (task R6): a message when the map has more needs-effect files
// than the baseline allows, or null when it is within the baseline.
export function checkNeedsEffectBaseline(map: EffectMap, json: string): string | null {
  const parsed: unknown = JSON.parse(json);
  const decoded = Schema.decodeUnknownResult(NeedsEffectBaseline)(parsed);
  if (Result.isFailure(decoded)) return 'baseline must be JSON {"needsEffectFiles": number}';
  const allowed = decoded.success.needsEffectFiles;
  const current = map.total.kinds['needs-effect'].files;
  return current > allowed ? `needs-effect files ${current} exceed the baseline ${allowed}` : null;
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
