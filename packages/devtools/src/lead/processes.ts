import { spawnSync } from 'node:child_process';

export interface CandidateProcess {
  pid: number;
  command: string;
}

export interface FindProcsDeps {
  // macOS: `lsof -a -d cwd -Fpn` prints lines like `p123\nn/worktree/path`.
  lsof: (cwd: string) => string;
  // macOS: `ps -Ao pid=,command=`.
  ps: (cwd: string) => string;
  // pid of the lead process and its parent. Both are excluded so the lead
  // never accidentally kills itself while stopping worktree processes.
  currentPid: number;
  parentPid: number;
}

const COMMAND_MAX = 80;
const EXIT_WAIT_MS = 5_000;
const EXIT_POLL_MS = 50;

// True only when `candidate` lives inside `worktree`. Matches the exact
// worktree path, or a path that starts with the worktree plus a separator, so
// `galena-T-0047` never matches `galena-T-00470`. Comparison is case-sensitive
// on purpose: macOS filesystems are case-insensitive but case-preserving, and
// process cwd strings come from the kernel unchanged.
function isInsideWorktree(worktree: string, candidate: string): boolean {
  if (candidate === worktree) {
    return true;
  }
  const prefix = worktree.endsWith('/') ? worktree : `${worktree}/`;
  return candidate.startsWith(prefix);
}

// Reads `lsof -a -d cwd -Fpn` output. Each block has `p<pid>` followed by
// one or more `n<cwd>` lines. The cwd always uses a leading slash, so the
// match is exact-prefixed.
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
        // `lsof` may list multiple `n` lines per pid (cwd + text files); only
        // the cwd one (the first) is the worktree cwd. Keep the first hit.
        if (!map.has(currentPid)) {
          map.set(currentPid, cwd);
        }
      }
    }
  }
  return map;
}

// Reads `ps -Ao pid=,command=` output. Each line is `<pid> <command>`. The
// command field is truncated by ps on macOS, but is fine for our purposes.
// A pid counts as "inside" only if its command line starts with the worktree
// path (so build runners launched from the worktree are caught).
function parsePs(output: string, worktree: string): Map<number, string> {
  const map = new Map<number, string>();
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
    if (isInsideWorktree(worktree, command)) {
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

export interface StopProcessesDeps {
  // Injectable so tests can avoid touching the real OS. Defaults to
  // `process.kill`. The signature matches `process.kill`: signal may be a
  // string (e.g. 'SIGTERM') or a number.
  kill?: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void;
  // Clock seam: returns the current time in ms. Defaults to `Date.now`.
  now?: () => number;
  // Sleep seam: resolves after the given ms. Defaults to a setTimeout-based
  // sleep. Must NOT be used to keep waiting beyond the deadline; the deadline
  // is checked after each wait.
  sleep?: (ms: number) => Promise<void>;
  // Probe seam: true when the process has exited. Defaults to kill(pid, 0)
  // which throws ESRCH when the pid is gone.
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

// Strips `FOO=bar ` env assignments from the start of a command line, the
// way the shell does before exec. Anything left is the actual command, so the
// stop message never reveals a user's environment to the lead.log file.
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

// Stops every candidate with SIGTERM, waits up to EXIT_WAIT_MS for each, and
// SIGKILLs the survivors. Returns one message per stopped process, ready to
// print. The pid of each process is preserved in the message so the caller can
// log it; the command is truncated to COMMAND_MAX characters and the message
// never includes environment variables.
export async function stopWorktreeProcesses(
  candidates: CandidateProcess[],
  deps: StopProcessesDeps = {},
): Promise<{ pid: number; command: string }[]> {
  const kill = deps.kill ?? defaultKill;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const exited = deps.exited ?? defaultExited;
  const stopped: { pid: number; command: string }[] = [];
  for (const candidate of candidates) {
    const sanitized = stripEnvAssignments(candidate.command).slice(0, COMMAND_MAX);
    try {
      kill(candidate.pid, 'SIGTERM');
    } catch {
      // Already gone: the probe would have caught it, but a race can leave
      // a dead pid between find and kill. Treat as stopped and move on.
      stopped.push({ pid: candidate.pid, command: sanitized });
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
        // Race: the process died between the probe and SIGKILL. Nothing to do.
      }
    }
    stopped.push({ pid: candidate.pid, command: sanitized });
  }
  return stopped;
}

// Runs `lsof -a -d cwd -Fpn` and returns its stdout. The cwd is the worktree
// because `lsof` reports the cwd of every process on the system and we read
// it back from the output, not from where we ran the command. On macOS this
// is the supported way; on Linux `ls /proc/<pid>/cwd` would also work but
// we only target macOS today.
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

// Runs `ps -Ao pid=,command=` and returns its stdout.
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

// Used in cli.ts to satisfy the FindProcsDeps.currentPid/parentPid fields.
export function leadProcessIds(): { currentPid: number; parentPid: number } {
  return { currentPid: process.pid, parentPid: process.ppid };
}
