// `lead watch`: a live, full-terminal view of every running task. Pure
// rendering helpers live here so they can be tested without a TTY; the
// terminal-control loop is in `runWatch` at the bottom.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { OpenCodeClient } from './client.js';
import { OpencodeCliClient } from './client.js';
import { collectSnapshot } from './collect-snapshot.js';
import type { GitRunner } from './git.js';
import { RealGitRunner } from './git.js';
import { loadState, stateFilePath } from './state.js';
import { findTaskFile } from './launch.js';
import { parseFrontMatter } from './task-file.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DOT_TRAIL = ['', '.', '..', '...'];
const MAX_FILES = 6;
const TWO_COLUMN_MIN_WIDTH = 70;
const SPARK_MIN_WIDTH = 60;
const REFRESH_INTERVAL_MS = 3_000;
const REDRAW_INTERVAL_MS = 120;

const ESC = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  cyan: '\u001b[36m',
  yellow: '\u001b[33m',
  magenta: '\u001b[35m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  altEnter: '\u001b[?1049h',
  altExit: '\u001b[?1049l',
  hideCursor: '\u001b[?25l',
  showCursor: '\u001b[?25h',
  cursorHome: '\u001b[H',
  clearLine: '\u001b[K',
  clearScreenBelow: '\u001b[J',
  clearScreen: '\u001b[2J\u001b[H',
};

export type FileKind = 'created' | 'modified' | 'deleted';

export interface ChangedFile {
  path: string;
  kind: FileKind;
}

// The newest message of the session decides the step. Messages come back
// newest-first from `session.message.list`. We read defensively: any shape
// we don't understand falls through to the next branch and never breaks
// the loop.
export function liveStep(messages: unknown[]): string | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }
  const newest = messages[0];
  if (!isRecord(newest)) {
    return null;
  }
  if (newest['type'] === 'idle') {
    return null;
  }
  const content = newest['content'];
  if (!Array.isArray(content) || content.length === 0) {
    return null;
  }
  const last = content[content.length - 1];
  if (!isRecord(last)) {
    return null;
  }
  const type = last['type'];
  if (type === 'reasoning') {
    return 'thinking';
  }
  if (type === 'text') {
    return 'writing a reply';
  }
  if (type === 'tool') {
    return stepFromTool(last);
  }
  return null;
}

