import { statSync } from 'node:fs';
import { Schema } from 'effect';
import { readCappedFile } from '../capture';
import { relativeTo, resolveInside } from '../paths';
import { outcome, type ToolContext, type ToolOutcome } from '../tool';

const DEFAULT_LIMIT_LINES = 2000;

export const readArgs = Schema.Struct({
  path: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  offset: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
  limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
});

export type ReadArgs = typeof readArgs.Type;

/** Reads a line window of a text file; refuses binary and huge files. */
export async function runRead(args: ReadArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const absolute = resolveInside(ctx.workspace, args.path);
  const stat = statSync(absolute, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile()) {
    return outcome({ exitCode: 1, error: { code: 'tool_failed', message: 'not a file' } });
  }
  const { text, tooLarge } = readCappedFile(absolute, ctx.maxOutputBytes);
  if (tooLarge) {
    return outcome({
      exitCode: 1,
      error: {
        code: 'output_too_large',
        message: `file is larger than ${ctx.maxOutputBytes} bytes`,
      },
    });
  }
  if (text.includes('\0')) {
    return outcome({ exitCode: 1, error: { code: 'tool_failed', message: 'binary file' } });
  }
  const lines = text.split('\n');
  const start = (args.offset ?? 1) - 1;
  const window = lines.slice(start, start + (args.limit ?? DEFAULT_LIMIT_LINES));
  return outcome({
    stdout: window.join('\n'),
    exitCode: 0,
    truncated: start + window.length < lines.length,
    ...(window.length === 0
      ? { stderr: `${relativeTo(ctx.workspace, absolute)}: no lines in that window\n` }
      : {}),
  });
}
