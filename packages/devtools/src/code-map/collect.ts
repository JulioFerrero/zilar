// Collects the data behind the Code map page (T-0938): every file in scope with
// its line count and class, the daily history of lines per class, the recent
// T-NNNN commits with their diff sizes, and the per-package and biggest-file
// tables. Pure git and filesystem reads; the page only reads the JSON written
// beside it.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../effect-map/generate.js';

export type FileClass = 'source' | 'test' | 'mock' | 'generated';
export type Band = 'green' | 'amber' | 'orange' | 'red';

/** Julio's per-file limit: a source file over this is on the page in red. */
export const LINE_LIMIT = 400;

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

export interface CodeFile {
  path: string;
  lines: number;
  cls: FileClass;
  /** The size band for source files, null for test, mock and generated files. */
  band: Band | null;
  /** Lines added minus removed in the last 7 days; 0 when the file did not change. */
  delta7: number;
}

export interface HistoryPoint {
  date: string;
  source: number;
  test: number;
  mock: number;
}

export interface MergeCommit {
  sha: string;
  id: string;
  title: string;
  added: number;
  removed: number;
  created: number;
  deleted: number;
  net: number;
}

export interface PackageStat {
  name: string;
  files: number;
  sourceLines: number;
  testLines: number;
  over400: number;
  biggest: { path: string; lines: number } | null;
}

export interface ClassCount {
  files: number;
  lines: number;
}

export interface CodeMap {
  generatedAt: string;
  commit: string;
  commitSubject: string;
  lineLimit: number;
  totals: { files: number; over400: number; byClass: Record<FileClass, ClassCount> };
  /** Source lines now minus source lines seven days ago (negative is a cut). */
  week: { sourceDelta: number };
  files: CodeFile[];
  history: HistoryPoint[];
  merges: MergeCommit[];
  packages: PackageStat[];
  biggest: CodeFile[];
}

const SCOPED = /^(?:apps\/[^/]+\/src\/|packages\/[^/]+\/src\/|packages\/mock-backend\/)/;
const CODE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
// A test file: `*.test.*`, anything under a `test/` folder, or a `test-support`
// helper. A mock: a `mock/` folder, `mockStore`, `*-mock.ts`, the mobile chat
// store, or the shared mock backend. A generated file: a `.d.ts`, a `generated/`
// folder, or a `*.gen.*` / `*.generated.*` name.
const TEST = /\.test\.[tj]sx?$|(^|\/)test\/|test-support/;
const MOCK =
  /(^|\/)mock\/|mockStore|-mock\.[tj]sx?$|^packages\/mock-backend\/|^apps\/mobile\/src\/store\/chat-store\.ts$/;
const GENERATED = /\.d\.[tj]s$|(^|\/)generated\/|\.(?:generated|gen)\.[tj]sx?$/;

export function isScoped(path: string): boolean {
  return SCOPED.test(path) && CODE.test(path);
}

export function classify(path: string): FileClass {
  if (TEST.test(path)) return 'test';
  if (MOCK.test(path)) return 'mock';
  if (GENERATED.test(path)) return 'generated';
  return 'source';
}

export function bandOf(lines: number): Band {
  if (lines <= LINE_LIMIT) return 'green';
  if (lines <= 600) return 'amber';
  if (lines <= 1000) return 'orange';
  return 'red';
}

/** The number of lines in a text file: a trailing newline does not add one. */
export function countLines(source: string): number {
  if (source === '') return 0;
  const body = source.endsWith('\n') ? source.slice(0, -1) : source;
  return body.split('\n').length;
}

