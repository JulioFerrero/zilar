import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Schema } from 'effect';
import { relativeTo, resolveInside } from '../paths';
import { outcome, type ToolContext, type ToolOutcome } from '../tool';

export const writeArgs = Schema.Struct({
  path: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  content: Schema.String,
});

export type WriteArgs = typeof writeArgs.Type;

/** Writes a file, creating parent directories inside the workspace. */
export async function runWrite(args: WriteArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const absolute = resolveInside(ctx.workspace, args.path);
  const bytes = Buffer.byteLength(args.content, 'utf8');
  if (bytes > ctx.maxOutputBytes) {
    return outcome({
      exitCode: 1,
      error: {
        code: 'output_too_large',
        message: `content is larger than ${ctx.maxOutputBytes} bytes`,
      },
    });
  }
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, args.content, 'utf8');
  return outcome({
    stdout: `wrote ${bytes} bytes to ${relativeTo(ctx.workspace, absolute)}\n`,
    exitCode: 0,
  });
}
