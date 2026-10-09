// `lead watch`: a live, full-terminal view of every running task. Pure data
// helpers live here so they can be tested without a TTY; the Ink app is in
// `watch-app.tsx` and its pure mapping rules in `watch-format.ts`.

import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render as renderInk } from 'ink';
import { Result, Schema } from 'effect';
import type { OpenCodeClient } from './client.js';
import { OpencodeCliClient } from './client.js';
import {
  collectSnapshot,
  listSessionMessages,
  loadGitCache,
  saveGitCache,
} from './collect-snapshot.js';
import type { GitCache, MessageCache, WorktreeGit } from './collect-snapshot.js';
import type { GitRunner } from './git.js';
import { RealGitRunner } from './git.js';
import { loadState, stateFilePath } from './state.js';
import { findTaskFile } from './launch.js';
import { parseFrontMatter } from './task-file.js';
import { parseBoard } from '../effect-map/generate.js';
import type { BoardRow } from '../effect-map/generate.js';

export const REFRESH_INTERVAL_MS = 10_000;

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
    // The step is read while the tool call is still arriving and its
    // `input.path` is not there yet: never show `<unknown>`.
    return 'editing…';
  }
  if (name === 'read') {
    const filePath = input['path'];
    if (typeof filePath === 'string') {
      return `reading ${path.basename(filePath)}`;
    }
    return 'reading…';
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

// Median output speed, gap between steps, latest context size, and a 10-bar
// sparkline of the per-step tok/s of the last 10 steps. Messages come back
// newest-first; the analysis is built from the most recent 20 assistant
// steps, then narrowed to the last 10 for the sparkline. The shown speed is
// the median of those same per-step values, so one step that waited on a hung
// tool never drags it down. Fewer than 2 usable completed steps (with
// `time.completed` set and a non-zero gap) returns `null`. Defensive on
// unknown shapes: never throws.
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
  const gaps: number[] = [];
  for (let i = 1; i < steps.length; i += 1) {
    gaps.push(steps[i]!.created - steps[i - 1]!.created);
  }
  const totalGap = gaps.reduce((sum, gap) => sum + gap, 0);
  const secPerStep = gaps.length > 0 ? totalGap / gaps.length / 1000 : 0;
  const context = newest.contextSize;
  const recent = steps.slice(-10);
  const spark: number[] = [];
  for (const step of recent) {
    spark.push(step.duration > 0 ? step.tokensOut / (step.duration / 1000) : 0);
  }
  return {
    tokPerSec: median(spark),
    secPerStep,
    context,
    spark,
  };
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
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

export interface WatchEntry {
  id: string;
  title: string;
  modelLabel: string;
  model: string;
  effort: string | undefined;
  totalAge: string;
  autoFixRounds: number;
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
  mergedToday: number;
  entries: WatchEntry[];
}

// The `--data` child process prints one JSON line and exits; this parses it.
// Junk of any kind — malformed JSON, missing fields, wrong types — returns
// `null` so the watcher can keep the previous view.
const FileSchema = Schema.Struct({
  path: Schema.String,
  kind: Schema.Literals(['created', 'modified', 'deleted']),
});

const SpeedSchema = Schema.Struct({
  tokPerSec: Schema.Number,
  secPerStep: Schema.Number,
  context: Schema.Number,
  spark: Schema.mutable(Schema.Array(Schema.Number)),
});

const EntrySchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  modelLabel: Schema.String,
  model: Schema.String,
  effort: Schema.optional(Schema.NullOr(Schema.String)),
  totalAge: Schema.String,
  autoFixRounds: Schema.Number,
  phaseId: Schema.String,
  phaseLabel: Schema.String,
  needsLead: Schema.Boolean,
  running: Schema.Boolean,
  step: Schema.NullOr(Schema.String),
  files: Schema.mutable(Schema.Array(FileSchema)),
  speed: Schema.optional(Schema.NullOr(SpeedSchema)),
});

const ViewSchema = Schema.Struct({
  clock: Schema.String,
  refreshFailed: Schema.Boolean,
  mergedToday: Schema.Number,
  entries: Schema.mutable(Schema.Array(EntrySchema)),
});

export function parseWatchView(line: string): WatchView | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const result = Schema.decodeUnknownResult(ViewSchema)(parsed);
  if (Result.isFailure(result)) {
    return null;
  }
  return {
    ...result.success,
    entries: result.success.entries.map((entry) => ({
      ...entry,
      effort: entry.effort ?? undefined,
      speed: entry.speed ?? null,
    })),
  };
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