function packageOf(path: string): string {
  return path.split('/').slice(0, 2).join('/');
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// The dates as `YYYY-MM-DD`, offset from a day, at UTC midnight so the step is
// exactly one day across any timezone.
function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function listDays(first: string, last: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${last}T00:00:00Z`);
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= end; t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

interface GitNumbers {
  /** Lines added minus removed per class and day, as [source, test, mock]. */
  nets: Map<string, [number, number, number]>;
  /** Lines added minus removed per file over the last 7 days. */
  delta7: Map<string, number>;
  firstDate: string;
  lastDate: string;
}

const CLASS_INDEX: Record<FileClass, number> = { source: 0, test: 1, mock: 2, generated: -1 };

// One `git log --numstat` pass over the checked-out commit gives both the daily
// nets for the history and the per-file 7-day deltas. `--no-renames` keeps a
// rename two plain lines (a delete of the old path, an add of the new one), so
// the sums stay right; binary files report `-` and are counted as zero.
function readGitNumbers(root: string): GitNumbers {
  const lastDate = git(root, ['log', '-1', '--format=%cI']).slice(0, 10);
  const cutoff = shiftDate(lastDate, -WEEK_DAYS);
  const nets = new Map<string, [number, number, number]>();
  const delta7 = new Map<string, number>();
  let date = '';
  let firstDate = lastDate;
  for (const line of git(root, ['log', '--no-renames', '--numstat', '--format=@@%cI']).split(
    '\n',
  )) {
    if (line.startsWith('@@')) {
      date = line.slice(2, 12);
      firstDate = date;
      continue;
    }
    const parts = line.split('\t');
    if (date === '' || parts.length < 3) continue;
    const path = parts.slice(2).join('\t');
    if (!isScoped(path)) continue;
    const cls = classify(path);
    const index = CLASS_INDEX[cls];
    if (index < 0) continue;
    const added = parts[0] === '-' ? 0 : Number(parts[0]);
    const removed = parts[1] === '-' ? 0 : Number(parts[1]);
    if (!Number.isFinite(added) || !Number.isFinite(removed)) continue;
    const net = nets.get(date) ?? [0, 0, 0];
    net[index] = (net[index] ?? 0) + added - removed;
    nets.set(date, net);
    if (date >= cutoff) delta7.set(path, (delta7.get(path) ?? 0) + added - removed);
  }
  return { nets, delta7, firstDate, lastDate };
}

// The current totals walked back one day at a time, so the last point is the
// exact line counts on disk and the first is the day before the first commit.
function buildHistory(net: GitNumbers, current: [number, number, number]): HistoryPoint[] {
  const days = listDays(net.firstDate, net.lastDate);
  const values = new Map<string, [number, number, number]>();
  let value = current;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    values.set(days[i] ?? '', value);
    const dayNet = net.nets.get(days[i] ?? '') ?? [0, 0, 0];
    value = [value[0] - dayNet[0], value[1] - dayNet[1], value[2] - dayNet[2]];
  }
  return days.map((date) => {
    const point = values.get(date) ?? [0, 0, 0];
    return { date, source: point[0], test: point[1], mock: point[2] };
  });
}

// `added\tremoved\tpath` lines for one commit; `-` is a binary file.
function numstatFor(root: string, sha: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of git(root, ['show', '--no-renames', '--numstat', '--format=', sha]).split(
    '\n',
  )) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    if (parts[0] !== '-') added += Number(parts[0]);
    if (parts[1] !== '-') removed += Number(parts[1]);
  }
  return { added, removed };
}

function collectMerges(root: string): MergeCommit[] {
  const out: MergeCommit[] = [];
  for (const line of git(root, ['log', '--format=%H%x09%s']).split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const sha = line.slice(0, tab);
    const subject = line.slice(tab + 1);
    const match = /^(T-\d{4})\b[:\s]*(.*)$/.exec(subject);
    if (match === null) continue;
    const { added, removed } = numstatFor(root, sha);
    let created = 0;
    let deleted = 0;
    for (const status of git(root, [
      'show',
      '--no-renames',
      '--name-status',
      '--format=',
      sha,
    ]).split('\n')) {
      if (status.startsWith('A\t')) created += 1;
      else if (status.startsWith('D\t')) deleted += 1;
    }
    out.push({
      sha,
      id: match[1] ?? '',
      title: match[2] ?? '',
      added,
      removed,
      created,
      deleted,
      net: added - removed,
    });
    if (out.length >= 40) break;
  }
  return out;
}

function collectPackages(files: CodeFile[]): PackageStat[] {
  const byPackage = new Map<string, CodeFile[]>();
  for (const file of files) {
    const name = packageOf(file.path);
    byPackage.set(name, [...(byPackage.get(name) ?? []), file]);
  }
  const sum = (list: CodeFile[], cls: FileClass): number =>
    list.filter((f) => f.cls === cls).reduce((total, f) => total + f.lines, 0);
  return [...byPackage]
    .map(([name, list]) => {
      const source = list.filter((f) => f.cls === 'source');
      const biggest = source.reduce<CodeFile | null>(
        (best, f) => (best === null || f.lines > best.lines ? f : best),
        null,
      );
      return {
        name,
        files: list.length,
        sourceLines: sum(list, 'source'),
        testLines: sum(list, 'test'),
        over400: source.filter((f) => f.lines > LINE_LIMIT).length,
        biggest: biggest === null ? null : { path: biggest.path, lines: biggest.lines },
      };
    })
    .sort((a, b) => b.sourceLines - a.sourceLines || a.name.localeCompare(b.name));
}

function readFiles(root: string, paths: string[], delta7: Map<string, number>): CodeFile[] {
  const files: CodeFile[] = [];
  for (const path of paths) {
    let source = '';
    try {
      source = readFileSync(join(root, path), 'utf8');
    } catch {
      continue;
    }
    const cls = classify(path);
    const lines = countLines(source);
    files.push({
      path,
      lines,
      cls,
      band: cls === 'source' ? bandOf(lines) : null,
      delta7: delta7.get(path) ?? 0,
    });
  }
  return files;
}

function classCounts(files: CodeFile[]): Record<FileClass, ClassCount> {
  const byClass: Record<FileClass, ClassCount> = {
    source: { files: 0, lines: 0 },
    test: { files: 0, lines: 0 },
    mock: { files: 0, lines: 0 },
    generated: { files: 0, lines: 0 },
  };
  for (const file of files) {
    byClass[file.cls].files += 1;
    byClass[file.cls].lines += file.lines;
  }
  return byClass;
}

export function collectCodeMap(root: string = repoRoot()): CodeMap {
  const numbers = readGitNumbers(root);
  const paths = git(root, ['ls-files']).split('\n').filter(isScoped);
  const files = readFiles(root, paths, numbers.delta7);
  const byClass = classCounts(files);
  const history = buildHistory(numbers, [
    byClass.source.lines,
    byClass.test.lines,
    byClass.mock.lines,
  ]);
  const target = shiftDate(numbers.lastDate, -WEEK_DAYS);
  let weekAgo = history[0]?.source ?? byClass.source.lines;
  for (const point of history) {
    if (point.date <= target) weekAgo = point.source;
  }
  const head = git(root, ['log', '-1', '--format=%h%x09%s']).trim();
  const tab = head.indexOf('\t');
  return {
    generatedAt: new Date().toISOString(),
    commit: tab < 0 ? head : head.slice(0, tab),
    commitSubject: tab < 0 ? '' : head.slice(tab + 1),
    lineLimit: LINE_LIMIT,
    totals: {
      files: files.length,
      over400: files.filter((f) => f.cls === 'source' && f.lines > LINE_LIMIT).length,
      byClass,
    },
    week: { sourceDelta: byClass.source.lines - weekAgo },
    files,
    history,
    merges: collectMerges(root),
    packages: collectPackages(files),
    biggest: files
      .filter((f) => f.cls === 'source')
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 25),
  };
}
