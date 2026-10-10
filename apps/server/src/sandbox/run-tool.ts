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
import {
  MAX_SOURCE_BYTES,
  parseToolOutput,
  resolveLimits,
  withFetchPrefix,
  type RunToolResult,
  type SandboxErrorKind,
  type SandboxLimits,
} from './types';

// The public entry point. It never runs tool code in this thread: every
// execution spawns a worker with the QuickJS VM, and the worker is
// terminated when the wall clock passes. The parent validates fetch
// requests (allowlist + SSRF guard) and performs the real HTTPS calls.

export interface RunToolParams {
  source: string;
  input?: unknown;
  allowedHosts: readonly string[];
  limits?: Partial<SandboxLimits>;
  fetcher?: HostFetcher;
  resolver?: DnsResolver;
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

type WorkerResultMessage = Schema.Schema.Type<typeof workerResultSchema>;

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

const outputJsonSchema = Schema.Struct({
  text: Schema.String,
  data: Schema.optional(Schema.Unknown),
});

// The worker failed to start (missing tsx hook, `worker_threads` refused). It
// is a control signal inside this module only: the Promise boundary turns it
// into the same fixed `sandbox_failure` result the old try/catch returned.
class SandboxStartFailed extends Data.TaggedError('SandboxStartFailed') {}

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

  // Production runs the bundle: `dist/tool-worker.mjs` sits next to
  // `dist/index.mjs`, is plain JavaScript and needs no loader.
  const bundled = !import.meta.url.endsWith('.ts');
  const workerPath = fileURLToPath(
    new URL(bundled ? './tool-worker.mjs' : './tool-worker.ts', import.meta.url),
  );
  // The worker entry is TypeScript. The main thread may run under tsx, plain
  // node, or vitest (whose workers do not inherit a TS loader), so always
  // bootstrap through an eval wrapper that registers tsx's CJS hook and then
  // requires the entry. Both paths are resolved from this module, never from
  // the process working directory, so the server can start anywhere.
  const workerOptions = {
    workerData: {
      source: params.source,
      inputJson,
      allowedHosts: [...params.allowedHosts],
      limits,
    },
    resourceLimits: {
      maxOldGenerationSizeMb: Math.max(
        32,
        Math.ceil((limits.memoryBytes + 16 * 1024 * 1024) / (1024 * 1024)),
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

  // The worker is a scoped resource: `acquireRelease` terminates it on every
  // exit path — success, failure, or the wall-clock timeout interrupting the
  // run. The listeners resume one `Effect.callback`; a later event is ignored
  // by `resume`, the same guard `settled` provided. Fetch requests keep the
  // old handling: validated here, then answered asynchronously.
  const runWorker = (worker: Worker): Effect.Effect<RunToolResult> => {
    let fetchCount = 0;
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
            if (!check.ok) {
              fetchFailed(check.message);
              return;
            }
            // The fetcher ignores tool-supplied headers: the real request always
            // sends only `accept: */*` plus the fixed `ZilarTool/1` user-agent.
            // Anything the tool passes (authorization, cookies, …) never leaves
            // the sandbox, so there is nothing to forward or merge here.
            let response;
            try {
              response = await fetcher(check.request);
            } catch (error) {
              fetchFailed(error instanceof Error ? error.message : 'fetch failed');
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
        const message: WorkerResultMessage = event;
        fetchCount = message.fetchCount;
        if (message.type === 'error') {
          settle(fail(message.kind, message.message, message.fetchCount));
          return;
        }
        let parsedOutput: unknown;
        try {
          parsedOutput = JSON.parse(message.outputJson) as unknown;
        } catch {
          settle(
            fail(
              'invalid_output',
              'tool must return a string or { text, data }',
              message.fetchCount,
            ),
          );
          return;
        }
        if (typeof parsedOutput === 'string') {
          const output = parseToolOutput({ text: parsedOutput }, limits.maxOutputBytes);
          if (output === null) {
            settle(
              fail(
                'invalid_output',
                'tool must return a string or { text, data }',
                message.fetchCount,
              ),
            );
            return;
          }
          settle({
            ok: true,
            output,
            logs: finishLogs(),
            durationMs: Date.now() - startedAt,
            fetchCount: message.fetchCount,
          });
          return;
        }
        const shaped = Schema.decodeUnknownOption(outputJsonSchema)(parsedOutput);
        if (Option.isNone(shaped)) {
          settle(
            fail(
              'invalid_output',
              'tool must return a string or { text, data }',
              message.fetchCount,
            ),
          );
          return;
        }
        const output = parseToolOutput(shaped.value, limits.maxOutputBytes);
        if (output === null) {
          settle(
            fail(
              'invalid_output',
              'tool must return a string or { text, data }',
              message.fetchCount,
            ),
          );
          return;
        }
        settle({
          ok: true,
          output,
          logs: finishLogs(),
          durationMs: Date.now() - startedAt,
          fetchCount: message.fetchCount,
        });
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