function stepFromTool(tool: Record<string, unknown>): string | null {
  const name = tool['name'];
  const state = isRecord(tool['state']) ? tool['state'] : {};
  const input = isRecord(state['input']) ? (state['input'] as Record<string, unknown>) : {};
  if (name === 'edit' || name === 'write') {
    const filePath = input['path'];
    if (typeof filePath === 'string') {
      return `editing ${path.basename(filePath)}`;
    }
    return `editing <unknown>`;
  }
  if (name === 'read') {
    const filePath = input['path'];
    if (typeof filePath === 'string') {
      return `reading ${path.basename(filePath)}`;
    }
    return 'reading <unknown>';
  }
  if (name === 'shell') {
    const command = input['command'];
    if (typeof command !== 'string') {
      return 'running a shell command';
    }
    if (command.includes('pnpm gate')) {
      return 'running the gate';
    }
    if (/\btest\b/.test(command)) {
      return 'running tests';
    }
    if (/^\s*git\s+commit\b/.test(command)) {
      return 'committing';
    }
    return `running ${command.slice(0, 30)}`;
  }
  if (typeof name === 'string') {
    return `using ${name}`;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// `--name-status` lines look like `M\tpath` or `R<score>\told\tnew`. `git
// status --porcelain` untracked lines look like `?? path`. Both are joined
// into one list, deduplicated, and ordered created → modified → deleted,
// each sorted alphabetically. Paths under `work/` are dropped.
export function parseChangedFiles(nameStatus: string, porcelain: string): ChangedFile[] {
  const created = new Set<string>();
  const modified = new Set<string>();
  const deleted = new Set<string>();
  for (const raw of nameStatus.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    const parts = line.split('\t');
    const status = parts[0];
    if (status === undefined || parts.length < 2) {
      continue;
    }
    if (status.startsWith('A')) {
      addIfReal(created, parts[1]);
    } else if (status.startsWith('M')) {
      addIfReal(modified, parts[1]);
    } else if (status.startsWith('D')) {
      addIfReal(deleted, parts[1]);
    } else if (status.startsWith('R')) {
      // A rename shows up as a delete of the old name and a create of the new.
      const oldPath = parts[1];
      const newPath = parts[2];
      if (oldPath !== undefined) {
        addIfReal(deleted, oldPath);
      }
      if (newPath !== undefined) {
        addIfReal(created, newPath);
      }
    }
  }
  for (const raw of porcelain.split('\n')) {
    const line = raw.trim();
    if (line === '' || !line.startsWith('?? ')) {
      continue;
    }
    addIfReal(created, line.slice(3));
  }
  const sortAlpha = (a: string, b: string): number => a.localeCompare(b);
  const out: ChangedFile[] = [];
  for (const file of [...created].sort(sortAlpha)) {
    out.push({ path: file, kind: 'created' });
  }
  for (const file of [...modified].sort(sortAlpha)) {
    out.push({ path: file, kind: 'modified' });
  }
  for (const file of [...deleted].sort(sortAlpha)) {
    out.push({ path: file, kind: 'deleted' });
  }
  return out;
}

function addIfReal(set: Set<string>, candidate: string | undefined): void {
  if (candidate === undefined) {
    return;
  }
  if (candidate.startsWith('work/')) {
    return;
  }
  set.add(candidate);
}

// `meta/muse-spark-1.3-contributor` + `low` → `muse-spark-1.3-contributor (low)`.
export function modelLabel(model: string, variant: string | undefined): string {
  const stripped = model.includes('/') ? model.slice(model.indexOf('/') + 1) : model;
  if (variant !== undefined && variant.length > 0) {
    return `${stripped} (${variant})`;
  }
  return stripped;
}

// `formatContext(158705) === '158k'`, `formatContext(1_234_000) === '1.2M'`.
// Numbers under 1k keep the full integer; numbers under 1M truncate to
// thousands (so `158_705 → 158k`, not `159k`); millions one-decimal.
export function formatContext(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) {
    return '0';
  }
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${trimmed(m)}M`;
  }
  if (tokens >= 1_000) {
    const k = Math.floor(tokens / 1_000);
    return `${k}k`;
  }
  return String(Math.round(tokens));
}

function trimmed(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (Number.isInteger(rounded)) {
    return `${rounded}`;
  }
  return rounded.toFixed(1);
}

// Sparkline of the last N values, scaled between the lowest and highest of
// those N (all equal: all `▄`). Oldest left, newest right.
const SPARK_BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const SPARK_EQUAL_BAR = '▄';

export function sparkline(values: number[]): string {
  if (values.length === 0) {
    return '';
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return SPARK_EQUAL_BAR.repeat(values.length);
  }
  return values
    .map((value) => {
      const ratio = (value - min) / (max - min);
      const idx = Math.min(
        SPARK_BARS.length - 1,
        Math.max(0, Math.round(ratio * (SPARK_BARS.length - 1))),
      );
      return SPARK_BARS[idx] ?? SPARK_EQUAL_BAR;
    })
    .join('');
}

export interface SessionSpeed {
  tokPerSec: number;
  secPerStep: number;
  context: number;
  spark: number[];
}

// Average output speed, gap between steps, latest context size, and a 10-bar
// sparkline of the per-step tok/s of the last 10 steps. Messages come back
// newest-first; the analysis is built from the most recent 20 assistant
// steps, then narrowed to the last 10 for the sparkline. Fewer than 2
// usable completed steps (with `time.completed` set and a non-zero gap)
// returns `null`. Defensive on unknown shapes: never throws.
export function sessionSpeed(messages: unknown[]): SessionSpeed | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }
  const steps: SpeedStep[] = [];
  for (const message of messages) {
    const step = parseSpeedStep(message);
    if (step === null) {
      continue;
    }
    steps.push(step);
    if (steps.length >= 20) {
      break;
    }
  }
  if (steps.length < 2) {
    return null;
  }
  // Newest-first → oldest-first so the gaps line up.
  steps.reverse();
  const newest = steps[steps.length - 1]!;
  const totalOut = steps.reduce((sum, step) => sum + step.tokensOut, 0);
  const totalDur = steps.reduce((sum, step) => sum + step.duration, 0);
  const gaps: number[] = [];
  for (let i = 1; i < steps.length; i += 1) {
    gaps.push(steps[i]!.created - steps[i - 1]!.created);
  }
  const totalGap = gaps.reduce((sum, gap) => sum + gap, 0);
  const tokPerSec = totalDur > 0 ? totalOut / (totalDur / 1000) : 0;
  const secPerStep = gaps.length > 0 ? totalGap / gaps.length / 1000 : 0;
  const context = newest.contextSize;
  const recent = steps.slice(-10);
  const spark: number[] = [];
  for (const step of recent) {
    spark.push(step.duration > 0 ? step.tokensOut / (step.duration / 1000) : 0);
  }
  return {
    tokPerSec,
    secPerStep,
    context,
    spark,
  };
}

interface SpeedStep {
  tokensOut: number;
  created: number;
  duration: number;
  contextSize: number;
}

function parseSpeedStep(message: unknown): SpeedStep | null {
  if (!isRecord(message)) {
    return null;
  }
  if (message['type'] !== 'assistant') {
    return null;
  }
  const time = isRecord(message['time']) ? message['time'] : {};
  const created = time['created'];
  const completed = time['completed'];
  if (typeof created !== 'number' || typeof completed !== 'number') {
    return null;
  }
  if (completed <= created) {
    return null;
  }
  const tokens = isRecord(message['tokens']) ? message['tokens'] : {};
  const output = numberField(tokens['output']);
  const reasoning = numberField(tokens['reasoning']);
  const input = numberField(tokens['input']);
  const cache = isRecord(tokens['cache']) ? tokens['cache'] : {};
  const cacheRead = numberField(cache['read']);
  return {
    tokensOut: output + reasoning,
    created,
    duration: completed - created,
    contextSize: input + cacheRead,
  };
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// `1.5 s` or `1 min 5 s` when over 60 s. One decimal under a minute.
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0 s';
  }
  if (seconds < 60) {
    return `${trimmed(seconds)} s`;
  }
  const totalSec = Math.round(seconds);
  const minutes = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${minutes} min ${secs} s`;
}

function phaseColor(phaseId: string): string {
  if (phaseId === 'coding' || phaseId === 'fixing') {
    return ESC.cyan;
  }
  if (phaseId === 'prereview' || phaseId === 'starting-prereview') {
    return ESC.magenta;
  }
  if (phaseId === 'waiting-lead' || phaseId === 'blocked' || phaseId === 'idle') {
    return ESC.yellow;
  }
  if (phaseId === 'quota') {
    return ESC.red;
  }
  return ESC.dim;
}

function fileColor(kind: FileKind, color: boolean): string {
  if (!color) {
    return '';
  }
  if (kind === 'created') {
    return ESC.green;
  }
  if (kind === 'modified') {
    return ESC.yellow;
  }
  return ESC.red;
}

function kindSymbol(kind: FileKind): string {
  if (kind === 'created') {
    return '+';
  }
  if (kind === 'modified') {
    return '~';
  }
  return '-';
}

export interface WatchEntry {
  id: string;
  title: string;
  modelLabel: string;
  totalAge: string;
  phaseId: string;
  phaseLabel: string;
  needsLead: boolean;
  running: boolean;
  step: string | null;
  files: ChangedFile[];
  speed: SessionSpeed | null;
}

export interface WatchView {
  clock: string;
  refreshFailed: boolean;
  entries: WatchEntry[];
}

// The `--data` child process prints one JSON line and exits; this parses it.
// Junk of any kind — malformed JSON, missing fields, wrong types — returns
// `null` so the watcher can keep the previous view.
const FileSchema = z.object({
  path: z.string(),
  kind: z.enum(['created', 'modified', 'deleted']),
});

const SpeedSchema = z.object({
  tokPerSec: z.number(),
  secPerStep: z.number(),
  context: z.number(),
  spark: z.array(z.number()),
});

const EntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  modelLabel: z.string(),
  totalAge: z.string(),
  phaseId: z.string(),
  phaseLabel: z.string(),
  needsLead: z.boolean(),
  running: z.boolean(),
  step: z.string().nullable(),
  files: z.array(FileSchema),
  speed: SpeedSchema.nullish(),
});

