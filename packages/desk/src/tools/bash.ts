import { Schema } from 'effect';
import { resolveInside } from '../paths';
import { runCommand } from '../process';
import { outcome, type ToolContext, type ToolOutcome } from '../tool';

export const bashArgs = Schema.Struct({
  command: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  cwd: Schema.optional(Schema.String),
  timeout_ms: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
});

export type BashArgs = typeof bashArgs.Type;

/**
 * `/bin/bash -lc` in a fresh shell; `runCommand` puts it in its own process group
 * and kills the tree on timeout or when the output cap is reached.
 */
export async function runBash(args: BashArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const cwd = resolveInside(ctx.workspace, args.cwd ?? '.');
  const result = await runCommand('/bin/bash', ['-lc', args.command], {
    cwd,
    maxOutputBytes: ctx.maxOutputBytes,
    signal: ctx.signal,
  });
  if (result.spawnError !== undefined) {
    return outcome({
      exitCode: 127,
      stderr: result.stderr,
      error: { code: 'tool_failed', message: result.spawnError },
    });
  }
  return outcome({
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    truncated: result.truncated,
    ...(result.aborted
      ? { error: { code: 'timeout' as const, message: 'command timed out' } }
      : {}),
  });
}
