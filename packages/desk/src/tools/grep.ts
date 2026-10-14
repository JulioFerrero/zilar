import { Schema } from 'effect';
import { relativeTo, resolveInside } from '../paths';
import { runCommand } from '../process';
import { outcome, type ToolContext, type ToolOutcome } from '../tool';

const DEFAULT_MAX_RESULTS = 200;

export const grepArgs = Schema.Struct({
  pattern: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  path: Schema.optional(Schema.String),
  glob: Schema.optional(Schema.String),
  max_results: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
});

export type GrepArgs = typeof grepArgs.Type;

interface RgMatchEvent {
  readonly path: string;
  readonly lineNumber: number;
  readonly text: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function textOf(value: unknown): string | undefined {
  const record = asRecord(value);
  return typeof record?.text === 'string' ? record.text : undefined;
}

function asMatchEvent(value: unknown): RgMatchEvent | undefined {
  const event = asRecord(value);
  if (event?.type !== 'match') {
    return undefined;
  }
  const data = asRecord(event.data);
  const path = textOf(data?.path);
  const text = textOf(data?.lines);
  const lineNumber = data?.line_number;
  if (path === undefined || text === undefined || typeof lineNumber !== 'number') {
    return undefined;
  }
  return { path, lineNumber, text: text.replace(/\r?\n$/, '') };
}

/** ripgrep with `--json`, capped by result count and by the request's byte cap. */
export async function runGrep(args: GrepArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const base = resolveInside(ctx.workspace, args.path ?? '.');
  const maxResults = args.max_results ?? DEFAULT_MAX_RESULTS;
  const argv = ['--json', '--color', 'never', '-e', args.pattern];
  if (args.glob !== undefined) {
    argv.push('--glob', args.glob);
  }
  argv.push(base);
  const result = await runCommand('rg', argv, {
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
  const matches: string[] = [];
  let hitCap = false;
  for (const line of result.stdout.split('\n')) {
    if (matches.length >= maxResults) {
      hitCap = true;
      break;
    }
    if (!line.startsWith('{')) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const event = asMatchEvent(parsed);
    if (event !== undefined) {
      matches.push(`${relativeTo(ctx.workspace, event.path)}:${event.lineNumber}:${event.text}`);
    }
  }
  return outcome({
    stdout: matches.length === 0 ? '' : `${matches.join('\n')}\n`,
    exitCode: 0,
    truncated: hitCap || result.truncated,
  });
}