const ViewSchema = z.object({
  clock: z.string(),
  refreshFailed: z.boolean(),
  entries: z.array(EntrySchema),
});

export function parseWatchView(line: string): WatchView | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const result = ViewSchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }
  return {
    ...result.data,
    entries: result.data.entries.map((entry) => ({
      ...entry,
      speed: entry.speed ?? null,
    })),
  };
}

// Count visible characters, skipping ANSI escape sequences.
function visibleLength(line: string): number {
  let count = 0;
  let inEscape = false;
  for (const ch of line) {
    if (inEscape) {
      if (ch === 'm' || ch === 'K' || ch === 'h' || ch === 'l') {
        inEscape = false;
      }
      continue;
    }
    if (ch === '\u001b') {
      inEscape = true;
      continue;
    }
    count += 1;
  }
  return count;
}

function pad(line: string, width: number): string {
  const visible = visibleLength(line);
  if (visible >= width) {
    return line;
  }
  return `${line}${' '.repeat(width - visible)}`;
}

function clip(text: string, width: number): string {
  if (width <= 0) {
    return '';
  }
  if (text.length <= width) {
    return text;
  }
  if (width === 1) {
    return '…';
  }
  return `${text.slice(0, width - 1)}…`;
}

// Build one redraw frame: cursor home, each line followed by "clear to end of
// line", and one "clear to end of screen" at the very end. No `\u001b[2J`
// (the whole-screen clear) so the terminal only repaints what changed.
export function frameText(lines: string[]): string {
  if (lines.length === 0) {
    return `${ESC.cursorHome}${ESC.clearScreenBelow}`;
  }
  const body = lines.map((line) => `${line}${ESC.clearLine}`).join('\n');
  return `${ESC.cursorHome}${body}\n${ESC.clearScreenBelow}`;
}

