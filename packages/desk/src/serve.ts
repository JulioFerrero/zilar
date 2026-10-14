import { pathToFileURL } from 'node:url';
import { Exit, Schema } from 'effect';
import { openWorkspace, type Workspace } from './paths';
import {
  DeskError,
  doneResponse,
  errorResponse,
  RequestSchema,
  streamResponse,
  type Request,
  type Response,
} from './protocol';
import { tools } from './tools';
import type { ToolOutcome } from './tool';

export const DEFAULT_TIMEOUT_MS = 600_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

/** Node fires a `setTimeout` delay above this at once, so it is the ceiling. */
const MAX_TIMEOUT_MS = 2_147_483_647;

export interface ServeOptions {
  readonly workspaceRoot: string;
  readonly maxOutputBytes: number;
  readonly defaultTimeoutMs: number;
}

type Writer = (response: Response) => Promise<void>;

function positiveIntFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function optionsFromEnv(env: NodeJS.ProcessEnv): ServeOptions {
  return {
    workspaceRoot: env.DESK_WORKSPACE_ROOT ?? '/workspace',
    maxOutputBytes: positiveIntFromEnv(env.DESK_MAX_OUTPUT_BYTES, DEFAULT_MAX_OUTPUT_BYTES),
    defaultTimeoutMs: positiveIntFromEnv(env.DESK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function timeoutFor(rawArgs: unknown, fallback: number): number {
  const value = asRecord(rawArgs)?.timeout_ms;
  const requested =
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
  return Math.min(requested, MAX_TIMEOUT_MS);
}

function idOf(parsed: unknown): number {
  const id = asRecord(parsed)?.id;
  return typeof id === 'number' && Number.isSafeInteger(id) && id >= 0 ? id : 0;
}

function errorOutcome(error: unknown): ToolOutcome {
  if (error instanceof DeskError) {
    return {
      stdout: '',
      stderr: '',
      exitCode: 1,
      truncated: false,
      error: { code: error.code, message: error.message },
    };
  }
  return {
    stdout: '',
    stderr: '',
    exitCode: 1,
    truncated: false,
    error: { code: 'tool_failed', message: error instanceof Error ? error.message : 'tool failed' },
  };
}

/** Serializes writes so concurrent requests never interleave a line. */
function createWriter(output: NodeJS.WritableStream): Writer {
  let queue: Promise<void> = Promise.resolve();
  return (response) => {
    queue = queue.then(
      () =>
        new Promise<void>((resolve) => {
          output.write(`${JSON.stringify(response)}\n`, () => resolve());
        }),
    );
    return queue;
  };
}

async function writeOutcome(id: number, result: ToolOutcome, write: Writer): Promise<void> {
  if (result.stdout.length > 0) {
    await write(streamResponse(id, 'stdout', result.stdout));
  }
  if (result.stderr.length > 0) {
    await write(streamResponse(id, 'stderr', result.stderr));
  }
  if (result.error !== undefined) {
    await write(errorResponse(id, result.error.code, result.error.message));
    return;
  }
  await write(doneResponse(id, result.exitCode, result.truncated));
}

async function runRequest(
  request: Request,
  workspace: Workspace,
  options: ServeOptions,
  write: Writer,
): Promise<void> {
  const entry = tools[request.tool];
  const decoded = Schema.decodeUnknownExit(entry.args)(request.args);
  if (!Exit.isSuccess(decoded)) {
    await write(errorResponse(request.id, 'tool_failed', `invalid arguments for ${request.tool}`));
    return;
  }
  const timeoutMs = timeoutFor(request.args, options.defaultTimeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let result: ToolOutcome;
  try {
    result = await entry.run(decoded.value, {
      workspace,
      maxOutputBytes: options.maxOutputBytes,
      defaultTimeoutMs: options.defaultTimeoutMs,
      signal: controller.signal,
    });
  } catch (error) {
    result = errorOutcome(error);
  } finally {
    clearTimeout(timer);
  }
  if (controller.signal.aborted && result.error === undefined) {
    result = { ...result, error: { code: 'timeout', message: `timed out after ${timeoutMs} ms` } };
  }
  await writeOutcome(request.id, result, write);
}

async function handleLine(
  line: string,
  workspace: Workspace,
  options: ServeOptions,
  write: Writer,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    await write(errorResponse(0, 'tool_failed', 'invalid JSON request'));
    return;
  }
  const decoded = Schema.decodeUnknownExit(RequestSchema)(parsed);
  if (!Exit.isSuccess(decoded)) {
    await write(errorResponse(idOf(parsed), 'tool_failed', 'invalid request'));
    return;
  }
  await runRequest(decoded.value, workspace, options, write);
}

/**
 * Reads newline-delimited JSON requests from `input` and writes response lines
 * to `output`. Requests overlap; each gets its own timeout and output cap.
 */
export async function serve(
  options: ServeOptions,
  input: AsyncIterable<Buffer | string>,
  output: NodeJS.WritableStream,
): Promise<void> {
  const workspace = openWorkspace(options.workspaceRoot);
  const write = createWriter(output);
  const inflight = new Set<Promise<void>>();
  const start = (line: string): void => {
    const task = handleLine(line, workspace, options, write);
    inflight.add(task);
    void task.finally(() => inflight.delete(task));
  };

  let buffer = '';
  for await (const chunk of input) {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        start(line);
      }
      newline = buffer.indexOf('\n');
    }
  }
  const tail = buffer.trim();
  if (tail.length > 0) {
    start(tail);
  }
  while (inflight.size > 0) {
    await Promise.allSettled(inflight);
  }
}

/** `desk-tool serve`: the only command the image's entrypoint runs. */
export async function main(argv: readonly string[]): Promise<number> {
  if (argv[2] !== 'serve') {
    process.stderr.write('usage: desk-tool serve\n');
    return 2;
  }
  await serve(optionsFromEnv(process.env), process.stdin, process.stdout);
  return 0;
}

/** The CLI runs only when this file is the entry point, not on a test import. */
const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  main(process.argv)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `desk-tool: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
