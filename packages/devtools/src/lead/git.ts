import { spawnSync } from 'node:child_process';

export interface GitResult {
  ok: boolean;
  stdout: string;
}

export interface GitRunner {
  run(cwd: string, args: string[]): GitResult;
}

// Synchronous git for the lead tools. Output is captured, never piped
// through a shell, so filenames with spaces are safe.
export class RealGitRunner implements GitRunner {
  run(cwd: string, args: string[]): GitResult {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 120_000 });
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    if (result.error !== undefined) {
      throw new Error(`git ${args[0] ?? ''} failed to start: ${String(result.error)}`);
    }
    return { ok: (result.status ?? 1) === 0, stdout };
  }
}

export function porcelainLines(runner: GitRunner, cwd: string): string[] {
  const result = runner.run(cwd, ['status', '--porcelain']);
  if (!result.ok) {
    throw new Error(`git status failed in ${cwd}`);
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function currentHead(runner: GitRunner, cwd: string): string | undefined {
  const result = runner.run(cwd, ['rev-parse', 'HEAD']);
  if (!result.ok) {
    return undefined;
  }
  const head = result.stdout.trim();
  return /^[0-9a-f]{40}$/.test(head) ? head : undefined;
}
