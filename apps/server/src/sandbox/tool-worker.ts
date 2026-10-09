import { parentPort, workerData } from 'node:worker_threads';
import { Cause, Duration, Effect } from 'effect';
import { getQuickJS, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten';
import type { FetchResponse } from './host-fetch';
import { MAX_SOURCE_BYTES, resolveLimits, withFetchPrefix, type SandboxLimits } from './limits';

// Runs inside the worker thread. It owns the QuickJS runtime for one tool
// execution and talks to the parent only through small JSON messages: log
// lines stream out, fetch requests go out and responses come back in.

interface WorkerParams {
  source: string;
  inputJson: string;
  allowedHosts: string[];
  limits: SandboxLimits;
}

interface WorkerFetchPayload {
  id: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyPresent: boolean;
}

type WorkerErrorKind =
  | 'timeout'
  | 'memory'
  | 'runtime'
  | 'syntax'
  | 'invalid_output'
  | 'fetch_denied'
  | 'output_too_large';

function dumpVmError(
  ctx: QuickJSContext,
  errorHandle: QuickJSHandle,
): { name: string; message: string } {
  try {
    const dumped: unknown = ctx.dump(errorHandle);
    if (typeof dumped === 'object' && dumped !== null) {
      const record = dumped as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name : 'Error';
      const message = typeof record.message === 'string' ? record.message : 'tool failed';
      return { name, message };
    }
    return { name: 'Error', message: String(dumped).slice(0, 300) };
  } catch {
    return { name: 'Error', message: 'tool failed' };
  }
}

function logToParent(text: string): void {
  parentPort?.postMessage({ type: 'log', text });
}

type Deferred = ReturnType<QuickJSContext['newPromise']>;

// The first matching `fetch-result` wins. The timeout is an Effect timer: when
// it fires, the callback is interrupted and its finalizer removes the listener.
function waitForFetchResponse(
  id: number,
  fetchTimeoutMs: number,
): Effect.Effect<FetchResponse, Error> {
  return Effect.callback<FetchResponse, Error>((resume) => {
    const onMessage = (message: unknown): void => {
      if (typeof message !== 'object' || message === null) {
        return;
      }
      const record = message as Record<string, unknown>;
      if (record.type !== 'fetch-result' || record.id !== id) {
        return;
      }
      parentPort?.off('message', onMessage);
      if (record.ok === true) {
        const body = record.body;
        resume(
          Effect.succeed({
            status: typeof record.status === 'number' ? record.status : 0,
            body: body instanceof Uint8Array ? body : new Uint8Array(0),
          }),
        );
        return;
      }
      resume(
        Effect.fail(
          new Error(typeof record.message === 'string' ? record.message : 'fetch failed'),
        ),
      );
    };
    parentPort?.on('message', onMessage);
    return Effect.sync(() => {
      parentPort?.off('message', onMessage);
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(fetchTimeoutMs + 1000),
      orElse: () => Effect.fail(new Error('fetch timeout')),
    }),
  );
}

// One macrotask turn, so fetch results and timers can run between job pumps.
const nextImmediate: Effect.Effect<void> = Effect.callback<void>((resume) => {
  const handle = setImmediate(() => {
    resume(Effect.void);
  });
  return Effect.sync(() => {
    clearImmediate(handle);
  });
});

const disposeQuietly = (dispose: () => void): Effect.Effect<boolean> =>
  Effect.match(Effect.try(dispose), { onFailure: () => false, onSuccess: () => true });

const run = Effect.gen(function* () {
  const params = workerData as WorkerParams;
  const limits = resolveLimits(params.limits);
  const startedAt = Date.now();

  const finish = (
    message:
      | { type: 'result'; outputJson: string; fetchCount: number; durationMs: number }
      | {
          type: 'error';
          kind: WorkerErrorKind;
          message: string;
          fetchCount: number;
          durationMs: number;
        },
  ): void => {
    parentPort?.postMessage(message);
  };

  if (Buffer.byteLength(params.source, 'utf8') > MAX_SOURCE_BYTES) {
    finish({
      type: 'error',
      kind: 'invalid_output',
      message: 'tool source is too large',
      fetchCount: 0,
      durationMs: 0,
    });
    return;
  }

  const QuickJS = yield* Effect.promise(() => getQuickJS());
  const runtime = QuickJS.newRuntime();
  const wallDeadline = startedAt + limits.wallMs;
  let fetchCount = 0;

  // cpuMs counts only time the VM is actually executing JS, never time
  // spent waiting on fetch. Every entry into the VM (evalCode,
  // callFunction, executePendingJobs) opens a segment; leaving closes it
  // and accumulates. The depth counter keeps nested entries (evalCode
  // inside a host function) from corrupting the total.
  let cpuUsedMs = 0;
  let vmDepth = 0;
  let segmentStartMs = 0;
  const enterVm = (): void => {
    if (vmDepth === 0) {
      segmentStartMs = Date.now();
    }
    vmDepth += 1;
  };
  const exitVm = (): void => {
    vmDepth -= 1;
    if (vmDepth === 0) {
      cpuUsedMs += Date.now() - segmentStartMs;
    }
  };
  const cpuConsumedMs = (): number => cpuUsedMs + (vmDepth > 0 ? Date.now() - segmentStartMs : 0);

  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  runtime.setInterruptHandler(() => Date.now() >= wallDeadline || cpuConsumedMs() >= limits.cpuMs);

  const context = runtime.newContext();

  // All VM entries go through these so cpu accounting stays complete.
  // Never call runtime.executePendingJobs() from inside a host function
  // (text, json, fetch): that would pump jobs re-entrantly from inside VM
  // execution. The main loop below already pumps after every return.
  const pumpJobs = () => {
    enterVm();
    try {
      return runtime.executePendingJobs();
    } finally {
      exitVm();
    }
  };
  const evalInVm = (code: string, asModule = false) => {
    enterVm();
    try {
      return asModule
        ? context.evalCode(code, 'tool.js', { type: 'module' })
        : context.evalCode(code, 'tool.js');
    } finally {
      exitVm();
    }
  };
  const callInVm = (func: QuickJSHandle, thisVal: QuickJSHandle, args: QuickJSHandle[]) => {
    enterVm();
    try {
      return context.callFunction(func, thisVal, args);
    } finally {
      exitVm();
    }
  };
  const handles: QuickJSHandle[] = [];
  const track = (handle: QuickJSHandle): QuickJSHandle => {
    handles.push(handle);
    return handle;
  };
  // Pumps that run outside VM execution (async fetch continuation, error
  // paths) go through settleVm, so the VM time they spend also counts as cpu.
  const settleVm = (settle: (handle: QuickJSHandle) => void, handle: QuickJSHandle): void => {
    enterVm();
    try {
      settle(handle);
    } finally {
      exitVm();
    }
    pumpJobs();
  };
  const rejectWith = (
    deferred: { reject: (handle: QuickJSHandle) => void },
    text: string,
  ): void => {
    settleVm((handle) => deferred.reject(handle), track(context.newString(text)));
  };

  const execute = Effect.gen(function* () {
    let fetchId = 0;

    // Everything after the url check, as one Effect. The caller starts it with
    // `runPromise`, which runs the fiber up to its first wait synchronously, so
    // the early rejection and the 'fetch' message still happen before
    // `fetchImpl` returns. A failure here becomes a rejection of the tool's
    // fetch promise; a throw from `rejectWith` itself rejects the run, which
    // crashes the worker exactly as the old unhandled rejection did.
    const fetchEffect = (
      deferred: Deferred,
      urlText: string,
      initHandle: QuickJSHandle | undefined,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (fetchCount >= limits.maxFetches) {
          rejectWith(deferred, 'fetch_denied: too many fetches');
          return;
        }
        fetchCount += 1;
        let method = 'GET';
        let headers: Record<string, string> = {};
        let bodyPresent = false;
        if (initHandle !== undefined) {
          yield* Effect.match(
            Effect.try(() => {
              if (context.typeof(initHandle) !== 'undefined') {
                const dumpedInit: unknown = context.dump(initHandle);
                if (typeof dumpedInit === 'object' && dumpedInit !== null) {
                  const init = dumpedInit as Record<string, unknown>;
                  if (typeof init.method === 'string') {
                    method = init.method;
                  }
                  if (typeof init.body !== 'undefined' && init.body !== null) {
                    bodyPresent = true;
                  }
                  if (typeof init.headers === 'object' && init.headers !== null) {
                    const rawHeaders = init.headers as Record<string, unknown>;
                    for (const [name, value] of Object.entries(rawHeaders)) {
                      if (typeof value === 'string') {
                        headers[name.toLowerCase()] = value;
                      }
                    }
                  }
                }
              }
            }),
            {
              onFailure: () => {
                headers = {};
              },
              onSuccess: () => undefined,
            },
          );
        }
        const id = fetchId++;
        const payload: WorkerFetchPayload = { id, url: urlText, method, headers, bodyPresent };
        parentPort?.postMessage({ type: 'fetch', ...payload });
        const response = yield* waitForFetchResponse(id, limits.fetchTimeoutMs);
        const bodyBytes = response.body;
        const bodyText = Buffer.from(bodyBytes).toString('utf8');
        const responseHandle = track(context.newObject());
        context.setProp(
          responseHandle,
          'ok',
          track(response.status >= 200 && response.status < 300 ? context.true : context.false),
        );
        context.setProp(responseHandle, 'status', track(context.newNumber(response.status)));
        const textFn = track(
          context.newFunction('text', () => {
            const out = context.newPromise();
            out.resolve(track(context.newString(bodyText)));
            return out.handle;
          }),
        );
        context.setProp(responseHandle, 'text', textFn);
        const jsonFn = track(
          context.newFunction('json', () => {
            const out = context.newPromise();
            enterVm();
            try {
              context.setProp(context.global, '__zilar_body', track(context.newString(bodyText)));
              const parsed = context.evalCode('JSON.parse(__zilar_body)', 'tool.js');
              if (parsed.error) {
                parsed.error.dispose();
                out.reject(track(context.newString('invalid json')));
              } else {
                const value = parsed.value;
                track(value);
                out.resolve(value);
              }
            } finally {
              exitVm();
            }
            return out.handle;
          }),
        );
        context.setProp(responseHandle, 'json', jsonFn);
        settleVm((handle) => deferred.resolve(handle), responseHandle);
      }).pipe(
        Effect.catchCause((cause) => {
          const error = Cause.squash(cause);
          const message = error instanceof Error ? error.message : 'fetch failed';
          return Effect.sync(() => {
            rejectWith(deferred, withFetchPrefix(message));
          });
        }),
      );

    const fetchImpl = (urlHandle: QuickJSHandle, initHandle?: QuickJSHandle): QuickJSHandle => {
      const deferred = context.newPromise();
      let urlText = '';
      try {
        urlText = context.getString(urlHandle);
      } catch {
        rejectWith(deferred, 'fetch_denied: invalid url');
        return deferred.handle;
      }
      void Effect.runPromise(fetchEffect(deferred, urlText, initHandle));
      return deferred.handle;
    };

    const fetchHandle = track(context.newFunction('fetch', fetchImpl));
    context.setProp(context.global, 'fetch', fetchHandle);

    const logImpl = (...args: QuickJSHandle[]): QuickJSHandle => {
      const parts = args.map((arg) => {
        try {
          const dumped: unknown = context.dump(arg);
          return typeof dumped === 'string' ? dumped : (JSON.stringify(dumped) ?? 'undefined');
        } catch {
          return 'undefined';
        }
      });
      logToParent(parts.join(' '));
      return context.undefined;
    };
    const consoleHandle = track(context.newObject());
    for (const level of ['log', 'warn', 'error'] as const) {
      const fn = track(context.newFunction(level, logImpl));
      context.setProp(consoleHandle, level, fn);
    }
    context.setProp(context.global, 'console', consoleHandle);

    context.setProp(context.global, '__zilar_input', track(context.newString(params.inputJson)));

    const interruptedResult = (
      text: string,
    ): { type: 'error'; kind: WorkerErrorKind; message: string } | null => {
      if (/interrupted/i.test(text)) {
        return { type: 'error', kind: 'timeout', message: 'tool timed out' };
      }
      if (/out of memory/i.test(text)) {
        return { type: 'error', kind: 'memory', message: 'tool ran out of memory' };
      }
      return null;
    };

    const evalResult = evalInVm(params.source, true);
    if (evalResult.error) {
      const dumped = dumpVmError(context, evalResult.error);
      evalResult.error.dispose();
      const interrupted = interruptedResult(dumped.message);
      if (interrupted !== null) {
        finish({ ...interrupted, fetchCount, durationMs: Date.now() - startedAt });
        return;
      }
      if (/could not load module/i.test(dumped.message)) {
        finish({
          type: 'error',
          kind: 'runtime',
          message: 'imports are not allowed',
          fetchCount,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      finish({
        type: 'error',
        kind: 'syntax',
        message: dumped.message.slice(0, 300),
        fetchCount,
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    const namespace = evalResult.value;
    track(namespace);
    const defaultExport = track(context.getProp(namespace, 'default'));
    if (context.typeof(defaultExport) !== 'function') {
      finish({
        type: 'error',
        kind: 'invalid_output',
        message: 'tool must default-export a function',
        fetchCount,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const parseInput = evalInVm('JSON.parse(__zilar_input)');
    if (parseInput.error) {
      const dumped = dumpVmError(context, parseInput.error);
      parseInput.error.dispose();
      finish({
        type: 'error',
        kind: 'runtime',
        message: dumped.message.slice(0, 300),
        fetchCount,
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    const inputHandle = parseInput.value;
    track(inputHandle);

    const callResult = callInVm(defaultExport, context.undefined, [inputHandle]);
    if (callResult.error) {
      const dumped = dumpVmError(context, callResult.error);
      callResult.error.dispose();
      const interrupted = interruptedResult(dumped.message);
      if (interrupted !== null) {
        finish({ ...interrupted, fetchCount, durationMs: Date.now() - startedAt });
        return;
      }
      finish({
        type: 'error',
        kind: 'runtime',
        message: `${dumped.name}: ${dumped.message}`.slice(0, 300),
        fetchCount,
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    const returned = callResult.value;
    track(returned);

    const asPromise = context.resolvePromise(returned);
    let settled = false;
    Effect.runFork(
      Effect.exit(Effect.promise(() => asPromise)).pipe(
        Effect.andThen(
          Effect.sync(() => {
            settled = true;
          }),
        ),
      ),
    );

    while (!settled) {
      const jobs = pumpJobs();
      if (jobs.error) {
        const dumped = dumpVmError(context, jobs.error);
        jobs.error.dispose();
        finish({
          type: 'error',
          kind: 'runtime',
          message: `${dumped.name}: ${dumped.message}`.slice(0, 300),
          fetchCount,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      if (Date.now() >= wallDeadline) {
        finish({
          type: 'error',
          kind: 'timeout',
          message: 'tool timed out',
          fetchCount,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      yield* nextImmediate;
    }

    const finalResult = yield* Effect.promise(() => asPromise);
    if (finalResult.error) {
      const dumped = dumpVmError(context, finalResult.error);
      finalResult.error.dispose();
      const interrupted = interruptedResult(dumped.message);
      if (interrupted !== null) {
        finish({ ...interrupted, fetchCount, durationMs: Date.now() - startedAt });
        return;
      }
      if (/^fetch_denied:/i.test(dumped.message)) {
        finish({
          type: 'error',
          kind: 'fetch_denied',
          message: dumped.message.slice(0, 300),
          fetchCount,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      finish({
        type: 'error',
        kind: 'runtime',
        message: `${dumped.name}: ${dumped.message}`.slice(0, 300),
        fetchCount,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const valueHandle = finalResult.value;
    track(valueHandle);
    const valueType = context.typeof(valueHandle);
    let outputJson: string | null = null;
    if (valueType === 'string') {
      const text = context.getString(valueHandle);
      outputJson = JSON.stringify({ text });
    } else if (valueType === 'object') {
      context.setProp(context.global, '__zilar_result_value', valueHandle);
      const stringifyResult = evalInVm(
        '(() => { try { return JSON.stringify(__zilar_result_value); } catch (e) { return null; } })()',
      );
      if (!stringifyResult.error) {
        const stringified = stringifyResult.value;
        track(stringified);
        if (context.typeof(stringified) === 'string') {
          outputJson = context.getString(stringified);
        }
      } else {
        stringifyResult.error.dispose();
      }
    }
    if (outputJson === null) {
      finish({
        type: 'error',
        kind: 'invalid_output',
        message: 'tool must return a string or { text, data }',
        fetchCount,
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    if (Buffer.byteLength(outputJson, 'utf8') > limits.maxOutputBytes) {
      finish({
        type: 'error',
        kind: 'output_too_large',
        message: 'tool output is too large',
        fetchCount,
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    finish({ type: 'result', outputJson, fetchCount, durationMs: Date.now() - startedAt });
  });

  // A failed dispose stops the handle loop; the context and runtime are still
  // disposed. The runtime may be out of memory; the worker exits anyway.
  const disposeVm = Effect.gen(function* () {
    for (let index = handles.length - 1; index >= 0; index -= 1) {
      const handle = handles[index] as QuickJSHandle;
      const disposed = yield* disposeQuietly(() => {
        if (handle.alive) {
          handle.dispose();
        }
      });
      if (!disposed) {
        break;
      }
    }
    yield* disposeQuietly(() => context.dispose());
    yield* disposeQuietly(() => runtime.dispose());
  });

  yield* execute.pipe(
    Effect.catchCause(() =>
      Effect.sync(() => {
        parentPort?.postMessage({
          type: 'error',
          kind: 'runtime',
          message: 'tool failed',
          fetchCount,
          durationMs: Date.now() - startedAt,
        });
      }),
    ),
    Effect.ensuring(disposeVm),
  );
});

void Effect.runPromise(run);
