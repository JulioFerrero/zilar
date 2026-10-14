import { Schema } from 'effect';
import { relativeTo, resolveInside } from '../paths';
import { runCommand } from '../process';
import { outcome, type ToolContext, type ToolOutcome } from '../tool';

const DEFAULT_MAX_RESULTS = 1000;

export const globArgs = Schema.Struct({
  pattern: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  path: Schema.optional(Schema.String),
});

export type GlobArgs = typeof globArgs.Type;

/** Sorted file paths matching a glob under `path`, capped (plan §3.2). */
export async function runGlob(args: GlobArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const base = resolveInside(ctx.workspace, args.path ?? '.');
  const result = await runCommand('rg', ['--files', '--glob', args.pattern, base], {
    cwd: ctx.workspace.root,
    maxOutputBytes: ctx.maxOutputBytes,
    signal: ctx.signal,
  });
  if (result.spawnError !== undefined) {
    return outcome({ exitCode: 1, error: { code: 'tool_failed', message: result.spawnError } });
  }
  if (result.exitCode > 1) {
    return outcome({
      exitCode: result.exitCode,
      stderr: result.stderr,
      error: { code: 'tool_failed', message: result.stderr.trim() || 'ripgrep failed' },
    });
  }
  const files = result.stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => relativeTo(ctx.workspace, line))
    .sort();
  const capped = files.slice(0, DEFAULT_MAX_RESULTS);
  return outcome({
    stdout: capped.length === 0 ? '' : `${capped.join('\n')}\n`,
    exitCode: 0,
    truncated: files.length > capped.length || result.truncated,
  });
}
