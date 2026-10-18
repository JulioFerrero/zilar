import { spawnSync } from 'node:child_process';

export interface CandidateProcess {
  pid: number;
  command: string;
}

export interface FindProcsDeps {
  lsof: (cwd: string) => string;
  ps: (cwd: string) => string;
  // pid of the lead process and its parent. Both are excluded so the lead
  // never accidentally kills itself while stopping worktree processes.
  currentPid: number;
  parentPid: number;
}

const EXIT_WAIT_MS = 5_000;
const EXIT_POLL_MS = 50;

// True only when `candidate` is inside `worktree`: the exact path or a prefix with a
// separator, so `zilar-T-0047` never matches `zilar-T-00470`. Case-sensitive on
// purpose: macOS is case-insensitive but the kernel's cwd strings come unchanged.
function isInsideWorktree(worktree: string, candidate: string): boolean {
  if (candidate === worktree) {
    return true;
  }
  const prefix = worktree.endsWith('/') ? worktree : `${worktree}/`;
  return candidate.startsWith(prefix);
}

// Reads `lsof -a -d cwd -Fpn`: each block has `p<pid>` then one or more `n<cwd>` lines.
function parseLsof(output: string, worktree: string): Map<number, string> {
  const map = new Map<number, string>();
  let currentPid: number | undefined;
  for (const raw of output.split('\n')) {
    if (raw.length === 0) {
      continue;
    }
    const head = raw.charAt(0);
    if (head === 'p') {
      const parsed = Number.parseInt(raw.slice(1), 10);
      currentPid = Number.isFinite(parsed) ? parsed : undefined;
      continue;
    }
    if (head === 'n' && currentPid !== undefined) {
      const cwd = raw.slice(1);
      if (isInsideWorktree(worktree, cwd)) {
        // `lsof` may list several `n` lines per pid (cwd and text files); keep the first cwd.
        if (!map.has(currentPid)) {
          map.set(currentPid, cwd);
        }
      }
    }
  }
  return map;
}

function stripEnvAssignments(command: string): string {
  let rest = command;
  for (;;) {
    const match = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)/.exec(rest);
    if (match === null) {
      return rest;
    }
    rest = rest.slice(match[0].length);
  }
}

// The executable's basename: the first token after env assignments, path stripped. The
// rest of the line is never printed — arguments often carry secrets — so `node
// …/src/index.ts` becomes `node`.
export function executableBasename(command: string): string {
  const cleaned = stripEnvAssignments(command).trim();
  if (cleaned.length === 0) {
    return '';
  }
  // The first token is the executable; quoted basenames are not used by these processes.
  const firstToken = cleaned.split(/\s+/)[0] ?? '';
  const slash = firstToken.lastIndexOf('/');
  return slash === -1 ? firstToken : firstToken.slice(slash + 1);
}

// Reads `ps -Ao pid=,command=`: a pid is inside when the line contains `<worktree>/`
// anywhere, which catches interpreter-first commands, and `zilar-T-0047` never matches
// `zilar-T-00470`.
function parsePs(output: string, worktree: string): Map<number, string> {
  const map = new Map<number, string>();
  const needle = worktree.endsWith('/') ? worktree : `${worktree}/`;
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }
    const match = /^(\d+)\s+(.*)$/.exec(line);
    if (match === null) {
      continue;
    }
    const pid = Number.parseInt(match[1] ?? '', 10);
    const command = match[2] ?? '';
    if (!Number.isFinite(pid)) {
      continue;
    }
    if (command.includes(needle) || command === worktree) {
      if (!map.has(pid)) {
        map.set(pid, command);
      }
    }
  }
  return map;
}

export function findProcessesInWorktree(worktree: string, deps: FindProcsDeps): CandidateProcess[] {
  const cwdByPid = parseLsof(deps.lsof(worktree), worktree);
  const commandByPid = parsePs(deps.ps(worktree), worktree);
  const pids = new Set<number>([...cwdByPid.keys(), ...commandByPid.keys()]);
  const result: CandidateProcess[] = [];
  for (const pid of pids) {
    if (pid === deps.currentPid || pid === deps.parentPid) {
      continue;
    }
    if (pid <= 0) {
      continue;
    }
    const command = commandByPid.get(pid) ?? cwdByPid.get(pid) ?? '';
    result.push({ pid, command });
  }
  return result;
}

// `command` is the executable's basename, never argv; `survived` means SIGKILL did not
// end the process.
export interface StoppedProcess {
  pid: number;
  command: string;
  survived: boolean;
}

export interface StopProcessesDeps {
  // Injectable so tests avoid the real OS; defaults to `process.kill`.
  kill?: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void;
  now?: () => number;
  // Sleep seam: resolves after the given ms. Must NOT wait beyond the deadline;
  // the deadline is checked after each wait.
  sleep?: (ms: number) => Promise<void>;
  // Probe seam: true when the process has exited; defaults to kill(pid, 0).
  exited?: (pid: number) => boolean;
}

function defaultKill(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
  process.kill(pid, signal);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultExited(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

// SIGTERM every candidate, wait up to `EXIT_WAIT_MS`, then SIGKILL survivors. A pid
// is reported only when observed gone afterwards; survivors come back `survived: true`
// so the caller logs `could not stop`.
export async function stopWorktreeProcesses(
  candidates: CandidateProcess[],
  deps: StopProcessesDeps = {},
): Promise<StoppedProcess[]> {
  const kill = deps.kill ?? defaultKill;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const exited = deps.exited ?? defaultExited;
  const stopped: StoppedProcess[] = [];
  for (const candidate of candidates) {
    const command = executableBasename(candidate.command);
    // Probe before signaling: a pid already gone is not something we stopped.
    if (exited(candidate.pid)) {
      continue;
    }
    try {
      kill(candidate.pid, 'SIGTERM');
    } catch {
      if (exited(candidate.pid)) {
        continue;
      }
      stopped.push({ pid: candidate.pid, command, survived: true });
      continue;
    }
    const deadline = now() + EXIT_WAIT_MS;
    while (now() < deadline) {
      if (exited(candidate.pid)) {
        break;
      }
      await sleep(EXIT_POLL_MS);
    }
    if (!exited(candidate.pid)) {
      try {
        kill(candidate.pid, 'SIGKILL');
      } catch {
        // The kill failed; a post-probe below decides.
      }
    }
    // Re-probe after SIGKILL: still alive means `survived`, not a clean stop.
    if (exited(candidate.pid)) {
      stopped.push({ pid: candidate.pid, command, survived: false });
    } else {
      stopped.push({ pid: candidate.pid, command, survived: true });
    }
  }
  return stopped;
}

// `lsof` reports the cwd of every process; we read it from the output, not from where
// the command ran. macOS only.
export function defaultLsof(_cwd: string): string {
  const result = spawnSync('lsof', ['-a', '-d', 'cwd', '-F', 'pn'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (result.error !== undefined) {
    throw new Error(`lsof failed to start: ${String(result.error)}`);
  }
  if (result.status !== 0) {
    throw new Error(`lsof exited ${String(result.status)}`);
  }
  return result.stdout;
}

export function defaultPs(_cwd: string): string {
  const result = spawnSync('ps', ['-Ao', 'pid=,command='], {
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
}

export function leadProcessIds(): { currentPid: number; parentPid: number } {
  return { currentPid: process.pid, parentPid: process.ppid };
}