function colorize(text: string, color: string, colorOn: boolean): string {
  if (!colorOn) {
    return text;
  }
  return `${color}${text}${ESC.reset}`;
}

// Render the full screen. `width` is the visible width the caller wants;
// every returned line is at most that wide. `color: false` strips all
// ANSI codes so the tests can match strings exactly.
export function renderWatch(
  view: WatchView,
  width: number,
  frame: number,
  color: boolean,
): string[] {
  const safeWidth = Math.max(20, width);
  const out: string[] = [];
  out.push(renderHeaderLine(view.clock, safeWidth));
  if (view.refreshFailed) {
    out.push(colorize(pad('refresh failed, retrying', safeWidth), ESC.dim, color));
  } else {
    out.push(pad(renderCountsLine(view.entries), safeWidth));
  }
  if (view.entries.length === 0) {
    out.push('');
    out.push(colorize(pad('No tasks in flight.', safeWidth), ESC.dim, color));
    return out;
  }
  for (const entry of view.entries) {
    out.push('');
    out.push(...renderEntry(entry, safeWidth, frame, color));
  }
  return out;
}

function renderHeaderLine(clock: string, width: number): string {
  const left = 'zilar lead watch';
  const gap = Math.max(1, width - visibleLength(left) - clock.length);
  return `${left}${' '.repeat(gap)}${clock}`;
}

function renderCountsLine(entries: WatchEntry[]): string {
  const running = entries.filter((entry) => entry.running).length;
  const waiting = entries.filter((entry) => entry.needsLead).length;
  return `${running} running · ${waiting} waiting for you`;
}

