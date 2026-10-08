import { spawnSync } from 'node:child_process';
import {
  executableBasename,
  stopWorktreeProcesses,
  type CandidateProcess,
  type StoppedProcess,
  type StopProcessesDeps,
} from './processes.js';

// The gate kills its own steps on timeout (TESTS_TIMEOUT_MS = 20 min,
// STEP_TIMEOUT_MS = 10 min), so anything older than 25 min is a leftover that
// the gate no longer owns.
export const SWEEP_MAX_AGE_MS = 25 * 60 * 1000;
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// A process as read from `ps -axo pid=,etime=,command=`.
export interface SweepRow {
  pid: number;
  elapsedMs: number;
  command: string;
}

// The commands that belong to a test/typecheck/build run. `opencode` is the
// lead and its workers: the sweeper must never touch them.
const SWEEP_KEYWORDS = ['vitest', 'tsc', 'tsgo', 'turbo'];
const FORBIDDEN = 'opencode';

// `ps` prints elapsed time as `[[dd-]hh:]mm:ss` (e.g. `04:31`, `1:02:33`,
// `2-03:04:05`). Returns undefined for anything else so a malformed line is
// skipped rather than treated as a very old process.
function parseEtime(text: string): number | undefined {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(text);
  if (match === null) {
    return undefined;
  }
  const days = match[1] === undefined ? 0 : Number(match[1]);
  const hours = match[2] === undefined ? 0 : Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  return ((days * 24 + hours) * 60 + minutes) * 60_000 + seconds * 1000;
}

export function parsePsElapsed(output: string): SweepRow[] {
  const rows: SweepRow[] = [];
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }
    const match = /^(\d+)\s+(\S+)\s*(.*)$/.exec(line);
    if (match === null) {
      continue;
    }
    const pid = Number.parseInt(match[1] ?? '', 10);
    if (!Number.isFinite(pid)) {
      continue;
    }
    const elapsedMs = parseEtime(match[2] ?? '');
    if (elapsedMs === undefined) {
      continue;
    }
    rows.push({ pid, elapsedMs, command: match[3] ?? '' });
  }
  return rows;
}

// True when `command` mentions `root` at a path or token boundary. Mirrors
// processes.ts: `zilar-T-0047` never matches `zilar-T-00470`.
export function worktreeForCommand(command: string, roots: string[]): string | undefined {
  for (const root of roots) {
    if (root.length === 0) {
      continue;
    }
    let index = command.indexOf(root);
    while (index !== -1) {
      const next = command.charAt(index + root.length);
      if (
        next === '' ||
        next === '/' ||
        next === ' ' ||
        next === '\t' ||
        next === "'" ||
        next === '"' ||
        next === '='
      ) {
        return root;
      }
      index = command.indexOf(root, index + 1);
    }
  }
  return undefined;
}

export interface SweepOptions {
  /** Every `../zilar-T-*` worktree the state knows about. */
  worktreeRoots: string[];
  /** Worktrees whose task file says `status: blocked`; their rows go at any age. */
  blockedWorktrees: string[];
  maxAgeMs: number;
  protectedPids: number[];
}

// Picks the rows the sweeper may stop. A row qualifies only when its command
// belongs to a test/typecheck/build run, its command mentions a known
// worktree, and it is older than `maxAgeMs` (or runs in a blocked worktree).
// Protected pids and anything named `opencode` are never picked.
export function sweepCandidates(rows: SweepRow[], options: SweepOptions): SweepRow[] {
  const protectedPids = new Set(options.protectedPids);
  const blocked = new Set(options.blockedWorktrees);
  return rows.filter((row) => {
    if (protectedPids.has(row.pid)) {
      return false;
    }
    if (row.command.includes(FORBIDDEN)) {
      return false;
    }
    if (!SWEEP_KEYWORDS.some((keyword) => row.command.includes(keyword))) {
      return false;
    }
    const root = worktreeForCommand(row.command, options.worktreeRoots);
    if (root === undefined) {
      return false;
    }
    return row.elapsedMs >= options.maxAgeMs || blocked.has(root);
  });
}

