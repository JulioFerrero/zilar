import { spawn } from 'node:child_process';
import { Duration, Effect } from 'effect';

export class FfmpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FfmpegError';
  }
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

// No shell, a hard timeout and captured output. The child is killed on timeout or fiber
// interrupt, so a hostile input cannot pin the server.
export function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Effect.Effect<CommandResult, FfmpegError> {
  return Effect.callback<CommandResult, FfmpegError>((resume) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const finish = (effect: Effect.Effect<CommandResult, FfmpegError>): void => {
      if (settled) return;
      settled = true;
      resume(effect);
    };

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      finish(Effect.fail(new FfmpegError(`${command} could not be started: ${error.message}`)));
    });
    child.on('close', (code) => {
      finish(
        Effect.succeed({
          code: code ?? -1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        }),
      );
    });

    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(timeoutMs),
      orElse: () => Effect.fail(new FfmpegError(`${command} timed out after ${timeoutMs}ms`)),
    }),
  );
}