export function formatClock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export async function collectFiles(
  runner: GitRunner,
  worktree: string,
  fallback: ChangedFile[],
  cached?: WorktreeGit,
): Promise<ChangedFile[]> {
  if (worktree === '' || !fs.existsSync(worktree)) {
    return fallback;
  }
  // A cached snapshot from `collectSnapshot` already carries the diff for the
  // current HEAD, so no `git merge-base` or `git diff` runs here.
  if (cached !== undefined) {
    return cached.ok ? parseChangedFiles(cached.nameStatus, cached.porcelain) : fallback;
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

// The board's model column for one task: the 4th cell of its row, e.g.
// `| [T-0757](T-0757-x.md) | title | in-progress | haiku-5.5 | ...`. An empty
// cell, or no row for the id, gives `undefined`.
export function boardModelFor(boardText: string, id: string): string | undefined {
  const prefix = `| [${id}](`;
  const line = boardText.split('\n').find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) {
    return undefined;
  }
  const model = line.split('|').map((cell) => cell.trim())[4] ?? '';
  return model === '' ? undefined : model;
}

interface BoardPhase {
  phaseId: string;
  needsLead: boolean;
}

// The board statuses that get a card, mapped to the phases the cards use.
// `todo` and anything else give no card.
function boardPhase(status: string): BoardPhase | null {
  if (status === 'in-progress') {
    return { phaseId: 'coding', needsLead: false };
  }
  if (status === 'review') {
    return { phaseId: 'waiting-lead', needsLead: true };
  }
  if (status === 'blocked') {
    return { phaseId: 'blocked', needsLead: true };
  }
  return null;
}

export interface BoardTaskFacts {
  row: BoardRow;
  model: string | undefined;
  effort: string | undefined;
  files: ChangedFile[];
  totalAge: string;
  step: string | null;
}

// The card for a board row whose task has no autopilot record (a task run as a
// Claude subagent). Pure: the git and file facts are passed in.
export function boardTaskEntry(facts: BoardTaskFacts): WatchEntry | null {
  const { row } = facts;
  const phase = boardPhase(row.status);
  if (phase === null) {
    return null;
  }
  const model = facts.model ?? 'unknown';
  return {
    id: row.id,
    title: row.title,
    modelLabel: modelLabel(model, facts.effort),
    model,
    effort: facts.effort,
    totalAge: facts.totalAge,
    autoFixRounds: 0,
    phaseId: phase.phaseId,
    phaseLabel: row.status,
    needsLead: phase.needsLead,
    running: row.status === 'in-progress',
    step: facts.step,
    files: facts.files,
    speed: null,
  };
}

// Age from the first commit after main, else from the worktree directory's mtime.
function boardTotalAge(runner: GitRunner, worktree: string, now: number): string {
  const log = runner.run(worktree, ['log', '--reverse', '--format=%ct', 'main..HEAD']);
  const first = log.ok ? log.stdout.split('\n').find((line) => line.trim() !== '') : undefined;
  const committed = first === undefined ? Number.NaN : Number(first);
  const started = Number.isFinite(committed) ? committed * 1000 : fs.statSync(worktree).mtimeMs;
  return formatDuration((now - started) / 1000);
}

// The subject of the newest commit beyond main, or null when there is none.
function boardStep(runner: GitRunner, worktree: string): string | null {
  const log = runner.run(worktree, ['log', '-1', '--format=%s', 'main..HEAD']);
  const subject = log.ok ? log.stdout.trim() : '';
  return subject === '' ? null : subject;
}

function readBoard(root: string): string {
  try {
    return fs.readFileSync(path.join(root, 'work', 'BOARD.md'), 'utf8');
  } catch {
    return '';
  }
}

// Cards for the open board rows that have a worktree `../zilar-<id>` and no
// autopilot record. Rows that have a record are shown by the loop in `buildView`.
async function boardOnlyEntries(
  root: string,
  hasRecord: (id: string) => boolean,
  runner: GitRunner,
  gitCache: GitCache,
  now: number,
): Promise<WatchEntry[]> {
  const boardText = readBoard(root);
  const entries: WatchEntry[] = [];
  for (const row of parseBoard(boardText)) {
    if (row.status === 'todo' || hasRecord(row.id)) {
      continue;
    }
    const worktree = path.join(path.dirname(root), `zilar-${row.id}`);
    if (!fs.existsSync(worktree)) {
      continue;
    }
    const entry = boardTaskEntry({
      row,
      model: boardModelFor(boardText, row.id),
      effort: readEffort(worktree, row.id),
      files: await collectFiles(runner, worktree, [], gitCache.get(worktree)),
      totalAge: boardTotalAge(runner, worktree, now),
      step: boardStep(runner, worktree),
    });
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
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
  gitCache: GitCache,
  now: number,
): Promise<WatchView> {
  const clock = formatClock(new Date(now));
  // One list per session for this refresh: `collectSnapshot` fills the cache
  // and the live-step read below reuses it instead of spawning `opencode2`
  // again for a session it already listed.
  const messages: MessageCache = new Map();
  let snapshot;
  try {
    snapshot = await collectSnapshot({
      client,
      runner,
      statePath,
      root,
      now,
      messages,
      gitCache,
    });
  } catch {
    return { ...previous, refreshFailed: true };
  }
  let state;
  try {
    state = loadState(statePath);
  } catch {
    return { ...previous, refreshFailed: true };
  }
  const entries: WatchEntry[] = [];
  for (const task of snapshot.active) {
    const record = state.tasks[task.id];
    if (record === undefined) {
      continue;
    }
    const phaseId = task.phase.id;
    const running = isRunningPhase(phaseId);
    const files = await collectFiles(runner, record.worktree, [], gitCache.get(record.worktree));
    const sessionId = chooseSessionId(phaseId, record.sessionId, record.prereview?.sessionId);
    let step: string | null = null;
    let speed: SessionSpeed | null = null;
    if (running) {
      try {
        const list = await listSessionMessages(client, messages, sessionId, 20);
        step = liveStep(list);
        speed = sessionSpeed(list);
      } catch {
        step = null;
        speed = null;
      }
    }
    const effort = readEffort(record.worktree, task.id);
    entries.push({
      id: task.id,
      title: task.title,
      modelLabel: modelLabel(record.model, effort),
      model: record.model,
      effort,
      totalAge: task.totalAge,
      autoFixRounds: task.autoFixRounds,
      phaseId,
      phaseLabel: task.phase.label,
      needsLead: task.phase.needsLead,
      running,
      step,
      files,
      speed,
    });
  }
  entries.push(
    ...(await boardOnlyEntries(root, (id) => state.tasks[id] !== undefined, runner, gitCache, now)),
  );
  return { clock, refreshFailed: false, mergedToday: snapshot.mergedToday.length, entries };
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

// One-shot mode used by the watcher's child process: build the view once
// and print it as a single JSON line. Hidden `--data` flag on `lead watch`.
export async function runWatchData(): Promise<void> {
  const root = findRepoRoot();
  const statePath = stateFilePath();
  const cachePath = path.join(path.dirname(statePath), 'watch-cache.json');
  const gitCache = loadGitCache(cachePath);
  const view = await buildView(
    { clock: formatClock(new Date()), refreshFailed: false, mergedToday: 0, entries: [] },
    root,
    statePath,
    new OpencodeCliClient(),
    new RealGitRunner(),
    gitCache,
    Date.now(),
  );
  saveGitCache(cachePath, gitCache);
  process.stdout.write(`${JSON.stringify(view)}\n`);
}

// Renders the live Ink app (`WatchLive` in `watch-app.tsx` owns the refresh
// loop, the clock and the quit keys). Ink draws in the terminal's alternate
// screen and restores the terminal when the app exits; a resize listener
// ahead of Ink's own clears the whole screen, so growing the window never
// leaves ghost lines behind. The app module is
// imported lazily so `watch.ts` stays free of a render-time import cycle.
// `lead watch --no-icons` (or `ZILAR_WATCH_ICONS=0`) falls back to plain
// characters instead of the Nerd Font glyphs.

// Clears the whole screen and homes the cursor, then asks Ink to redraw
// from a clean slate. Runs before Ink's own resize handler, which only
// clears when the window shrinks.
export function fullClearOnResize(out: { write(s: string): unknown }, clear: () => void): void {
  const esc = String.fromCharCode(27);
  out.write(`${esc}[2J${esc}[H`);
  clear();
}

export async function runWatch(options?: { noIcons?: boolean }): Promise<void> {
  const { iconsEnabled } = await import('./watch-format.js');
  const { WatchLive } = await import('./watch-app.js');
  const initial: WatchView = {
    clock: formatClock(new Date()),
    refreshFailed: false,
    mergedToday: 0,
    entries: [],
  };
  const app = renderInk(
    React.createElement(WatchLive, { initial, icons: iconsEnabled(options?.noIcons ?? false) }),
    { alternateScreen: true },
  );
  const onResize = (): void => fullClearOnResize(process.stdout, () => app.clear());
  process.stdout.prependListener('resize', onResize);
  try {
    await app.waitUntilExit();
  } finally {
    process.stdout.removeListener('resize', onResize);
  }
}
