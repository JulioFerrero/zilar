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

// Strips `FOO=bar ` env assignments from the start of a command line, the
// way the shell does before exec. Returns the rest so the caller can split
// off the executable name without env-leak noise.
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

// Returns the basename of the executable in a `ps` line: the first whitespace-
// delimited token after env assignments, with any leading path stripped. We
// never print the rest of the command line — arguments often carry secrets
// (`--token=…`, `-e PASSWORD=…`, etc.) and there's no safe way to scrub them.
// `node` running `/…/galena-T-0047/apps/server/src/index.ts` becomes `node`;
// `…/galena-T-0047/node_modules/.bin/vite` becomes `vite`.
export function executableBasename(command: string): string {
  const cleaned = stripEnvAssignments(command).trim();
  if (cleaned.length === 0) {
    return '';
  }
  // The first token is the executable. Quote-aware split isn't needed: a
  // basename with whitespace would already be unusable in the print line, and
  // none of the worktree processes we care about use quoted paths.
  const firstToken = cleaned.split(/\s+/)[0] ?? '';
  const slash = firstToken.lastIndexOf('/');
  return slash === -1 ? firstToken : firstToken.slice(slash + 1);
}

// Reads `ps -Ao pid=,command=` output. Each line is `<pid> <command>`. A pid
// counts as "inside" when the command line contains the worktree path with a
// trailing separator (`<worktree>/…`) anywhere in it. Exact-prefix matters:
// `galena-T-0047` never matches `galena-T-00470`. This catches interpreter-
// first commands (`node /…/galena-T-0047/apps/server/src/index.ts`) which
// have no worktree path as their leading token.
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

// One entry in the result. `command` is the basename of the executable; we
// never include argv. `survived` is true for the few cases where SIGKILL did
// not end the process — the lead logs these as `could not stop`.
export interface StoppedProcess {
  pid: number;
  command: string;
  survived: boolean;
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

// Stops every candidate with SIGTERM, waits up to EXIT_WAIT_MS for each, and
// SIGKILLs the survivors. A pid is reported only when we observed it gone
// afterwards: pids that were already gone before TERM (race) and pids that
// survived SIGKILL are both filtered out. Survivors are returned with
// `survived: true` so the caller can log `could not stop` separately.
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
    // Probe before signaling: a pid that is already gone is not something we
    // stopped. Report nothing rather than `stop <pid>` for a corpse.
    if (exited(candidate.pid)) {
      continue;
    }
    try {
      kill(candidate.pid, 'SIGTERM');
    } catch {
      // The kill itself failed (ESRCH race or permission). If the pid is
      // truly gone now, fall through to the post-probe below; if not, we
      // count it as survived so the lead knows.
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
        // Race: the process died between the probe and SIGKILL. Nothing to do.
      }
    }
    // Re-probe after SIGKILL: if the pid is still alive (a kernel-protected
    // pid we can't kill, a process in uninterruptible sleep, etc.), report
    // it as survived rather than as a clean stop.
    if (exited(candidate.pid)) {
      stopped.push({ pid: candidate.pid, command, survived: false });
    } else {
      stopped.push({ pid: candidate.pid, command, survived: true });
    }
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
