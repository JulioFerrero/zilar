import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Schema } from 'effect';
import { readCappedFile } from '../capture';
import { relativeTo, resolveInside } from '../paths';
import { runCommand } from '../process';
import { defineTool, outcome, type ToolContext, type ToolEntry, type ToolOutcome } from '../tool';
import type { ToolName } from '../protocol';

const bashArgs = Schema.Struct({
  command: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  cwd: Schema.optional(Schema.String),
  timeout_ms: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
});

type BashArgs = typeof bashArgs.Type;

/**
 * `/bin/bash -lc` in a fresh shell; `runCommand` puts it in its own process group
 * and kills the tree on timeout or when the output cap is reached.
 */
async function runBash(args: BashArgs, ctx: ToolContext): Promise<ToolOutcome> {
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

const editArgs = Schema.Struct({
  path: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  oldString: Schema.String,
  newString: Schema.String,
  replaceAll: Schema.optional(Schema.Boolean),
});

type EditArgs = typeof editArgs.Type;

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Exact string replacement; fails when `oldString` is not unique unless `replaceAll`. */
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

// Options a task may not pass because they inject config or run a program.
// `GIT_ALLOW_PROTOCOL=https` enforces the transport, so arguments need no remote
// parsing; the jail is the real boundary, this stops a repo running hooks or
// reading local files through git. Matched exactly and with `=value`.
const REFUSED_OPTIONS = [
  '--config',
  '--config-env',
  '--exec',
  '--exec-path',
  '--receive-pack',
  '--upload-pack',
];

const gitArgs = Schema.Struct({
  args: Schema.Array(Schema.String),
});

type GitArgs = typeof gitArgs.Type;

// `-c` in any form (`-c foo=bar`, `-cfoo=bar`) and the long options above; bare `-u`
// is left alone because it is also `push -u`, and `GIT_ALLOW_PROTOCOL=https` makes
// `--upload-pack` harmless.
function refusedFlag(args: readonly string[]): string | undefined {
  return args.find(
    (arg) =>
      arg.startsWith('-c') ||
      REFUSED_OPTIONS.some((option) => arg === option || arg.startsWith(`${option}=`)),
  );
}

export async function runGit(args: GitArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const flag = refusedFlag(args.args);
  if (flag !== undefined) {
    return outcome({
      exitCode: 1,
      error: { code: 'tool_failed', message: `git flag is not allowed: ${flag}` },
    });
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_ALLOW_PROTOCOL: 'https',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
  const hardened = [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'protocol.file.allow=never',
    ...args.args,
  ];
  const result = await runCommand('git', hardened, {
    cwd: ctx.workspace.root,
    env,
    maxOutputBytes: ctx.maxOutputBytes,
    signal: ctx.signal,
  });
  if (result.spawnError !== undefined) {
    return outcome({ exitCode: 127, error: { code: 'tool_failed', message: result.spawnError } });
  }
  return outcome({
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    truncated: result.truncated,
    ...(result.aborted ? { error: { code: 'timeout' as const, message: 'git timed out' } } : {}),
  });
}

const DEFAULT_GLOB_RESULTS = 1000;

const globArgs = Schema.Struct({
  pattern: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  path: Schema.optional(Schema.String),
});

type GlobArgs = typeof globArgs.Type;

/** Sorted file paths matching a glob under `path`, capped (plan §3.2). */
async function runGlob(args: GlobArgs, ctx: ToolContext): Promise<ToolOutcome> {
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
  const capped = files.slice(0, DEFAULT_GLOB_RESULTS);
  return outcome({
    stdout: capped.length === 0 ? '' : `${capped.join('\n')}\n`,
    exitCode: 0,
    truncated: files.length > capped.length || result.truncated,
  });
}

const DEFAULT_MAX_RESULTS = 200;

const grepArgs = Schema.Struct({
  pattern: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  path: Schema.optional(Schema.String),
  glob: Schema.optional(Schema.String),
  max_results: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
});

type GrepArgs = typeof grepArgs.Type;

interface RgMatchEvent {
  readonly path: string;
  readonly lineNumber: number;
  readonly text: string;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
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
async function runGrep(args: GrepArgs, ctx: ToolContext): Promise<ToolOutcome> {
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

const DEFAULT_LIMIT_LINES = 2000;

const readArgs = Schema.Struct({
  path: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  offset: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
  limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
});

type ReadArgs = typeof readArgs.Type;

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

const writeArgs = Schema.Struct({
  path: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  content: Schema.String,
});

type WriteArgs = typeof writeArgs.Type;

/** Writes a file, creating parent directories inside the workspace. */
async function runWrite(args: WriteArgs, ctx: ToolContext): Promise<ToolOutcome> {
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

export const tools: Record<ToolName, ToolEntry> = {
  bash: defineTool(bashArgs, runBash),
  read: defineTool(readArgs, runRead),
  write: defineTool(writeArgs, runWrite),
  edit: defineTool(editArgs, runEdit),
  grep: defineTool(grepArgs, runGrep),
  glob: defineTool(globArgs, runGlob),
  git: defineTool(gitArgs, runGit),
};
