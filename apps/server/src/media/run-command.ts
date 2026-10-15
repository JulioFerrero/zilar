// T-1496: the safe subprocess runner shared by the voice engine and the
// sticker converter. Moved byte for byte out of `voice/engine.ts` so more than
// one module can run ffmpeg with the same no-shell, hard-timeout guarantees.

import { spawn } from 'node:child_process';
import { Duration, Effect } from 'effect';

/** ffmpeg or ffprobe failed or timed out. */
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

// Runs a command with no shell, a hard timeout and captured output. The child
// is killed when the timeout fires or the fiber is interrupted, which keeps a
// hostile input from pinning the server. A non-zero exit is handed back to the
// caller, which decides what it means.
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

    // Runs on timeout or interrupt: kill the child unless it already settled.
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
