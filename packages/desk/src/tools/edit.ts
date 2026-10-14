import { writeFileSync } from 'node:fs';
import { Schema } from 'effect';
import { readCappedFile } from '../capture';
import { relativeTo, resolveInside } from '../paths';
import { outcome, type ToolContext, type ToolOutcome } from '../tool';

export const editArgs = Schema.Struct({
  path: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  oldString: Schema.String,
  newString: Schema.String,
  replaceAll: Schema.optional(Schema.Boolean),
});

export type EditArgs = typeof editArgs.Type;

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Exact string replacement. Fails when `oldString` is not unique unless
 * `replaceAll` is set (plan §3.2).
 */
export async function runEdit(args: EditArgs, ctx: ToolContext): Promise<ToolOutcome> {
  if (args.oldString.length === 0) {
    return outcome({
      exitCode: 1,
      error: { code: 'tool_failed', message: 'oldString must not be empty' },
    });
  }
  const absolute = resolveInside(ctx.workspace, args.path);
  const { text: before, tooLarge } = readCappedFile(absolute, ctx.maxOutputBytes);
  if (tooLarge) {
    return outcome({
      exitCode: 1,
      error: {
        code: 'output_too_large',
        message: `file is larger than ${ctx.maxOutputBytes} bytes`,
      },
    });
  }
  const matches = countOccurrences(before, args.oldString);
  if (matches === 0) {
    return outcome({ exitCode: 1, error: { code: 'tool_failed', message: 'oldString not found' } });
  }
  if (matches > 1 && args.replaceAll !== true) {
    return outcome({
      exitCode: 1,
      error: {
        code: 'tool_failed',
        message: `oldString is not unique (${matches} matches); pass replaceAll to replace every one`,
      },
    });
  }
  const after =
    args.replaceAll === true
      ? before.split(args.oldString).join(args.newString)
      : before.replace(args.oldString, args.newString);
  writeFileSync(absolute, after, 'utf8');
  const replaced = args.replaceAll === true ? matches : 1;
  return outcome({
    stdout: `replaced ${replaced} occurrence(s) in ${relativeTo(ctx.workspace, absolute)}\n`,
    exitCode: 0,
  });
}