// A row that the sweeper selected, tagged with the task it belongs to.
export interface SweptProcess {
  pid: number;
  task: string;
  basename: string;
  elapsedMs: number;
}

export interface SweepOutcome {
  /** Every row that qualified, before anything was stopped. */
  candidates: SweptProcess[];
  /** The rows we actually stopped (empty in dry-run and on survivors). */
  stopped: SweptProcess[];
  /** The rows that survived SIGKILL: still running, reported with SWEEP FAILED. */
  survivors: SweptProcess[];
}

// Seams so tests never touch the real OS: `ps` returns the raw process list,
// `stop` ends the picked processes.
export interface SweepDeps {
  ps: () => string;
  stop: (candidates: CandidateProcess[], deps?: StopProcessesDeps) => Promise<StoppedProcess[]>;
}

export interface RunSweepOptions extends SweepOptions {
  taskByWorktree: Map<string, string>;
  dryRun: boolean;
}

export function defaultSweepDeps(): SweepDeps {
  return {
    ps: () => {
      const result = spawnSync('ps', ['-axo', 'pid=,etime=,command='], {
        encoding: 'utf8',
        timeout: 10_000,
      });
      if (result.error !== undefined) {
        throw new Error(`ps failed to start: ${String(result.error)}`);
      }
      if (result.status !== 0) {
        throw new Error(`ps exited ${String(result.status)}`);
      }
      return result.stdout;
    },
    stop: (candidates, deps) => stopWorktreeProcesses(candidates, deps),
  };
}

function toSwept(
  row: SweepRow,
  options: RunSweepOptions,
  basename = executableBasename(row.command),
): SweptProcess {
  const root = worktreeForCommand(row.command, options.worktreeRoots);
  const task = root === undefined ? undefined : options.taskByWorktree.get(root);
  return {
    pid: row.pid,
    task: task ?? root ?? 'unknown',
    basename,
    elapsedMs: row.elapsedMs,
  };
}

export async function runSweep(
  options: RunSweepOptions,
  deps: SweepDeps = defaultSweepDeps(),
): Promise<SweepOutcome> {
  const picked = sweepCandidates(parsePsElapsed(deps.ps()), options);
  const candidates = picked.map((row) => toSwept(row, options));
  if (options.dryRun || picked.length === 0) {
    return { candidates, stopped: [], survivors: [] };
  }
  const stopped = await deps.stop(picked);
  const byPid = new Map(picked.map((row) => [row.pid, row]));
  const swept: SweptProcess[] = [];
  const survivors: SweptProcess[] = [];
  for (const entry of stopped) {
    const row = byPid.get(entry.pid);
    if (row === undefined) {
      continue;
    }
    // `survived` means SIGKILL did not end it: they were not stopped, so they
    // never count in the SWEPT line, and they go to the SWEEP FAILED line.
    if (entry.survived) {
      survivors.push(toSwept(row, options, entry.command));
    } else {
      swept.push(toSwept(row, options, entry.command));
    }
  }
  return { candidates, stopped: swept, survivors };
}

// The `task:basename:minutes` list shared by both sweep lines.
function entryList(entries: SweptProcess[]): string {
  return entries
    .map((entry) => `${entry.task}:${entry.basename}:${Math.round(entry.elapsedMs / 60_000)}m`)
    .join(', ');
}

// One line per sweep that stopped something: the task, the executable and how
// long it had been running. Basenames only: command lines can carry secrets.
export function sweepLine(entries: SweptProcess[]): string {
  return `LEAD: SWEPT ${entries.length} process(es): ${entryList(entries)}`;
}

// One line per sweep whose processes survived SIGKILL. Same entry format as
// sweepLine, so the lead can read the task and executable at a glance.
export function sweepFailedLine(entries: SweptProcess[]): string {
  return `LEAD: SWEEP FAILED ${entries.length} process(es) survived SIGKILL: ${entryList(entries)}`;
}