function renderEntry(entry: WatchEntry, width: number, frame: number, color: boolean): string[] {
  const phaseColorCode = phaseColor(entry.phaseId);
  const marker = entry.running
    ? (SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0] ?? '⠋')
    : '●';
  const markerText = colorize(` ${marker}`, phaseColorCode, color);
  const idText = colorize(entry.id, ESC.bold, color);
  const idWidth = visibleLength(idText);
  // ` ⠋  <id>  <title>` uses 2 (marker) + 2 + idWidth + 2 = idWidth + 6 of the width.
  const titleWidth = Math.max(0, width - idWidth - 6);
  const titleText = clip(entry.title, titleWidth);
  const first = `${markerText}  ${idText}  ${titleText}`;
  const metaSource = `${entry.modelLabel} · ${entry.totalAge}`;
  const meta = clip(`     ${metaSource}`, width);
  const trail = DOT_TRAIL[Math.floor(frame / 8) % DOT_TRAIL.length] ?? '';
  const phaseText = colorize(entry.phaseLabel, phaseColorCode, color);
  const stepText = entry.running && entry.step !== null ? `${entry.step}${trail}` : '';
  const thirdPrefix = `     ${phaseText}`;
  const thirdRaw =
    stepText === ''
      ? thirdPrefix
      : `${thirdPrefix} · ${clip(stepText, Math.max(0, width - visibleLength(thirdPrefix) - 3))}`;
  const third = clip(thirdRaw, width);
  const speed = renderSpeedLine(entry.speed, width, color);
  return [
    first,
    pad(meta, width),
    pad(third, width),
    speed,
    ...renderFiles(entry.files, width, color),
  ];
}

const CTX_YELLOW_THRESHOLD = 150_000;
const CTX_RED_THRESHOLD = 200_000;

function contextColor(context: number, color: boolean): string {
  if (!color) {
    return '';
  }
  if (context >= CTX_RED_THRESHOLD) {
    return ESC.red;
  }
  if (context >= CTX_YELLOW_THRESHOLD) {
    return ESC.yellow;
  }
  return '';
}

function renderSpeedLine(speed: SessionSpeed | null, width: number, color: boolean): string {
  const prefix = '     ';
  const budget = Math.max(0, width - prefix.length);
  if (budget === 0) {
    return '';
  }
  if (speed === null) {
    const text = 'measuring…';
    return clip(`${prefix}${colorize(text, ESC.dim, color)}`, width);
  }
  const tok = `${speed.tokPerSec.toFixed(1)} tok/s`;
  const stepLabel = `${formatDuration(speed.secPerStep)}/step`;
  const ctxText = formatContext(speed.context);
  const ctx = colorize(`ctx ${ctxText}`, contextColor(speed.context, color), color);
  // Sparkline dropped first at narrow widths.
  const showSpark = width >= SPARK_MIN_WIDTH;
  const sparkText = showSpark ? sparkline(speed.spark) : '';
  const inner = `${tok} · ${stepLabel} · ${ctx}`;
  const withSpark = sparkText === '' ? inner : `${inner}  ${sparkText}`;
  const clipped = clip(withSpark, budget);
  return `${prefix}${clipped}`;
}

function renderFiles(files: ChangedFile[], width: number, color: boolean): string[] {
  if (files.length === 0) {
    return [];
  }
  const shown = files.slice(0, MAX_FILES);
  const overflow = files.length - shown.length;
  const items = shown.map((file) => {
    const base = path.basename(file.path);
    return `${fileColor(file.kind, color)}${kindSymbol(file.kind)} ${base}${color ? ESC.reset : ''}`;
  });
  if (overflow > 0) {
    items.push(`+${overflow} more`);
  }
  if (width >= TWO_COLUMN_MIN_WIDTH) {
    const half = Math.ceil(items.length / 2);
    const left = items.slice(0, half);
    const right = items.slice(half);
    const colWidth = Math.floor((width - 6) / 2);
    const itemBudget = Math.max(0, colWidth - 1);
    const rows = Math.max(left.length, right.length);
    const out: string[] = [];
    for (let i = 0; i < rows; i += 1) {
      const l = clip(left[i] ?? '', itemBudget);
      const r = clip(right[i] ?? '', itemBudget);
      out.push(pad(`     ${pad(l, colWidth)}${r}`, width));
    }
    return out;
  }
  const itemBudget = Math.max(0, width - 6);
  return items.map((item) => pad(`     ${clip(item, itemBudget)}`, width));
}

// Phase ids that mean the worker is still busy. `waiting-lead`, `blocked`,
// `idle` and `quota` are all steady states — the worker is not running.
function isRunningPhase(phaseId: string): boolean {
  return (
    phaseId === 'coding' ||
    phaseId === 'fixing' ||
    phaseId === 'prereview' ||
    phaseId === 'starting-prereview'
  );
}

