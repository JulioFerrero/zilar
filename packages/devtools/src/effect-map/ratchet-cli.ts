// The Effect ratchet check of `pnpm gate` (task R6):
//   tsx src/effect-map/ratchet-cli.ts --base <ref> <files...>
// Reads each counted source file from disk and its base version with `git show`,
// then prints one line per violation (see ratchet.ts) or one `ok` line. Exits 1
// when there is a violation, 2 on bad arguments. It writes nothing.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isCountedSource, repoRoot } from './generate.js';
import { ratchetViolations, type RatchetFile, type RatchetViolation } from './ratchet.js';

// No git call may hang the gate: each one gets this limit and a bounded buffer.
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isCommit(root: string, ref: string): boolean {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

// The base version of a file, or null when the base does not have it. `git
// show` exits with a status for a missing path; a call that was killed or could
// not start has no status and is rethrown, so it is never read as a new file.
function baseSource(root: string, base: string, file: string): string | null {
  try {
    return git(root, ['show', `${base}:${file}`]);
  } catch (error) {
    const { status } = error as { status?: unknown };
    if (typeof status !== 'number') throw error;
    return null;
  }
}

export function parseArgs(argv: string[]): { base: string; files: string[] } | null {
  const index = argv.indexOf('--base');
  if (index < 0) return null;
  const base = argv[index + 1];
  if (base === undefined) return null;
  return { base, files: [...argv.slice(0, index), ...argv.slice(index + 2)] };
}

export function formatViolation(violation: RatchetViolation): string {
  const hit = violation.firstHit === null ? '' : `: ${violation.firstHit.text}`;
  return `effect: ${violation.path} needs Effect (${violation.signals.join(', ')})${hit}`;
}

function main(argv: string[]): number {
  const parsed = parseArgs(argv);
  if (parsed === null) {
    console.error('usage: ratchet-cli.ts --base <ref> <files...>');
    return 2;
  }
  const { base, files } = parsed;
  const root = repoRoot();
  if (!isCommit(root, base)) {
    console.error(`effect: ${base} is not a commit`);
    return 2;
  }
  const inputs: RatchetFile[] = files.filter(isCountedSource).map((file) => {
    const onDisk = path.join(root, file);
    return {
      path: file,
      branchSource: existsSync(onDisk) ? readFileSync(onDisk, 'utf8') : null,
      baseSource: baseSource(root, base, file),
    };
  });
  const checked = inputs.filter((file) => file.branchSource !== null).length;
  const violations = ratchetViolations(inputs);
  for (const violation of violations) {
    console.log(formatViolation(violation));
  }
  if (violations.length > 0) return 1;
  console.log(`effect: ok (${checked} files checked)`);
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = main(process.argv.slice(2));
}
