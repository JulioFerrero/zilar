import { Effect } from 'effect';
import { spawn } from 'node:child_process';
import { createCapture } from './capture';

export interface CommandOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly maxOutputBytes: number;
  readonly signal: AbortSignal;
}

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly truncated: boolean;
  readonly aborted: boolean;
  /** Set when the binary could not be spawned (for example ripgrep is absent). */
  readonly spawnError?: string;
}

function spawnAndCollect(
  command: string,
  args: readonly string[],
  options: CommandOptions,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const capture = createCapture(options.maxOutputBytes);
    let truncated = false;

    const killTree = (): void => {
      if (child.pid === undefined) {
        return;
      }
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // The process already exited; nothing to kill.
      }
    };

    const onData =
      (stream: 'stdout' | 'stderr') =>
      (chunk: Buffer): void => {
        if (capture.push(stream, chunk)) {
          truncated = true;
          killTree();
        }
      };

    child.stdout?.on('data', onData('stdout'));
    child.stderr?.on('data', onData('stderr'));

    const onAbort = (): void => killTree();
    options.signal.addEventListener('abort', onAbort, { once: true });

    let spawnError: string | undefined;
    child.on('error', (error) => {
      spawnError = error.message;
    });
    child.on('close', (code) => {
      options.signal.removeEventListener('abort', onAbort);
      const finished = capture.finish();
      resolve({
        stdout: finished.stdout,
        stderr: finished.stderr,
        exitCode: code ?? 0,
        truncated: truncated || finished.truncated,
        aborted: options.signal.aborted,
        ...(spawnError === undefined ? {} : { spawnError }),
      });
    });
  });
}

/**
 * Runs in its own process group so a timeout kills the whole tree; output is
 * capped and the tree dies when the cap is reached or the caller aborts.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  options: CommandOptions,
): Promise<CommandResult> {
  return Effect.runPromise(Effect.promise(() => spawnAndCollect(command, args, options)));
}
