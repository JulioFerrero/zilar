import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Data, Duration, Effect, Option, Schema } from 'effect';
import {
  createDefaultFetcher,
  validateFetchRequest,
  type DnsResolver,
  type HostFetcher,
} from './host-fetch';
import { MAX_SOURCE_BYTES, resolveLimits, withFetchPrefix, type SandboxLimits } from './limits';

type SandboxErrorKind =
  | 'invalid_source'
  | 'syntax'
  | 'runtime'
  | 'timeout'
  | 'memory'
  | 'output_too_large'
  | 'invalid_output'
  | 'fetch_denied'
  | 'sandbox_failure';

interface ToolOutput {
  text: string;
  data?: unknown;
  blocks?: unknown;
  card?: unknown;
}

export type RunToolResult =
  | {
      ok: true;
      output: ToolOutput;
      logs: string;
      durationMs: number;
      fetchCount: number;
    }
  | {
      ok: false;
      error: { kind: SandboxErrorKind; message: string };
      logs: string;
      durationMs: number;
      fetchCount: number;
    };

const toolOutputSchema = Schema.Struct({
  text: Schema.String,
  data: Schema.optional(Schema.Unknown),
  blocks: Schema.optional(Schema.Unknown),
  card: Schema.optional(Schema.Unknown),
});

function parseToolOutput(value: unknown, maxBytes: number): ToolOutput | null {
  const parsed = Schema.decodeUnknownOption(toolOutputSchema)(value);
  if (Option.isNone(parsed)) {
    return null;
  }
  const output = parsed.value;
  if (output.text.length > maxBytes) {
    return null;
  }
  // `blocks` and `card` pass through unchecked; `buildBlocksPayload` rejects a
  // broken shape later, so a bad tool never breaks its own run.
  return {
    text: output.text,
    ...(output.data === undefined ? {} : { data: output.data }),
    ...(output.blocks === undefined ? {} : { blocks: output.blocks }),
    ...(output.card === undefined ? {} : { card: output.card }),
  };
}
const nonNegativeInt = Schema.Finite.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
);

const workerResultSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('result'),
    outputJson: Schema.String,
    fetchCount: nonNegativeInt,
    durationMs: Schema.Finite,
  }),
  Schema.Struct({
    type: Schema.Literal('error'),
    kind: Schema.Literals([
      'timeout',
      'memory',
      'runtime',
      'syntax',
      'invalid_output',
      'fetch_denied',
      'output_too_large',
    ]),
    message: Schema.String,
    fetchCount: nonNegativeInt,
    durationMs: Schema.Finite,
  }),
]);

const workerEventSchema = Schema.Union([
  workerResultSchema,
  Schema.Struct({ type: Schema.Literal('log'), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('fetch'),
    id: nonNegativeInt,
    url: Schema.String,
    method: Schema.String,
    headers: Schema.Record(Schema.String, Schema.String),
    bodyPresent: Schema.Boolean,
  }),
]);

export const outputJsonSchema = Schema.Struct({
  text: Schema.String,
  data: Schema.optional(Schema.Unknown),
  blocks: Schema.optional(Schema.Unknown),
  card: Schema.optional(Schema.Unknown),
});

function sanitizeMessage(message: string): string {
  return message
    .replace(/[A-Z]:[\\/][^\s]*/g, '[path]')
    .replace(/\/(?:app|home|Users)[^\s]*/g, '[path]')
    .replace(/node_modules[^\s]*/g, '[lib]')
    .replace(/wasm[^:\s]*:\d+/g, '[vm]')
    .replace(/\s+at\s+[^\n]*/g, '')
    .trim()
    .slice(0, 300);
}
// Never runs tool code in this thread: every execution spawns a QuickJS worker,
// terminated when the wall clock passes. The parent validates fetch requests
// (allowlist + SSRF guard) and performs the real HTTPS calls.

export interface RunToolParams {
  source: string;
  input?: unknown;
  allowedHosts: readonly string[];
  limits?: Partial<SandboxLimits>;
  fetcher?: HostFetcher;
  resolver?: DnsResolver;
}