// While the pre-review session runs the worker session is silent; use the
// pre-review's messages for the live step.
function chooseSessionId(
  phaseId: string,
  workerSessionId: string,
  prereviewSessionId: string | undefined,
): string {
  if (
    (phaseId === 'prereview' || phaseId === 'starting-prereview') &&
    prereviewSessionId !== undefined
  ) {
    return prereviewSessionId;
  }
  return workerSessionId;
}

function formatClock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export async function collectFiles(
  runner: GitRunner,
  worktree: string,
  fallback: ChangedFile[],
): Promise<ChangedFile[]> {
  if (worktree === '' || !fs.existsSync(worktree)) {
    return fallback;
  }
  let nameStatus = '';
  let porcelain = '';
  try {
    const base = runner.run(worktree, ['merge-base', 'main', 'HEAD']);
    if (!base.ok) {
      return fallback;
    }
    const diff = runner.run(worktree, ['diff', '--name-status', base.stdout.trim()]);
    if (!diff.ok) {
      return fallback;
    }
    nameStatus = diff.stdout;
    const status = runner.run(worktree, ['status', '--porcelain']);
    if (status.ok) {
      porcelain = status.stdout;
    }
  } catch {
    return fallback;
  }
  return parseChangedFiles(nameStatus, porcelain);
}

// Reads `effort:` from the task's front matter. The lead state file does
// not carry it, so we go to the worktree where the task file lives.
function readEffort(worktree: string, taskId: string): string | undefined {
  try {
    const file = findTaskFile(worktree, taskId);
    const text = fs.readFileSync(path.join(worktree, 'work', file), 'utf8');
    const fields = parseFrontMatter(text);
    return fields['effort'];
  } catch {
    return undefined;
  }
}

// Pulls everything the renderer needs in one pass. Errors inside the loop
// flip `refreshFailed` so the header says so; the renderer keeps showing
// the previous data.
export async function buildView(
  previous: WatchView,
  root: string,
  statePath: string,
  client: OpenCodeClient,
  runner: GitRunner,
  fileCache: Map<string, ChangedFile[]>,
  now: number,
): Promise<WatchView> {
  const clock = formatClock(new Date(now));
  let snapshot;
  try {
    snapshot = await collectSnapshot({
      client,
      runner,
      statePath,
      root,
      now,
    });
  } catch {
    return { clock: previous.clock, refreshFailed: true, entries: previous.entries };
  }
  let state;
  try {
    state = loadState(statePath);
  } catch {
    return { clock: previous.clock, refreshFailed: true, entries: previous.entries };
  }
  const entries: WatchEntry[] = [];
  for (const task of snapshot.active) {
    const record = state.tasks[task.id];
    if (record === undefined) {
      continue;
    }
    const phaseId = task.phase.id;
    const running = isRunningPhase(phaseId);
    const previous = fileCache.get(task.id) ?? [];
    const files = await collectFiles(runner, record.worktree, previous);
    fileCache.set(task.id, files);
    const sessionId = chooseSessionId(phaseId, record.sessionId, record.prereview?.sessionId);
    let step: string | null = null;
    let speed: SessionSpeed | null = null;
    if (running) {
      try {
        const messages = await client.listMessages(sessionId, 20);
        step = liveStep(messages);
        speed = sessionSpeed(messages);
      } catch {
        step = null;
        speed = null;
      }
    }
    entries.push({
      id: task.id,
      title: task.title,
      modelLabel: modelLabel(record.model, readEffort(record.worktree, task.id)),
      totalAge: task.totalAge,
      phaseId,
      phaseLabel: task.phase.label,
      needsLead: task.phase.needsLead,
      running,
      step,
      files,
      speed,
    });
  }
  return { clock, refreshFailed: false, entries };
}

function findRepoRoot(): string {
  let dir = path.resolve(process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, 'work', 'BOARD.md'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('not inside a Zilar checkout (no work/BOARD.md above the cwd)');
    }
    dir = parent;
  }
}