// A control signal only: the Promise boundary turns it into a fixed
// `sandbox_failure` result.
class SandboxStartFailed extends Data.TaggedError('SandboxStartFailed') {}
// The worker's V8 heap holds the harness (Effect, the QuickJS glue, the tsx
// loader), ~45 MiB, plus queued logs, never the tool's own memory (the wasm heap
// caps that). 16 MiB of headroom aborted the worker under load.
const WORKER_HEAP_HEADROOM_BYTES = 96 * 1024 * 1024;

export async function runTool(params: RunToolParams): Promise<RunToolResult> {
  const startedAt = Date.now();
  const limits = resolveLimits(params.limits);

  if (Buffer.byteLength(params.source, 'utf8') > MAX_SOURCE_BYTES) {
    return {
      ok: false,
      error: { kind: 'invalid_source', message: 'tool source exceeds 64 KiB' },
      logs: '',
      durationMs: Date.now() - startedAt,
      fetchCount: 0,
    };
  }

  let inputJson: string;
  try {
    inputJson = JSON.stringify(params.input ?? null) ?? 'null';
  } catch {
    return {
      ok: false,
      error: { kind: 'invalid_source', message: 'tool input is not JSON-serialisable' },
      logs: '',
      durationMs: Date.now() - startedAt,
      fetchCount: 0,
    };
  }

  const fetcher: HostFetcher =
    params.fetcher ??
    createDefaultFetcher({
      fetchTimeoutMs: limits.fetchTimeoutMs,
      maxResponseBytes: limits.maxResponseBytes,
    });

  // The bundle is `dist/tool-worker.mjs`, plain JavaScript needing no loader.
  const bundled = !import.meta.url.endsWith('.ts');
  const workerPath = fileURLToPath(
    new URL(bundled ? './tool-worker.mjs' : './tool-worker.ts', import.meta.url),
  );
  // The worker entry is TypeScript, and vitest workers do not inherit a TS
  // loader, so always bootstrap through an eval wrapper that registers tsx's CJS
  // hook. Both paths resolve from this module, so the server can start anywhere.
  const workerOptions = {
    workerData: {
      source: params.source,
      inputJson,
      allowedHosts: [...params.allowedHosts],
      limits,
    },
    resourceLimits: {
      maxOldGenerationSizeMb: Math.ceil(
        (limits.memoryBytes + WORKER_HEAP_HEADROOM_BYTES) / (1024 * 1024),
      ),
      stackSizeMb: 8,
    },
  };
  const spawnWorker = (): Worker => {
    if (bundled) {
      return new Worker(workerPath, {
        workerData: workerOptions.workerData,
        resourceLimits: workerOptions.resourceLimits,
      });
    }
    const requireFromHere = createRequire(import.meta.url);
    const tsxHook = requireFromHere.resolve('tsx/cjs');
    const bootstrap = `require(${JSON.stringify(tsxHook)}); require(${JSON.stringify(workerPath)});`;
    return new Worker(bootstrap, {
      eval: true,
      workerData: workerOptions.workerData,
      resourceLimits: workerOptions.resourceLimits,
    });
  };

  const logLines: string[] = [];
  let logBytes = 0;
  let logTruncated = false;
  const pushLog = (text: string): void => {
    const line = text.slice(0, 2000);
    const bytes = Buffer.byteLength(line, 'utf8') + 1;
    if (logBytes + bytes > limits.maxLogBytes) {
      logTruncated = true;
      return;
    }
    logBytes += bytes;
    logLines.push(line);
  };

  const finishLogs = (): string => {
    const logs = logLines.join('\n');
    return logTruncated ? `${logs}\n…` : logs;
  };

  const fail = (kind: SandboxErrorKind, message: string, fetchCount: number): RunToolResult => ({
    ok: false,
    error: { kind, message: sanitizeMessage(message) },
    logs: finishLogs(),
    durationMs: Date.now() - startedAt,
    fetchCount,
  });

  // `acquireRelease` terminates the worker on every exit path, including the
  // timeout. One `Effect.callback` resumes; a later event is ignored. Fetch
  // requests are validated here, then answered asynchronously.
  const runWorker = (worker: Worker): Effect.Effect<RunToolResult> => {
    let fetchCount = 0;
    // One run owns its in-flight fetch; settling or terminating aborts it.
    const inFlight = new AbortController();
    return Effect.callback<RunToolResult>((resume) => {
      const settle = (result: RunToolResult): void => {
        resume(Effect.succeed(result));
      };

      const onMessage = (raw: unknown): void => {
        const parsed = Schema.decodeUnknownOption(workerEventSchema)(raw);
        if (Option.isNone(parsed)) {
          return;
        }
        const event = parsed.value;
        if (event.type === 'log') {
          pushLog(event.text);
          return;
        }
        if (event.type === 'fetch') {
          const fetchFailed = (message: string): void => {
            worker.postMessage({
              type: 'fetch-result',
              id: event.id,
              ok: false as const,
              message: withFetchPrefix(message),
            });
          };
          void (async () => {
            const check = await validateFetchRequest(
              {
                url: event.url,
                method: event.method,
                headers: event.headers,
                bodyPresent: event.bodyPresent,
              },
              {
                allowedHosts: params.allowedHosts,
                fetchTimeoutMs: limits.fetchTimeoutMs,
                maxResponseBytes: limits.maxResponseBytes,
                resolver: params.resolver,
              },
            );
            if (inFlight.signal.aborted) {
              return;
            }
            if (!check.ok) {
              fetchFailed(check.message);
              return;
            }
            // Tool-supplied headers never leave the sandbox: the real request sends
            // only `accept: */*` and the fixed `ZilarTool/1` user agent.
            let response;
            try {
              response = await fetcher(check.request, inFlight.signal);
            } catch (error) {
              if (inFlight.signal.aborted) {
                return;
              }
              fetchFailed(error instanceof Error ? error.message : 'fetch failed');
              return;
            }
            if (inFlight.signal.aborted) {
              return;
            }
            if (response.body.length > limits.maxResponseBytes) {
              fetchFailed('response too large');
              return;
            }
            worker.postMessage({
              type: 'fetch-result',
              id: event.id,
              ok: true as const,
              status: response.status,
              body: response.body,
            });
          })();
          return;
        }
        const message = event;
        fetchCount = message.fetchCount;
        const invalidOutput = (): void => {
          settle(
            fail(
              'invalid_output',
              'tool must return a string or { text, data?, blocks?, card? }',
              message.fetchCount,
            ),
          );
        };
        const settleOutput = (output: ToolOutput): void => {
          settle({
            ok: true,
            output,
            logs: finishLogs(),
            durationMs: Date.now() - startedAt,
            fetchCount: message.fetchCount,
          });
        };
        if (message.type === 'error') {
          settle(fail(message.kind, message.message, message.fetchCount));
          return;
        }
        let parsedOutput: unknown;
        try {
          parsedOutput = JSON.parse(message.outputJson) as unknown;
        } catch {
          invalidOutput();
          return;
        }
        if (typeof parsedOutput === 'string') {
          const output = parseToolOutput({ text: parsedOutput }, limits.maxOutputBytes);
          if (output === null) {
            invalidOutput();
            return;
          }
          settleOutput(output);
          return;
        }
        const shaped = Schema.decodeUnknownOption(outputJsonSchema)(parsedOutput);
        if (Option.isNone(shaped)) {
          invalidOutput();
          return;
        }
        const output = parseToolOutput(shaped.value, limits.maxOutputBytes);
        if (output === null) {
          invalidOutput();
          return;
        }
        settleOutput(output);
      };

      const onError = (): void => {
        settle(fail('sandbox_failure', 'tool sandbox failed', fetchCount));
      };
      const onExit = (code: number): void => {
        settle(
          fail(code === 0 ? 'runtime' : 'sandbox_failure', 'tool sandbox stopped', fetchCount),
        );
      };

      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.on('exit', onExit);
      return Effect.sync(() => {
        inFlight.abort();
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
      });
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(limits.wallMs + 500),
        orElse: () => Effect.succeed(fail('timeout', 'tool timed out', fetchCount)),
      }),
    );
  };

  const program = Effect.gen(function* () {
    const worker = yield* Effect.acquireRelease(
      Effect.try({ try: spawnWorker, catch: () => new SandboxStartFailed() }),
      (worker: Worker) =>
        Effect.sync(() => {
          void worker.terminate().catch(() => undefined);
        }),
    );
    return yield* runWorker(worker);
  });

  return Effect.runPromise(
    program.pipe(
      Effect.scoped,
      Effect.catchTag('SandboxStartFailed', () =>
        Effect.succeed(fail('sandbox_failure', 'could not start the tool sandbox', 0)),
      ),
    ),
  );
}