// Turn raw mode off when restoring the terminal. Extracted so it can be
// tested without spinning up `runWatch`: `q`/`Ctrl-C` call `process.exit`
// before the `finally` block, so the cleanup has to happen inside `restore`.
export function disableRawMode(stdin: NodeJS.ReadStream, ref: { raw: boolean }): void {
  if (!ref.raw) {
    return;
  }
  stdin.setRawMode?.(false);
  ref.raw = false;
}

// One-shot mode used by the watcher's child process: build the view once
// and print it as a single JSON line. Hidden `--data` flag on `lead watch`.
export async function runWatchData(): Promise<void> {
  const root = findRepoRoot();
  const view = await buildView(
    { clock: formatClock(new Date()), refreshFailed: false, entries: [] },
    root,
    stateFilePath(),
    new OpencodeCliClient(),
    new RealGitRunner(),
    new Map<string, ChangedFile[]>(),
    Date.now(),
  );
  process.stdout.write(`${JSON.stringify(view)}\n`);
}

// The animation timer is decoupled from the refresh timer so the spinner
// keeps ticking even when the snapshot is slow. Refresh runs in a child
// process so its synchronous git/OpenCode calls never block the redraw loop,
// and `q`/`Ctrl-C` are always read between frames.
export function runWatch(): Promise<void> {
  const out = process.stdout;
  const startedFrame = Math.floor(Date.now() / REDRAW_INTERVAL_MS);
  let view: WatchView = { clock: formatClock(new Date()), refreshFailed: false, entries: [] };
  let stopped = false;
  let needsClear = false;
  let refreshing = false;
  const stdin = process.stdin;
  let stdinRaw = false;

  const restore = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    disableRawMode(stdin, { raw: stdinRaw });
    stdinRaw = false;
    out.write(`${ESC.altExit}${ESC.showCursor}${ESC.clearScreen}`);
  };

  const onSigint = (): void => {
    restore();
    process.exit(0);
  };
  const onExit = (): void => {
    restore();
  };

  process.on('SIGINT', onSigint);
  process.on('exit', onExit);

  if (stdin.isTTY === true) {
    stdin.setRawMode?.(true);
    stdinRaw = true;
    stdin.resume();
    stdin.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (text === 'q' || text === '\u0003') {
        restore();
        process.exit(0);
      }
    });
  }
  out.on('resize', () => {
    needsClear = true;
  });

  out.write(`${ESC.altEnter}${ESC.hideCursor}${ESC.clearScreen}`);

  const redrawTimer = setInterval(() => {
    if (stopped) {
      return;
    }
    const frame = Math.floor(Date.now() / REDRAW_INTERVAL_MS) - startedFrame;
    const width = out.columns ?? 80;
    const height = out.rows ?? 25;
    const liveView: WatchView = { ...view, clock: formatClock(new Date()) };
    const rendered = renderWatch(liveView, width, frame, true);
    const truncated = rendered.slice(0, height);
    const prefix = needsClear ? ESC.clearScreen : '';
    needsClear = false;
    out.write(`${prefix}${frameText(truncated)}`);
  }, REDRAW_INTERVAL_MS);

  const scriptArg = process.argv[1];
  const dataArgs =
    scriptArg === undefined ? null : [...process.execArgv, scriptArg, 'watch', '--data'];

  const refreshTimer = setInterval(() => {
    if (stopped || refreshing || dataArgs === null) {
      return;
    }
    refreshing = true;
    execFile(
      process.execPath,
      dataArgs,
      { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        refreshing = false;
        if (stopped) {
          return;
        }
        if (error !== null) {
          view = { ...view, refreshFailed: true };
          return;
        }
        const lastLine = stdout.trim().split('\n').at(-1) ?? '';
        const parsed = parseWatchView(lastLine);
        if (parsed === null) {
          view = { ...view, refreshFailed: true };
          return;
        }
        view = parsed;
      },
    );
  }, REFRESH_INTERVAL_MS);

  return new Promise<void>((resolve) => {
    const checkTimer = setInterval(() => {
      if (stopped) {
        clearInterval(redrawTimer);
        clearInterval(refreshTimer);
        clearInterval(checkTimer);
        resolve();
      }
    }, 100);
  });
}
